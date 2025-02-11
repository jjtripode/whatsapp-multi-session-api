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
const GROUP_RESPONSE_DIR = "./group_responses/";

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

if (!fs.existsSync(GROUP_RESPONSE_DIR)){
  fs.mkdirSync(GROUP_RESPONSE_DIR);
} 


const saveSystemInstruction = (sessionId, systemInstruction) => {
  const filePath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
  fs.writeFileSync(filePath, systemInstruction, "utf8");
};

const saveGroupResponse = (sessionId, allowGroupResponse) => {
  fs.writeFileSync(`${GROUP_RESPONSE_DIR}${sessionId}.txt`, allowGroupResponse.toString(), "utf8");
};

const loadSystemInstruction = (sessionId) => {
  const filePath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8");
  }
  return null;
};

const loadGroupResponse = (sessionId) => {
  const filePath = `${GROUP_RESPONSE_DIR}${sessionId}.txt`;
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") === "true" : false;
};

const getGeminiInputTextHttpRequest = async (msg, systemInstruction) => {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: systemInstruction,
  });
  const prompt = msg;
  const result = await model.generateContent(prompt);
  const receivedData = result.response.text();

  return receivedData;
};

function createClient(sessionId, systemInstruction) {
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
    var botsystemInstruction = systemInstructions[sessionId];
    const chat = await msg.getChat();
    console.log(chat);
 
    // no responde en group
    if (chat.isGroup && !groupResponses[sessionId]) {
      return;
    }

    if (msg.type === "chat") {
      const response = await getGeminiInputTextHttpRequest(
        msg.body,
        botsystemInstruction
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
        const text = await voiceToTextGemini(pathTmpMp3, botsystemInstruction);
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
const systemInstructions = {};
const groupResponses = {};

const restoreSessions = () => {
  const sessionFolders = fs.readdirSync(SESSION_DIR);
  sessionFolders.forEach((sessionId) => {
    console.log(`Restaurando sesión para: ${sessionId}`);
    
    const systemInstruction = loadSystemInstruction(sessionId);
    if (systemInstruction) {
      systemInstructions[sessionId] = systemInstruction;
    }
    const allowGroupResponse = loadGroupResponse(sessionId);
    groupResponses[sessionId] = allowGroupResponse;
    
    clients[sessionId] = createClient(sessionId, systemInstructions[sessionId]);
  });
};

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

app.post("/start-session", (req, res) => {
  const sessionId = req.body.sessionId;
  const systemInstruction = req.body.systemInstruction;
  const allowGroupResponse = req.body.allowGroupResponse;

  if (!clients[sessionId]) {
    clients[sessionId] = createClient(sessionId, systemInstruction);
    systemInstructions[sessionId] = systemInstruction;
    saveSystemInstruction(sessionId, systemInstruction);
    groupResponses[sessionId] = allowGroupResponse;
    saveGroupResponse(sessionId, allowGroupResponse);
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

app.get("/admin", (req, res) => res.sendFile(__dirname + "/public/admin.html"));

app.get("/sessions", (req, res) => {
  res.json(Object.keys(clients).map(sessionId => ({
    sessionId,
    systemInstruction: systemInstructions[sessionId],
    allowGroupResponse: groupResponses[sessionId]
  })));
});

app.post("/update-session", (req, res) => {
  const sessionId = req.body.sessionId;
  const systemInstruction = req.body.systemInstruction;
  const allowGroupResponse = req.body.allowGroupResponse;
 
  console.log(systemInstruction);
  console.log(allowGroupResponse);

  if (clients[sessionId]) {
    systemInstructions[sessionId] = systemInstruction;
    groupResponses[sessionId] = allowGroupResponse;

    saveSystemInstruction(sessionId, systemInstruction);
    saveGroupResponse(sessionId, allowGroupResponse);
  }

  res.json({ success: true });
});

app.post("/end-session", (req, res) => {
  const { sessionId } = req.body;
  console.log("end-session:" + sessionId);

  if (clients[sessionId]) {
    clients[sessionId].destroy();
    delete clients[sessionId];
    delete systemInstructions[sessionId];
    delete groupResponses[sessionId];

    const sessionPath = `${SESSION_DIR}${sessionId}`;
    const instructionsPath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
    const groupResponsePath = `${GROUP_RESPONSE_DIR}${sessionId}.txt`;

    // Verificar si existen antes de borrar
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    if (fs.existsSync(instructionsPath)) {
      fs.unlinkSync(instructionsPath);
    }

    if (fs.existsSync(groupResponsePath)) {
      fs.unlinkSync(groupResponsePath);
    }
  }

  res.json({ success: true });
});

app.get('/contacts/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  console.log(sessionId);

  if (!clients[sessionId]) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
  }

  try {
      const client = clients[sessionId];
      const contacts = await client.getContacts();

      // Filtrar solo usuarios normales (@c.us)
      const users = contacts
          .filter(contact => contact.id.server === 'c.us') // Solo @c.us
          .map(contact => ({
              id: contact.id._serialized,
              name: contact.name || contact.pushname || contact.number
          }));

      res.json(users);
  } catch (error) {
      console.error('Error obteniendo contactos:', error);
      res.status(500).json({ error: 'Error obteniendo contactos' });
  }
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  restoreSessions(); });
