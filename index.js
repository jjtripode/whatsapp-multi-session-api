require("dotenv").config();
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { convertOggMp3 } = require("./services/converter");
const { voiceToTextGemini } = require("./services/audioToTextGenimi");
const { group } = require("console");

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = 3000;
const SESSION_DIR = "./sessions/";
const INSTRUCTIONS_DIR = "./instructions/"; 
const AUDIO_DIR = "./audios/"; 


if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR);
}

if (!fs.existsSync(INSTRUCTIONS_DIR)) {
  fs.mkdirSync(INSTRUCTIONS_DIR);
}

if (!fs.existsSync(INSTRUCTIONS_DIR)) {
  fs.mkdirSync(INSTRUCTIONS_DIR);
}

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR);
}


const saveSystemInstruction = (sessionId, systemInstruction) => {
  const filePath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
  fs.writeFileSync(filePath, systemInstruction, "utf8");
};

const loadSystemInstruction = (sessionId) => {
  const filePath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8");
  }
  return null;
};

const getGeminiInputTextHttpRequest = async (msg, systemInstrucction) => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: systemInstrucction,
  });
  const prompt = msg;
  const result = await model.generateContent(prompt);
  const receivedData = result.response.text();

  return receivedData;
};

function createClient(sessionId, systemInstrucction) {
  const sessionPath = `${SESSION_DIR}${sessionId}`;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: sessionPath,
    }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error(err);
      } else {
        client.qrUrl = url; 
      }
    });
  });

  client.on("ready", () => {
    console.log(`Client for session ${sessionId} is ready!`);
    client.qrUrl = null;
  });

  client.on("message", async (msg) => {
    var sessionId = client.authStrategy.clientId;
    var botSystemInstrucction = systemInstrucctions[sessionId];
    const chat = await msg.getChat();
    console.log(chat);
 
    // no responde en group
    if (chat.isGroup) {
      return;
    }

    if (msg.type === "chat") {
      const response = await getGeminiInputTextHttpRequest(
        msg.body,
        botSystemInstrucction
      );
      client.sendMessage(msg.from, response);
    } else {
      if (msg.hasMedia && msg.type === "ptt") {
        const audio = await msg.downloadMedia();
        const pathTmpOgg = `${process.cwd()}/${AUDIO_DIR}/audio-${sessionId}-${Date.now()}.ogg`;
        const pathTmpMp3 = `${process.cwd()}/${AUDIO_DIR}/audio-${sessionId}-${Date.now()}.mp3`;

        const binaryData = Buffer.from(audio.data, "base64");
        await fs.writeFile(pathTmpOgg, binaryData, function (err) {
          console.log(err);
        });

        await convertOggMp3(pathTmpOgg, pathTmpMp3);
        const text = await voiceToTextGemini(pathTmpMp3, botSystemInstrucction);
        client.sendMessage(msg.from, text);
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

const restoreSessions = () => {
  const sessionFolders = fs.readdirSync(SESSION_DIR);
  sessionFolders.forEach((sessionId) => {
    console.log(`Restaurando sesión para: ${sessionId}`);
    
    const systemInstruction = loadSystemInstruction(sessionId);
    if (systemInstruction) {
      systemInstrucctions[sessionId] = systemInstruction;
    }
    
    clients[sessionId] = createClient(sessionId, systemInstrucctions[sessionId]);
  });
};

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.post("/start-session", (req, res) => {
  const sessionId = req.body.sessionId;
  const systemInstrucction = req.body.systemInstrucction;

  if (!clients[sessionId]) {
    clients[sessionId] = createClient(sessionId, systemInstrucction);
    systemInstrucctions[sessionId] = systemInstrucction;
    saveSystemInstruction(sessionId, systemInstrucction);
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

app.get("/broadcast-ui", (req, res) => {
  res.sendFile(__dirname + "/public/broadcast.html");
});

app.post("/broadcast", async (req, res) => {
  const { sessionId, message, contactList } = req.body;
  const client = clients[sessionId];
  if (!client) {
    return res.status(404).json({ error: "Session not found" });
  }

  try {
    let contacts;

    if (contactList && Array.isArray(contactList)) {
      const allContacts = await client.getContacts();
      console.log(allContacts);
      const allContactIds = allContacts.map((contact) => contact.id._serialized);

      contacts = allContactIds.filter((contactNumber) =>
        contactList.some((number) => contactNumber.includes(number))
      );

      for (const contact of contacts) {
        await client.sendMessage(contact, message);
      }
    } 

    res.json({
      success: true,
      message: `Broadcast sent to ${contacts.length} contacts.`,
      invalidContacts: contactList?.filter((number) => !contacts.includes(number)) || [],
    });
  } catch (error) {
    console.error("Error in broadcast:", error);
    res.status(500).json({ error: "Failed to send broadcast" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  restoreSessions(); });
