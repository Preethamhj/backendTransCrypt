require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");

const User = require("./models/auth");
const authRoutes = require("./routes/auth");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

// ---------------- Express & MongoDB -----------------

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => {
    console.log("Mongo Error:", err);
    process.exit(1);
  });

app.use("/api/auth", authRoutes);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---------------- WebSocket State -----------------

const users = new Map();
let socketIdCounter = 1;

function findWsBySocketId(socketId) {
  for (const [ws, info] of users.entries()) {
    if (info.id === socketId) return ws;
  }
  return null;
}

function broadcastOnline() {
  const arr = [...users.values()]
    .filter(info => info.userId)
    .map(info => ({
      socketId: info.id,
      name: info.name,
      userId: info.userId
    }));

  const msg = JSON.stringify({ type: "online_users", users: arr });

  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ---------------- WebSocket Connection Handler -----------------

wss.on("connection", ws => {
  const socketId = "s_" + socketIdCounter++;
  users.set(ws, { id: socketId, userId: null, name: "Unknown" });

  console.log("[WS] Connected:", socketId);

  ws.send(JSON.stringify({ type: "register_ack", socketId }));
  broadcastOnline();

  ws.on("message", async raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      console.error("[WS] Invalid JSON from", socketId);
      return;
    }

    const sender = users.get(ws);
    if (!sender) return;

    console.log(`[WS] Received ${data.type} from ${sender.name || sender.id}`);

    // REGISTER USER
    if (data.type === "register") {
      try {
        const dbUser = await User.findById(data.userId).lean();
        if (!dbUser) {
          console.error("[WS] Registration failed: No user:", data.userId);
          return;
        }

        users.set(ws, {
          ...sender,
          userId: dbUser._id.toString(),
          name: dbUser.name
        });

        console.log("[WS] Registered:", dbUser.name, "(", sender.id, ")");
        broadcastOnline();
      } catch (err) {
        console.error("[WS] DB error:", err.message);
      }
      return;
    }

    // PUBLIC IP EXCHANGE
    if (data.type === "public_ip") {
      const targetWs = findWsBySocketId(data.to);
      if (!targetWs) return;

      const ipPayload = {
        type: "public_ip",
        from: sender.id,
        name: sender.name,
        ip: data.ip
      };

      targetWs.send(JSON.stringify(ipPayload));
      console.log(
        `[WS] PUBLIC_IP forwarded: ${sender.id} -> ${data.to}`
      );
      return;
    }

    // SIGNALING (offer, answer, candidate)
    if (data.type === "signal") {
      const targetWs = findWsBySocketId(data.to);
      if (!targetWs) return;

      const forwardData = {
        type: "signal",
        data: { ...data.data, from: sender.id }
      };

      targetWs.send(JSON.stringify(forwardData));
      console.log(
        `[WS] SIGNAL forwarded: ${data.data.action} from ${sender.id} -> ${data.to}`
      );
      return;
    }
  });

  ws.on("close", () => {
    const info = users.get(ws);
    users.delete(ws);
    setTimeout(broadcastOnline, 100);
    console.log("[WS] Disconnected:", info?.name || info?.id);
  });

  ws.on("error", err => {
    console.log("[WS] Error:", err);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
