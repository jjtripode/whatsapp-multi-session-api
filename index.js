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
const { v4: uuidv4 } = require('uuid');
const path = require("path");
const multer = require("multer");

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 4000;
const SESSION_DIR = "./sessions/";
const INSTRUCTIONS_DIR = "./instructions/";
const AUDIO_DIR = "./audios/";
const GROUP_RESPONSE_DIR = "./group_responses/";

console.log("Iniciando servidor WhatsApp Bot...");
console.log(`Puerto configurado: ${PORT}`);

// Crear directorios si no existen
const createDirectories = () => {
  const dirs = [SESSION_DIR, INSTRUCTIONS_DIR, AUDIO_DIR, GROUP_RESPONSE_DIR];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Directorio creado: ${dir}`);
    } else {
      console.log(`Directorio ya existe: ${dir}`);
    }
  });
};

createDirectories();

const saveSystemInstruction = (sessionId, systemInstruction) => {
  try {
    const filePath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
    fs.writeFileSync(filePath, systemInstruction, "utf8");
    console.log(
      `Instrucciones del sistema guardadas para sesión: ${sessionId}`
    );
  } catch (error) {
    console.error(`Error guardando instrucciones para ${sessionId}:`, error);
  }
};

const saveGroupResponse = (sessionId, allowGroupResponse) => {
  try {
    const filePath = `${GROUP_RESPONSE_DIR}${sessionId}.txt`;
    fs.writeFileSync(filePath, allowGroupResponse.toString(), "utf8");
    console.log(
      `Configuración de respuesta grupal guardada para sesión: ${sessionId}, valor: ${allowGroupResponse}`
    );
  } catch (error) {
    console.error(
      `Error guardando configuración grupal para ${sessionId}:`,
      error
    );
  }
};

const loadSystemInstruction = (sessionId) => {
  try {
    const filePath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
    if (fs.existsSync(filePath)) {
      const instruction = fs.readFileSync(filePath, "utf8");
      console.log(
        `Instrucciones del sistema cargadas para sesión: ${sessionId}`
      );
      return instruction;
    }
    console.log(`No se encontraron instrucciones para sesión: ${sessionId}`);
    return null;
  } catch (error) {
    console.error(`Error cargando instrucciones para ${sessionId}:`, error);
    return null;
  }
};

const loadGroupResponse = (sessionId) => {
  try {
    const filePath = `${GROUP_RESPONSE_DIR}${sessionId}.txt`;
    const result = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf8") === "true"
      : false;
    console.log(
      `Configuración de respuesta grupal cargada para sesión: ${sessionId}, valor: ${result}`
    );
    return result;
  } catch (error) {
    console.error(
      `Error cargando configuración grupal para ${sessionId}:`,
      error
    );
    return false;
  }
};

const getGeminiInputTextHttpRequest = async (msg, systemInstruction) => {
  try {
    console.log(`Enviando mensaje a Gemini: ${msg.substring(0, 100)}...`);
    const genAI = new GoogleGenerativeAI(process.env.API_KEY_GEMINI);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction,
    });
    const prompt = msg;
    const result = await model.generateContent(prompt);
    const receivedData = result.response.text();
    console.log(
      `Respuesta recibida de Gemini: ${receivedData.substring(0, 100)}...`
    );
    return receivedData;
  } catch (error) {
    console.error("Error en getGeminiInputTextHttpRequest:", error);
    return "Lo siento, hubo un error procesando tu mensaje.";
  }
};

// Método para manejar la sesión en JSON (actualmente no se usa pero está definido)
// const SESSION_FILE_PATH = "./session.json";

// const saveSession = (session) => {
//   try {
//     fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(session));
//     console.log('Sesión guardada en archivo JSON');
//   } catch (error) {
//     console.error('Error guardando sesión:', error);
//   }
// };

// const loadSession = () => {
//   try {
//     if (fs.existsSync(SESSION_FILE_PATH)) {
//       const session = JSON.parse(fs.readFileSync(SESSION_FILE_PATH));
//       console.log('Sesión cargada desde archivo JSON');
//       return session;
//     }
//     console.log('No se encontró archivo de sesión JSON');
//     return null;
//   } catch (error) {
//     console.error('Error cargando sesión:', error);
//     return null;
//   }
// };

function createClient(sessionId, systemInstruction) {
  console.log(`Creando cliente para sesión: ${sessionId}`);
  const sessionPath = `${SESSION_DIR}${sessionId}`;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: sessionPath,
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--single-process", // Para sistemas con poca RAM
      ],
      // CONFIGURACIONES CLAVE PARA SOLUCIONAR EL TIMEOUT
      timeout: 60000, // Aumentar timeout a 60 segundos
      protocolTimeout: 60000,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    },
    // Configuración adicional del cliente
    webVersionCache: {
      type: "remote",
      remotePath:
        "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
    // Retry automático
    maxRetries: 3,
    retryDelay: 5000,
  });

  // Agregar propiedades personalizadas al cliente
  client.sessionId = sessionId;
  client.isReady = false;
  client.qrUrl = null;
  client.initializationAttempts = 0;
  client.maxInitAttempts = 3;

  client.initializeWithRetry = async function () {
    this.initializationAttempts++;
    console.log(
      `🔄 Intento de inicialización ${this.initializationAttempts}/${this.maxInitAttempts} para sesión: ${sessionId}`
    );

    try {
      await this.initialize();
      console.log(`✅ Inicialización exitosa para sesión: ${sessionId}`);
    } catch (error) {
      console.error(
        `❌ Error en inicialización (intento ${this.initializationAttempts}):`,
        error.message
      );

      if (this.initializationAttempts < this.maxInitAttempts) {
        console.log(`🔄 Reintentando inicialización en 10 segundos...`);
        setTimeout(() => {
          this.initializeWithRetry();
        }, 10000);
      } else {
        console.error(
          `❌ Se agotaron los intentos de inicialización para sesión: ${sessionId}`
        );
        // Opcional: limpiar la sesión fallida
        this.cleanFailedSession();
      }
    }
  };

  client.cleanFailedSession = function () {
    try {
      console.log(`🧹 Limpiando sesión fallida: ${sessionId}`);

      // Eliminar de memoria
      delete clients[sessionId];
      delete systemInstructions[sessionId];
      delete groupResponses[sessionId];

      // Eliminar archivos de sesión
      const sessionPath = `${SESSION_DIR}${sessionId}`;
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`🗑️ Archivos de sesión eliminados: ${sessionPath}`);
      }
    } catch (cleanError) {
      console.error(`❌ Error limpiando sesión fallida:`, cleanError);
    }
  };

  client.on("qr", (qr) => {
    console.log(`📱 QR generado para sesión: ${sessionId}`);
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error(`❌ Error generando QR para ${sessionId}:`, err);
      } else {
        client.qrUrl = url;
        console.log(`✅ QR URL establecida para sesión: ${sessionId}`);
      }
    });
  });

  client.on("ready", () => {
    console.log(`✅ Cliente listo para sesión: ${sessionId}`);
    client.qrUrl = null;
    client.isReady = true;
    client.initializationAttempts = 0;
  });

  client.on("loading_screen", (percent, message) => {
    console.log(`🔄 Cargando cliente ${sessionId}: ${percent}% - ${message}`);
  });

  client.on("authenticated", () => {
    console.log(`🔐 Cliente autenticado para sesión: ${sessionId}`);
  });

  client.on("auth_failure", (message) => {
    console.error(`❌ Fallo de autenticación para ${sessionId}:`, message);
  });

  client.on("change_state", (state) => {
    console.log(`📱 Estado del cliente ${sessionId}:`, state);
    if (state === "DISCONNECTED") {
      console.log(`⚠️  Cliente ${sessionId} desconectado, reiniciando...`);
      client.isReady = false;
    }
  });

  client.on("message", async (msg) => {
    try {
      console.log(
        `📨 Mensaje recibido en sesión ${sessionId} de ${msg.from}: ${
          msg.body || "Audio/Media"
        }`
      );

      const sessionId = client.authStrategy.clientId;
      const botsystemInstruction = systemInstructions[sessionId];
      const chat = await msg.getChat();

      console.log(
        `💬 Chat info - Es grupo: ${chat.isGroup}, ID: ${chat.id.user}`
      );

      // No responde en grupo si está deshabilitado
      if (chat.isGroup && !groupResponses[sessionId]) {
        console.log(
          `🚫 Respuesta en grupo deshabilitada para sesión: ${sessionId}`
        );
        return;
      }

      if (msg.type === "chat") {
        console.log(`💭 Procesando mensaje de texto: ${msg.body}`);
        const response = await getGeminiInputTextHttpRequest(
          msg.body,
          botsystemInstruction
        );
        await client.sendMessage(msg.from, response);
        console.log(`✅ Respuesta enviada a ${msg.from}`);
      } else if (msg.hasMedia && msg.type === "ptt") {
        console.log(`🎤 Procesando mensaje de voz`);
        try {
          const audio = await msg.downloadMedia();
          const pathTmpOgg = `${process.cwd()}/${AUDIO_DIR}/audio-${sessionId}-${Date.now()}.ogg`;
          const pathTmpMp3 = `${process.cwd()}/${AUDIO_DIR}/audio-${sessionId}-${Date.now()}.mp3`;

          const binaryData = Buffer.from(audio.data, "base64");

          await fs.promises.writeFile(pathTmpOgg, binaryData);
          console.log(`🎵 Audio guardado en: ${pathTmpOgg}`);

          await convertOggMp3(pathTmpOgg, pathTmpMp3);
          console.log(`🔄 Audio convertido a: ${pathTmpMp3}`);

          const text = await voiceToTextGemini(
            pathTmpMp3,
            botsystemInstruction
          );
          await client.sendMessage(msg.from, text);
          console.log(`✅ Respuesta de audio enviada a ${msg.from}`);

          // Limpiar archivos temporales
          setTimeout(() => {
            try {
              if (fs.existsSync(pathTmpOgg)) fs.unlinkSync(pathTmpOgg);
              if (fs.existsSync(pathTmpMp3)) fs.unlinkSync(pathTmpMp3);
              console.log(`🗑️  Archivos temporales eliminados`);
            } catch (cleanError) {
              console.error("Error limpiando archivos temporales:", cleanError);
            }
          }, 5000);
        } catch (audioError) {
          console.error(`Error procesando audio:`, audioError);
        }
      } else {
        console.log(`ℹ️  Tipo de mensaje no soportado: ${msg.type}`);
      }
    } catch (messageError) {
      console.error(
        `Error procesando mensaje en sesión ${sessionId}:`,
        messageError
      );
    }
  });

  client.on("message_create", (message) => {
    if (message.fromMe) {
      console.log(
        `📤 Mensaje enviado desde ${sessionId}: ${message.body || "Media"}`
      );
    }
  });

  client.on("disconnected", (reason) => {
    console.log(
      `🔌 Cliente ${sessionId} desconectado (${reason}). Reiniciando sesión...`
    );
    client.isReady = false;
    setTimeout(() => {
      try {
        client.initialize();
      } catch (reinitError) {
        console.error(
          `Error reinicializando cliente ${sessionId}:`,
          reinitError
        );
      }
    }, 5000);
  });

  client.on("group_join", (notification) => {
    console.log(
      `👥 Usuario se unió al grupo en sesión ${sessionId}:`,
      notification
    );
  });

  client.on("group_leave", (notification) => {
    console.log(
      `👋 Usuario dejó el grupo en sesión ${sessionId}:`,
      notification
    );
  });

  // Métodos adicionales del cliente
  client.getStatus = function () {
    return {
      sessionId: this.sessionId,
      isReady: this.isReady,
      hasQR: !!this.qrUrl,
      info: this.info || null,
    };
  };

  client.sendBroadcast = async function (contacts, message) {
    const results = [];
    for (const contact of contacts) {
      try {
        await this.sendMessage(contact, message);
        results.push({ contact, success: true });
        console.log(`✅ Broadcast enviado a: ${contact}`);
      } catch (error) {
        results.push({ contact, success: false, error: error.message });
        console.error(`❌ Error enviando broadcast a ${contact}:`, error);
      }
    }
    return results;
  };

  client.getChatsWithMessages = async function () {
    try {
      const chats = await this.getChats();
      return chats.filter((chat) => chat.lastMessage);
    } catch (error) {
      console.error("Error obteniendo chats:", error);
      return [];
    }
  };

  // client.getChatById = async function (chatId) {
  //   try {
  //     if (!this.isReady) {
  //       throw new Error("Cliente de WhatsApp no está listo");
  //     }

  //     // Usar el método nativo de whatsapp-web.js

  //     // const contact = await client.getContactById(chatId);

  //     const chat = await this.getChatById(chatId);

  //     const messages = await chat.fetchMessages({ limit: 20 });

  //     for (const m of messages) {
  //       console.log(`${m.from}: ${m.body}`);
  //     }

  //     return messages;
  //   } catch (error) {
  //     throw new Error(`Chat no encontrado: ${error.message}`);
  //   }
  // };

  client.getChatMessages = async function (chatId, limit = 10) {
    try {
      if (!this.isReady) {
        throw new Error("Cliente de WhatsApp no está listo");
      }

      const chat = await this.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit });

      return messages.map((msg) => ({
        // id: msg.id._serialized,
        body: msg.body,
        timestamp: msg.timestamp,
        from: msg.from,
        to: msg.to,
        // author: msg.author,
        // type: msg.type,
        // hasMedia: msg.hasMedia,
        // isForwarded: msg.isForwarded,
        // isStatus: msg.isStatus,
      }));
    } catch (error) {
      throw new Error(`Error al obtener mensajes: ${error.message}`);
    }
  };

  // Método para buscar chats por nombre
  client.searchChatsByName = async function (searchQuery) {
    try {
      if (!this.isReady) {
        throw new Error("Cliente de WhatsApp no está listo");
      }

      const chats = await this.getChats();
      const foundChats = chats.filter(
        (chat) =>
          chat.name &&
          chat.name.toLowerCase().includes(searchQuery.toLowerCase())
      );

      return foundChats.map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || "Sin nombre",
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp: chat.timestamp,
        participantCount: chat.isGroup ? chat.participants.length : null,
      }));
    } catch (error) {
      throw new Error(`Error buscando chats: ${error.message}`);
    }
  };

  // Método para obtener todos los chats con información detallada
  client.getAllChatsDetailed = async function () {
    try {
      if (!this.isReady) {
        throw new Error("Cliente de WhatsApp no está listo");
      }

      const chats = await this.getChats();

      return chats.map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || "Sin nombre",
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        archived: chat.archived,
        isMuted: chat.isMuted,
        timestamp: chat.timestamp,
        participantCount: chat.isGroup ? chat.participants.length : null,
        lastMessage: chat.lastMessage
          ? {
              body: chat.lastMessage.body,
              timestamp: chat.lastMessage.timestamp,
              from: chat.lastMessage.from,
            }
          : null,
      }));
    } catch (error) {
      throw new Error(`Error obteniendo chats: ${error.message}`);
    }
  };

  client.initialize();
  console.log(`🚀 Cliente inicializado para sesión: ${sessionId}`);
  return client;
}

const clients = {};
const systemInstructions = {};
const groupResponses = {};

const restoreSessions = () => {
  console.log("🔄 Restaurando sesiones existentes...");
  try {
    const sessionFolders = fs.readdirSync(SESSION_DIR);
    console.log(`📁 Encontradas ${sessionFolders.length} carpetas de sesión`);

    sessionFolders.forEach((sessionId) => {
      console.log(`🔧 Restaurando sesión para: ${sessionId}`);

      const systemInstruction = loadSystemInstruction(sessionId);
      if (systemInstruction) {
        systemInstructions[sessionId] = systemInstruction;
      } else {
        systemInstructions[sessionId] = "Eres un asistente útil."; // Instrucción por defecto
      }

      const allowGroupResponse = loadGroupResponse(sessionId);
      groupResponses[sessionId] = allowGroupResponse;

      clients[sessionId] = createClient(
        sessionId,
        systemInstructions[sessionId]
      );
    });

    console.log(`✅ ${sessionFolders.length} sesiones restauradas`);
  } catch (error) {
    console.error("❌ Error restaurando sesiones:", error);
  }
};

// Rutas de Express para manejar las solicitudes de la aplicación
app.get("/", (req, res) => {
  console.log("📱 Acceso a página principal");
  res.sendFile(__dirname + "/public/index.html");
});

app.post("/init-session", (req, res) => {
  const { systemInstruction, allowGroupResponse } = req.body;
  const sessionId = uuidv4();;  // Generar ID único basado en timestamp
  console.log(`🔄 Iniciando nueva sesión: ${sessionId}`);
  console.log(
    `📝 Instrucción del sistema: ${systemInstruction?.substring(0, 100)}...`
  );
  console.log(`👥 Respuesta en grupos permitida: ${allowGroupResponse}`);

  if (!clients[sessionId]) {
    clients[sessionId] = createClient(sessionId, systemInstruction);
    systemInstructions[sessionId] =
      systemInstruction || "Eres un asistente útil.";
    saveSystemInstruction(sessionId, systemInstructions[sessionId]);
    groupResponses[sessionId] = allowGroupResponse || false;
    saveGroupResponse(sessionId, groupResponses[sessionId]);
    console.log(`✅ Sesión ${sessionId} creada exitosamente`);
  } else {
    console.log(`⚠️  Sesión ${sessionId} ya existe`);
  }

  res.json({ success: true, sessionId: sessionId });
});

app.post("/start-session", (req, res) => {
  const { systemInstruction, allowGroupResponse } = req.body;
  const sessionId = uuidv4();;  // Generar ID único basado en timestamp
  console.log(`🔄 Iniciando nueva sesión: ${sessionId}`);
  console.log(
    `📝 Instrucción del sistema: ${systemInstruction?.substring(0, 100)}...`
  );
  console.log(`👥 Respuesta en grupos permitida: ${allowGroupResponse}`);

  if (!clients[sessionId]) {
    clients[sessionId] = createClient(sessionId, systemInstruction);
    systemInstructions[sessionId] =
      systemInstruction || "Eres un asistente útil.";
    saveSystemInstruction(sessionId, systemInstructions[sessionId]);
    groupResponses[sessionId] = allowGroupResponse || false;
    saveGroupResponse(sessionId, groupResponses[sessionId]);
    console.log(`✅ Sesión ${sessionId} creada exitosamente`);
  } else {
    console.log(`⚠️  Sesión ${sessionId} ya existe`);
  }

  res.redirect(`/qr/${sessionId}`);
});

app.get("/check-qr/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  console.log(`🔍 Verificando QR para sesión: ${sessionId}`);

  const client = clients[sessionId];

  if (!client) {
    console.log(`❌ Sesión no encontrada: ${sessionId}`);
    return res.status(404).json({
      success: false,
      error: "Session not found",
      sessionId: sessionId,
    });
  }

  try {
    const status = {
      success: true,
      sessionId: sessionId,
      isReady: client.isReady,
      hasQR: !!client.qrUrl,
      qrUrl: client.qrUrl || null,
      timestamp: new Date().toISOString(),
    };

    // Determinar el estado y mensaje apropiado
    if (client.isReady) {
      status.state = "authenticated";
      status.message = "Client is authenticated and ready";
      console.log(`✅ Cliente listo para sesión: ${sessionId}`);
    } else if (client.qrUrl) {
      status.state = "qr_ready";
      status.message = "QR code is ready for scanning";
      console.log(`📱 QR disponible para sesión: ${sessionId}`);
    } else {
      status.state = "initializing";
      status.message = "QR code is being generated";
      console.log(`⏳ Generando QR para sesión: ${sessionId}`);
    }

    // Para compatibilidad con código existente
    status.ready = client.isReady || !!client.qrUrl;

    if (client.qrUrl) {
      res.json({ ready: true, qrUrl: client.qrUrl });
    } else {
      res.json({ ready: false });
    }

    // res.json(status);
  } catch (error) {
    console.error(`❌ Error verificando QR para ${sessionId}:`, error);
    res.json({ ready: false, qrUrl: '' });
  }
});

app.get("/qr/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  console.log(`📱 Acceso a página QR para sesión: ${sessionId}`);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ sessionId: sessionId }));
});

app.get("/broadcast-ui", (req, res) => {
  console.log("📢 Acceso a interfaz de broadcast");
  res.sendFile(__dirname + "/public/broadcast.html");
});

app.get("/conversation", (req, res) => {
  console.log("📢 Acceso a interfaz de broadcast");
  res.sendFile(__dirname + "/public/broadcast.html");
});

app.post("/broadcast", upload.none(), async (req, res) => {
  const { sessionId, message, contactListSelected } = req.body;
  console.log(`📢 Iniciando broadcast para sesión: ${sessionId}`);
  console.log(`📝 Mensaje: ${message?.substring(0, 100)}...`);

  try {
    const contactList = JSON.parse(contactListSelected);
    console.log(`👥 Contactos seleccionados: ${contactList?.length || 0}`);

    const client = clients[sessionId];
    if (!client) {
      console.log(`❌ Sesión no encontrada para broadcast: ${sessionId}`);
      return res.status(404).json({ error: "Session not found" });
    }

    let contacts;

    if (!client.info) {
      console.log(`🔄 Reinicializando cliente para broadcast`);
      client.initialize();
    }

    if (contactList && Array.isArray(contactList)) {
      console.log(`📋 Obteniendo lista de contactos...`);
      const allContacts = await client.getContacts();
      const allContactIds = allContacts.map(
        (contact) => contact.id._serialized
      );

      contacts = allContactIds.filter((contactNumber) =>
        contactList.some((number) => contactNumber.includes(number))
      );

      console.log(`📤 Enviando broadcast a ${contacts.length} contactos`);
      const results = [];

      for (const contact of contacts) {
        try {
          console.log(`📨 Enviando mensaje a: ${contact}`);
          await client.sendMessage(contact, message);
          results.push({ contact, success: true });
        } catch (sendError) {
          console.error(`❌ Error enviando a ${contact}:`, sendError);
          results.push({ contact, success: false, error: sendError.message });
        }
      }
    }

    const successCount = contacts?.length || 0;
    console.log(`✅ Broadcast completado: ${successCount} contactos`);

    res.json({
      success: true,
      message: `Broadcast sent to ${successCount} contacts.`,
      invalidContacts:
        contactList?.filter((number) => !contacts?.includes(number)) || [],
    });
  } catch (error) {
    console.error("❌ Error en broadcast:", error);
    res.status(500).json({ error: "Failed to send broadcast" });
  }
});

app.get("/admin", (req, res) => {
  console.log("⚙️  Acceso a panel de administración");
  res.sendFile(__dirname + "/public/admin.html");
});

app.get("/sessions", (req, res) => {
  console.log("📋 Obteniendo lista de sesiones activas");
  const sessionList = Object.keys(clients).map((sessionId) => ({
    sessionId,
    systemInstruction: systemInstructions[sessionId],
    allowGroupResponse: groupResponses[sessionId],
    status: clients[sessionId]?.getStatus() || { isReady: false },
  }));
  console.log(`📊 Sesiones activas: ${sessionList.length}`);
  res.json(sessionList);
});

app.post("/update-session", (req, res) => {
  const { sessionId, systemInstruction, allowGroupResponse } = req.body;
  console.log(`🔄 Actualizando sesión: ${sessionId}`);
  console.log(
    `📝 Nueva instrucción: ${systemInstruction?.substring(0, 100)}...`
  );
  console.log(`👥 Nueva configuración grupal: ${allowGroupResponse}`);

  if (clients[sessionId]) {
    systemInstructions[sessionId] = systemInstruction;
    groupResponses[sessionId] = allowGroupResponse;

    saveSystemInstruction(sessionId, systemInstruction);
    saveGroupResponse(sessionId, allowGroupResponse);
    console.log(`✅ Sesión ${sessionId} actualizada exitosamente`);
    res.json({ success: true });
  } else {
    console.log(`⚠️  Sesión ${sessionId} no encontrada para actualizar`);
    res.json({ success: false });
  }

  res.json({ success: true });
});

app.post("/end-session", async (req, res) => {
  const { sessionId } = req.body;
  console.log(`🛑 Finalizando sesión: ${sessionId}`);

  if (clients[sessionId]) {
    try {
      console.log(`🔌 Destruyendo cliente para sesión: ${sessionId}`);
      await clients[sessionId].logout();
      await clients[sessionId].destroy();
    } catch (error) {
      console.error(`❌ Error finalizando sesión ${sessionId}:`, error);
    }

    delete clients[sessionId];
    delete systemInstructions[sessionId];
    delete groupResponses[sessionId];

    const sessionPath = `${SESSION_DIR}${sessionId}`;
    const instructionsPath = `${INSTRUCTIONS_DIR}${sessionId}.txt`;
    const groupResponsePath = `${GROUP_RESPONSE_DIR}${sessionId}.txt`;

    // Limpiar archivos de sesión
    const filesToDelete = [
      { path: sessionPath, isDir: true },
      { path: instructionsPath, isDir: false },
      { path: groupResponsePath, isDir: false },
    ];

    filesToDelete.forEach(({ path, isDir }) => {
      try {
        if (fs.existsSync(path)) {
          if (isDir) {
            fs.rmSync(path, { recursive: true, force: true });
          } else {
            fs.unlinkSync(path);
          }
          console.log(`🗑️  Eliminado: ${path}`);
        }
      } catch (deleteError) {
        console.error(`❌ Error eliminando ${path}:`, deleteError);
      }
    });

    console.log(`✅ Sesión ${sessionId} finalizada y archivos eliminados`);
  } else {
    console.log(`⚠️  Sesión ${sessionId} no encontrada para finalizar`);
  }

  res.json({ success: true });
});

app.get("/contacts/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  console.log(`👥 Obteniendo contactos para sesión: ${sessionId}`);

  if (!clients[sessionId]) {
    console.log(`❌ Sesión no encontrada: ${sessionId}`);
    return res.status(404).json({ error: "Sesión no encontrada" });
  }

  try {
    const client = clients[sessionId];
    if (!client.info) {
      console.log(`🔄 Inicializando cliente para obtener contactos`);
      client.initialize();
    }

    console.log(`📋 Obteniendo lista de contactos...`);
    const contacts = await client.getContacts();

    // Filtrar solo usuarios normales (@c.us)
    const users = contacts
      .filter((contact) => contact.id.server === "c.us")
      .map((contact) => ({
        id: contact.id._serialized,
        name: contact.name || contact.pushname || contact.number,
      }));

    console.log(
      `✅ ${users.length} contactos obtenidos para sesión: ${sessionId}`
    );
    res.json(users);
  } catch (error) {
    console.error(`❌ Error obteniendo contactos para ${sessionId}:`, error);
    res.status(500).json({ error: "Error obteniendo contactos" });
  }
});

app.get("/sessions-status", (req, res) => {
  console.log("📊 Obteniendo estado de todas las sesiones");
  const status = Object.keys(clients).map((sessionId) => {
    const client = clients[sessionId];
    return {
      sessionId,
      status: client.getStatus(),
      hasSystemInstruction: !!systemInstructions[sessionId],
      allowGroupResponse: groupResponses[sessionId],
    };
  });
  res.json(status);
});

app.get("/api/chat/:sessionId/:chatId", async (req, res) => {
  const { sessionId, chatId } = req.params;
  console.log(`🔍 Obteniendo chat ${chatId} para sesión: ${sessionId}`);

  if (!clients[sessionId]) {
    console.log(`❌ Sesión no encontrada: ${sessionId}`);
    return res.status(404).json({
      success: false,
      error: "Sesión no encontrada",
    });
  }

  if (!clients[sessionId].isReady) {
    console.log(`⚠️ Cliente no está listo para sesión: ${sessionId}`);
    return res.status(503).json({
      success: false,
      error: "Cliente de WhatsApp no está listo",
    });
  }

  try {
    const chat = await clients[sessionId].getChatById(chatId);
    console.log(`✅ Chat obtenido: ${chat.name || chat.id}`);

    res.json({
      success: true,
      data: chat,
    });
  } catch (error) {
    console.error(`❌ Error obteniendo chat ${chatId}:`, error);
    res.status(404).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/chat/:sessionId/:chatId/messages", async (req, res) => {
  const { sessionId, chatId } = req.params;
  const { limit = 10 } = req.query;
  console.log(
    `📨 Obteniendo mensajes de chat ${chatId} para sesión: ${sessionId}`
  );

  if (!clients[sessionId]) {
    return res.status(404).json({
      success: false,
      error: "Sesión no encontrada",
    });
  }

  if (!clients[sessionId].isReady) {
    return res.status(503).json({
      success: false,
      error: "Cliente de WhatsApp no está listo",
    });
  }

  try {
    const messages = await clients[sessionId].getChatMessages(
      chatId,
      parseInt(limit)
    );
    console.log(`✅ ${messages.length} mensajes obtenidos`);

    res.json({
      success: true,
      data: {
        chatId,
        messageCount: messages.length,
        messages,
      },
    });
  } catch (error) {
    console.error(`❌ Error obteniendo mensajes:`, error);
    res.status(404).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/chats/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { type } = req.query; // 'group', 'individual', o undefined para todos
  console.log(`📋 Obteniendo chats para sesión: ${sessionId}`);

  if (!clients[sessionId]) {
    return res.status(404).json({
      success: false,
      error: "Sesión no encontrada",
    });
  }

  if (!clients[sessionId].isReady) {
    return res.status(503).json({
      success: false,
      error: "Cliente de WhatsApp no está listo",
    });
  }

  try {
    let chats = await clients[sessionId].getAllChatsDetailed();

    if (type === "group") {
      chats = chats.filter((chat) => chat.isGroup);
    } else if (type === "individual") {
      chats = chats.filter((chat) => !chat.isGroup);
    }

    console.log(`✅ ${chats.length} chats obtenidos`);

    res.json({
      success: true,
      data: {
        sessionId,
        totalChats: chats.length,
        chats,
      },
    });
  } catch (error) {
    console.error(`❌ Error obteniendo chats:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/chats/:sessionId/search/:query", async (req, res) => {
  const { sessionId, query } = req.params;
  console.log(`🔍 Buscando chats con "${query}" en sesión: ${sessionId}`);

  if (!clients[sessionId]) {
    return res.status(404).json({
      success: false,
      error: "Sesión no encontrada",
    });
  }

  if (!clients[sessionId].isReady) {
    return res.status(503).json({
      success: false,
      error: "Cliente de WhatsApp no está listo",
    });
  }

  try {
    const foundChats = await clients[sessionId].searchChatsByName(query);
    console.log(`✅ ${foundChats.length} chats encontrados`);

    res.json({
      success: true,
      data: {
        sessionId,
        searchQuery: query,
        foundChats: foundChats.length,
        chats: foundChats,
      },
    });
  } catch (error) {
    console.error(`❌ Error buscando chats:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/chat/:sessionId/:chatId/message", async (req, res) => {
  const { sessionId, chatId } = req.params;
  const { message } = req.body;
  console.log(`📤 Enviando mensaje a chat ${chatId} en sesión: ${sessionId}`);

  if (!message) {
    return res.status(400).json({
      success: false,
      error: "El mensaje es requerido",
    });
  }

  if (!clients[sessionId]) {
    return res.status(404).json({
      success: false,
      error: "Sesión no encontrada",
    });
  }

  if (!clients[sessionId].isReady) {
    return res.status(503).json({
      success: false,
      error: "Cliente de WhatsApp no está listo",
    });
  }

  try {
    const sentMessage = await clients[sessionId].sendMessage(chatId, message);
    console.log(`✅ Mensaje enviado exitosamente`);

    res.json({
      success: true,
      data: {
        messageId: sentMessage.id._serialized,
        timestamp: sentMessage.timestamp,
        chatId,
        message,
      },
    });
  } catch (error) {
    console.error(`❌ Error enviando mensaje:`, error);
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

// Manejo de errores no capturados
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📅 Iniciado el: ${new Date().toLocaleString()}`);
  restoreSessions();
});
