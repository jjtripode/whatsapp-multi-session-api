const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

const voiceToTextGemini = async (path, botSystemInstruction) => {
  if (!fs.existsSync(path)) {
    throw new Error("No se encuentra el archivo");
  }
  try {
    const fileManager = new GoogleAIFileManager(process.env.API_KEY_GEMINI);
    const audioFile = await fileManager.uploadFile(path, {
      mimeType: "audio/mp3",
    });

    const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);

    const model = genAI.getGenerativeModel(
        { model: "gemini-1.5-flash",
            systemInstruction:botSystemInstruction
         });

    const result = await model.generateContent([
      {
        fileData: {
          mimeType: audioFile.file.mimeType,
          fileUri: audioFile.file.uri,
        },
      },
      { text: "Es obligatorio Resumir el pedido. Verifica que es lo que solicita el cliente y si es posible avanza con la venta o responde las dudas." },
    ]);

    console.log(result.response.text());
    return result.response.text();
  } catch (err) {
    console.log(err);
    return "ERROR";
  }
};

module.exports = { voiceToTextGemini };
