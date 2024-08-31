require("dotenv").config();
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = 3000;
const SESSION_DIR = "./sessions/";

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR);
}

const getGeminiInputTextHttpRequest = async (msg, systemInstrucction) => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: systemInstrucction,
  });
  console.log(`systemInstrucction ${systemInstrucction}`);
  const prompt = msg;
  const result = await model.generateContent(prompt);
  console.log(result.response.text());

  const receivedData = result.response.text();
  console.log("Data received:", receivedData);

  return result.response.text();
};

function createClient(sessionId, systemInstrucction) {
  const sessionPath = `${SESSION_DIR}${sessionId}`;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: sessionPath,
    }),
  });

  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error(err);
      } else {
        client.qrUrl = url; // Guardar el QR como URL de datos
      }
    });
  });

  client.on("ready", () => {
    console.log(`Client for session ${sessionId} is ready!`);
    client.qrUrl = null;
  });

  client.on("message", async (msg) => {
    var botSystemInstrucction = systemInstrucctions[client.authStrategy.clientId];
    // console.log(botSystemInstrucction);
    // console.log(msg);

    if (msg.type === "chat") {
      const response = await getGeminiInputTextHttpRequest(
        msg.body,
        botSystemInstrucction
      );
      client.sendMessage(msg.from, response);
    } else {
      if (msg.hasMedia && msg.type === "ptt") {
        const audio = await msg.downloadMedia();
        await client.sendMessage(msg.from, audio, { sendAudioAsVoice: true });
      }
    }
  });

  client.on("message_create", (message) => {
    console.log(message.body);
  });

  client.initialize();
  return client;
}

const clients = {};
const systemInstrucctions = {};

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.post("/start-session", (req, res) => {
  const sessionId = req.body.sessionId;
  const systemInstrucction = req.body.systemInstrucction;
  if (!clients[sessionId]) {
    clients[sessionId] = createClient(sessionId, systemInstrucction);
    systemInstrucctions[sessionId] = systemInstrucction;
  }
  res.redirect(`/qr/${sessionId}`);
});

app.get("/check-qr/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const client = clients[sessionId];

  if (!client) {
    return res.status(404).send("Session not found");
  }

  if (client.qrUrl) {
    res.json({ ready: true, qrUrl: client.qrUrl });
  } else {
    res.json({ ready: false });
  }
});

app.get("/qr/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ sessionId: sessionId }));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
