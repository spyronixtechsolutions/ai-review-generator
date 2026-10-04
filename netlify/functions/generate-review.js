exports.handler = async (event) => {
  try {
    const data = event.body ? JSON.parse(event.body) : {};

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: "GEMINI_API_KEY environment variable is missing in Netlify configuration." 
        })
      };
    }

    const lengthMap = {
      short: "20 to 40 words",
      medium: "60 to 90 words",
      long: "100 to 140 words"
    };

    const selectedLength = lengthMap[data.length] || "60 to 90 words";
    const doctorName = data.specificDoctor ? `${data.doctor} (${data.specificDoctor})` : data.doctor;

    const promptText = `
You are an expert review writer. Generate exactly 3 completely different Google reviews for a medical facility.

Clinic/Hospital: ${doctorName}
Location: ${data.location}
Treatment/Service: ${data.treatment}
Overall Rating: ${data.comment || "Excellent"}

Language: Write the review completely in ${data.language || "English"}.

Length requirement:
Each review must be ${selectedLength}.

Formatting & Tone Rules:
- WRITE STRICTLY IN THE FIRST PERSON ("I", "my", "me"). You are the patient who received this treatment.
- Number each review as 1., 2., and 3.
- Separate each review with two line breaks.
- Natural, grateful, human tone.
- Mention the location (${data.location}) only once per review.
- No emojis, hashtags, prices, or phone numbers.
- No medical guarantees.
- Do not repeat identical phrases across reviews.
`;

    // Active production models array
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
    let lastErrorMessage = "";

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.7
              }
            })
          }
        );

        const result = await response.json();

        if (response.ok && result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
          return {
            statusCode: 200,
            body: JSON.stringify({
              review: result.candidates[0].content.parts[0].text
            })
          };
        }

        lastErrorMessage = result.error?.message || JSON.stringify(result);
      } catch (err) {
        lastErrorMessage = err.message;
      }
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `AI Generation Error: ${lastErrorMessage}`
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: `Server Error: ${err.message}`
      })
    };
  }
};
