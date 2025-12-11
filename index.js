require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/auth"); // your mongoose user model

const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// ------------------- MongoDB -------------------
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => {
    console.log("Mongo Error:", err);
    process.exit(1);
  });

app.use("/api/auth", authRoutes);

// ------------------- WebSocket -------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/*
  users: Map<WebSocket, {
    id: socketId,           // s_#
    userId: <db user id>?,  // mongodb id when registered
    name, email, publicIP
  }>
*/
const users = new Map();
let counter = 1;

// helpers
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function findWsBySocketId(socketId) {
  for (const [ws, info] of users.entries()) {
    if (info.id === socketId) return ws;
  }
  return null;
}

function findWsByUserId(userId) {
  for (const [ws, info] of users.entries()) {
    if (info.userId === userId) return ws;
  }
  return null;
}

function findWsByEitherId(eitherId) {
  // either socketId or userId
  let ws = findWsBySocketId(eitherId);
  if (ws) return ws;
  return findWsByUserId(eitherId);
}

wss.on("connection", ws => {
  const socketId = "s_" + counter++;

  // placeholder (unregistered)
  users.set(ws, {
    id: socketId,
    userId: null,
    name: "Unknown User",
    email: "unknown",
    publicIP: null
  });

  console.log(`[WS] Client connected: ${socketId}`);

  // Immediately send register_ack with socketId (client expects this)
  ws.send(JSON.stringify({
    type: "register_ack",
    socketId
  }));

  // send current online_users to this new socket (and broadcast will update others when register happens)
  ws.send(JSON.stringify({
    type: "online_users",
    users: [...users.values()]
  }));

  ws.on("message", async raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      console.log("[WS] Invalid JSON:", raw.toString());
      return;
    }

    console.log("[WS] Message from", socketId, ":", data);

    // ---------- REGISTER ----------
    if (data.type === "register") {
      try {
        const userId = data.userId;
        const dbUser = await User.findById(userId).lean();
        if (!dbUser) {
          console.log(`[WS] Register failed: user ${userId} not found`);
          return;
        }

        users.set(ws, {
          id: socketId,
          userId: dbUser._id.toString(),
          name: dbUser.name,
          email: dbUser.email,
          publicIP: null
        });

        console.log(`[WS] ${socketId} registered as ${dbUser.name} (${dbUser._id})`);

        broadcast({
          type: "online_users",
          users: [...users.values()]
        });

        return;
      } catch (err) {
        console.error("[WS] Register error:", err);
        return;
      }
    }

    // ---------- PUBLIC IP ----------
    if (data.type === "public_ip") {
      // data: { type: "public_ip", ip, to: <socketId|userId>, name? }
      const sender = users.get(ws);
      if (!sender) return;

      sender.publicIP = data.ip;
      console.log(`[WS] PUBLIC_IP from ${sender.name} (${sender.userId || sender.id}): ${data.ip} -> target ${data.to}`);

      // Find target by either socketId or userId
      const targetWs = findWsByEitherId(data.to);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({
          type: "public_ip",
          ip: data.ip,
          from: sender.userId || sender.id,
          name: sender.name
        }));
        console.log(`[WS] Forwarded PUBLIC_IP to ${data.to}`);
      } else {
        console.log(`[WS] PUBLIC_IP target not found: ${data.to}`);
      }
      return;
    }

    // ---------- SIGNAL (from client we expect type: "signal") ----------
    // Support both "signal" and "signal_to" for backwards compatibility.
    // Client format expected: { type: "signal", to: <socketId|userId>, data: { action: "...", ... }, from?: <senderId> }
    if (data.type === "signal" || data.type === "signal_to") {
      const payload = data.data || data.payload || data.signal;
      const toId = data.to;
      const fromId = data.from || (users.get(ws)?.userId || users.get(ws)?.id);

      if (!payload || !toId) {
        console.log("[WS] Bad signal message - missing 'to' or 'data'");
        return;
      }

      const targetWs = findWsByEitherId(toId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        // forward in shape client expects: { type: "signal", data: payload, from: <fromId> }
        targetWs.send(JSON.stringify({
          type: "signal",
          from: fromId,
          data: payload
        }));
        console.log(`[WS] Forwarded SIGNAL action='${payload.action}' from ${fromId} -> ${toId}`);
      } else {
        console.log(`[WS] SIGNAL target not found or not open: ${toId}`);
      }
      return;
    }

    // unknown type
    console.log("[WS] Unknown message type:", data.type);
  });

  ws.on("close", () => {
    const usr = users.get(ws);
    users.delete(ws);
    console.log(`[WS] Client disconnected: ${usr?.id || socketId}`);

    // broadcast user_left
    broadcast({
      type: "user_left",
      user: usr
    });
  });

  ws.on("error", (err) => {
    console.error("[WS] socket error:", err);
  });
});

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
