// Review generator running as a Netlify Edge Function.
// Edge functions may take up to 40 seconds to start their response (serverless functions are cut off at 10),
// and time spent waiting for Gemini doesn't count against their 50 ms CPU limit. That lets a slow Gemini
// reply finish instead of failing, and leaves time to try the backup model.

// Stay well inside Netlify's 40 s response limit.
const DEADLINE_MS = 30000;
// The main model gets most of the time; the backup gets whatever is left.
const PRIMARY_TIMEOUT_MS = 20000;
// Don't start a model call with less time than this left; it would only time out.
const MIN_ATTEMPT_MS = 4000;

// Both can be changed in Netlify's environment variables (Functions scope) without editing this file.
const PRIMARY_MODEL = Netlify.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite";
// A different model family from the main one, so it is less likely to be overloaded at the same time.
// (gemini-2.5-flash-lite was retired for new users in 2026.)
const BACKUP_MODEL = Netlify.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.8-flash";

// Extra generation settings per model. The backup "thinks" before answering by default,
// which is too slow for short reviews, so ask it to keep thinking to a minimum.
const GENERATION_CONFIG = {
  [BACKUP_MODEL]: { thinkingConfig: { thinkingLevel: "low" } }
};

const LENGTHS = {
  short: "20 to 40 words",
  medium: "60 to 90 words",
  long: "100 to 140 words"
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function buildPrompt(data) {
  const selectedLength = LENGTHS[data.length] || "60 to 90 words";
  const doctorName = data.specificDoctor ? `${data.doctor} (${data.specificDoctor})` : (data.doctor || 'a professional');
  return `
Generate exactly 3 completely different Google reviews.

Doctor/Hospital: ${doctorName}
Location: ${data.location || 'the clinic'}
Treatment: ${data.treatment || 'the service'}
Comments: ${data.comment || 'Excellent'}

Language: Write the review completely in ${data.language || 'English'}.

Length requirement:
Each review must be ${selectedLength}.

Formatting Rules:
- WRITE STRICTLY IN THE FIRST PERSON ("I", "my", "me"). You are the patient who received this treatment.
- Number each review as 1., 2., and 3.
- Separate each review with two line breaks.
- Natural, grateful, human tone.
- Mention the location (${data.location || 'the clinic'}) only once per review.
- No emojis, hashtags, prices, or phone numbers.
- No medical guarantees.
- Write like a real person sharing experience.
- Do not repeat sentences across reviews.
`;
}

/** One Gemini call. Returns { text } on success, or { retryable, status, details } on failure. */
async function callGemini(apiKey, model, promptText, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The API key goes only in the x-goog-api-key header: keys in URLs end up in request logs
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          ...(GENERATION_CONFIG[model] ? { generationConfig: GENERATION_CONFIG[model] } : {})
        }),
        signal: controller.signal
      }
    );
    const result = await response.json();

    if (result.error) {
      const code = result.error.code;
      // 404 means this model name isn't available to the key, so the other model is worth trying
      return { retryable: [404, 429, 500, 503].includes(code), status: code === 429 || code === 503 ? code : 500, details: result };
    }
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { retryable: true, status: 500, details: result };
    return { text };
  } catch (err) {
    if (err.name === "AbortError") {
      return { retryable: true, status: 503, details: { error: { code: 503, message: `${model} took too long to respond` } } };
    }
    return { retryable: true, status: 500, details: { error: { message: err.message } } };
  } finally {
    clearTimeout(timer);
  }
}

export default async (request) => {
  const startedAt = Date.now();
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = Netlify.env.get("GEMINI_API_KEY");
  if (!apiKey) return json(500, { error: "Configuration Error: GEMINI_API_KEY is missing." });

  let data;
  try {
    data = await request.json();
  } catch (e) {
    return json(400, { error: "Invalid request body" });
  }

  const promptText = buildPrompt(data);
  // Which models were tried and why they failed, so problems show up in the response
  const attempts = [];
  let failure = null;

  for (const model of [PRIMARY_MODEL, BACKUP_MODEL]) {
    const remaining = DEADLINE_MS - (Date.now() - startedAt);
    if (remaining < MIN_ATTEMPT_MS) break;
    const timeout = model === PRIMARY_MODEL ? Math.min(PRIMARY_TIMEOUT_MS, remaining) : remaining;

    const attempt = await callGemini(apiKey, model, promptText, timeout);
    if (attempt.text) return json(200, { review: attempt.text, model, attempts });

    attempts.push({ model, code: attempt.details?.error?.code ?? null, message: String(attempt.details?.error?.message || "").slice(0, 160) });
    failure = attempt;
    if (!attempt.retryable) break;
  }

  // The page shows its "busy" / "unavailable" messages from details.error.code
  return json(failure ? failure.status : 503, {
    error: "Gemini could not generate a review",
    retryable: !failure || failure.retryable,
    attempts,
    details: failure ? failure.details : { error: { code: 503, message: "No time left to try another model" } }
  });
};

export const config = { path: "/api/generate-review", method: "POST" };
