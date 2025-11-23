import { GoogleGenAI, Modality } from "@google/genai";
import { SpeakerVoice } from "../types";

// Helper to base64 decode (since we might need it for processing raw parts if not using blob directly)
function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export const generateSpeech = async (text: string, voiceName: SpeakerVoice = 'Puck'): Promise<ArrayBuffer> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is not defined in the environment.");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const candidate = response.candidates?.[0];
    const audioPart = candidate?.content?.parts?.[0];

    if (!audioPart || !audioPart.inlineData || !audioPart.inlineData.data) {
      throw new Error("No audio data returned from Gemini.");
    }

    return decodeBase64ToArrayBuffer(audioPart.inlineData.data);
  } catch (error) {
    console.error("Gemini TTS Error:", error);
    throw error;
  }
};