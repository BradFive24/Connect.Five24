import { GoogleGenAI } from "@google/genai";

/**
 * Validates the Gemini API connection.
 * Logs success or failure to the console.
 */
export async function validateGeminiConnection() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing from the environment.");
    return false;
  }

  // Check if we already have a successful validation in this session
  if (sessionStorage.getItem('gemini_validated') === 'true') {
    return true;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Respond with 'Tactical link established.'",
    });

    if (response.text) {
      console.log("GEMINI INTEGRATION SUCCESS:", response.text);
      sessionStorage.setItem('gemini_validated', 'true');
      return true;
    }
    return false;
  } catch (error: any) {
    if (error?.status === 'RESOURCE_EXHAUSTED' || error?.code === 429) {
      console.warn("GEMINI QUOTA EXCEEDED: Falling back to tactical defaults.");
      // Mark as "validated" to stop retrying during this session, even if it failed due to quota
      sessionStorage.setItem('gemini_validated', 'quota_exceeded');
      return false;
    }
    console.error("GEMINI INTEGRATION FAILURE:", error);
    return false;
  }
}

export async function getCoachPrompts(industry: string, leadName: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing. Falling back to default prompts.");
    return getDefaultPrompts();
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-3-flash-preview";
  const prompt = `You are a high-performance sales coach specializing in NEPQ (Neuro-Emotional Persuasion Questioning). 
  Target Lead: ${leadName}
  Industry: ${industry}
  
  Provide 3 specific, tactical NEPQ questions for this lead:
  1. A Connecting Question (to lower resistance)
  2. A Problem Awareness Question (to uncover pain)
  3. A Consequence Question (to create urgency)
  
  Format the response as a JSON object with keys: connecting, problem, consequence. 
  Keep the questions short, punchy, and professional.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (!response.text) throw new Error("Empty response from Gemini");
    return JSON.parse(response.text.trim());
  } catch (error) {
    console.error("Coach AI Error:", error);
    return getDefaultPrompts();
  }
}

function getDefaultPrompts() {
  return {
    connecting: "What was it that you saw that made you feel like you might need to look at something different?",
    problem: "How has this [problem] been impacting your ability to [goal] lately?",
    consequence: "What happens if you don't do anything about this and things stay the same for another 6 months?"
  };
}
