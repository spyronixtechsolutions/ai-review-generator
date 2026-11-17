// Netlify stops a function after 10 seconds. Everything below must finish inside DEADLINE_MS, so a slow or
// overloaded model returns a clean "busy" response the page can retry, instead of an unhandled timeout.
const DEADLINE_MS = 8300;
// Don't start a model call with less time than this left; it would only time out.
const MIN_ATTEMPT_MS = 2500;

// The backup model is used when the main one is overloaded, rate-limited or too slow.
// Both can be changed in Netlify's environment variables without editing this file.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const BACKUP_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";

/** One Gemini call. Returns { text } on success, or { retryable, status, details } on failure. */
async function callGemini(model, promptText, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // The API key goes only in the x-goog-api-key header: keys in URLs end up in request logs
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: promptText
                }
              ]
            }
          ]
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
    if (!text) {
      return { retryable: true, status: 500, details: result };
    }
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

exports.handler = async (event) => {
  const startedAt = Date.now();
  try {
    const data = event.body ? JSON.parse(event.body) : {};

    const lengthMap = {
      short: "20 to 40 words",
      medium: "60 to 90 words",
      long: "100 to 140 words"
    };

    const selectedLength = lengthMap[data.length] || "60 to 90 words";

    if (!process.env.GEMINI_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Configuration Error: GEMINI_API_KEY is missing." })
      };
    }

    const doctorName = data.specificDoctor ? `${data.doctor} (${data.specificDoctor})` : (data.doctor || 'a professional');

    const promptText = `
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

    // The page's automatic retry asks for the backup first, since the main model just failed it
    const models = data.preferBackup ? [BACKUP_MODEL, PRIMARY_MODEL] : [PRIMARY_MODEL, BACKUP_MODEL];
    let failure = null;
    // Which models were tried and why they failed, so problems show up in the response
    const attempts = [];

    for (const model of models) {
      const remaining = DEADLINE_MS - (Date.now() - startedAt);
      if (remaining < MIN_ATTEMPT_MS) break;

      const attempt = await callGemini(model, promptText, remaining);
      if (attempt.text) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            review: attempt.text,
            model,
            attempts
          })
        };
      }
      attempts.push({ model, code: attempt.details?.error?.code ?? null, message: String(attempt.details?.error?.message || "").slice(0, 160) });
      failure = attempt;
      if (!attempt.retryable) break;
    }

    // The page shows its "busy" / "unavailable" messages from details.error.code
    const status = failure ? failure.status : 503;
    return {
      statusCode: status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Gemini could not generate a review",
        retryable: !failure || failure.retryable,
        attempts,
        details: failure ? failure.details : { error: { code: 503, message: "No time left to try another model" } }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server internal breakdown",
        details: err.message
      })
    };
  }
};
