exports.handler = async (event) => {
  try {
    const data = event.body ? JSON.parse(event.body) : {};

    const lengthMap = {
      short: "40 to 60 words",
      medium: "60 to 90 words",
      long: "100 to 140 words"
    };

    const selectedLength = lengthMap[data.length] || "60 to 90 words";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
{
                  text: `
Generate exactly 3 completely different Google reviews.

Clinic/Hospital: ${data.doctor}
${data.specificDoctor ? `Treated by Doctor: ${data.specificDoctor}` : ''}
Location: ${data.location}
Treatment: ${data.treatment}
Overall Experience: ${data.comment}

Language: Write the review completely in ${data.language}.

Length requirement:
Each review must be ${selectedLength}.

Formatting Rules:
- WRITE IN THE FIRST PERSON ("I", "my", "me"). You are the patient who received this treatment. Do not write from a third-person perspective.
- Number each review as 1., 2., and 3.
- Separate each review with two line breaks.
- Natural, human tone. Simple language.
- Mention the location only once per review.
- ${data.specificDoctor ? `Make sure to mention and praise ${data.specificDoctor} directly in the review.` : 'Mention the clinic/hospital name naturally.'}
- No emojis, hashtags, prices, or phone numbers.
- No medical guarantees.
- Do not repeat sentences across reviews.
`
                }
              ]
            }
          ]
        })
      }
    );

    const result = await response.json();

    if (!result.candidates) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Gemini API failed", details: result })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        review: result.candidates[0].content.parts[0].text
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message
      })
    };
  }
};
