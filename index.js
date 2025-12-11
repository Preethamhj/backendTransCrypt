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

// ---------------- MongoDB -----------------
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => { console.log("Mongo Error:", err); process.exit(1); });

app.use("/api/auth", authRoutes);

// ---------------- WebSocket -----------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = new Map();
let counter = 1;

// Helper: find WebSocket by socketId or userId
function findWsById(id) {
  for (const [ws, info] of users.entries()) {
    if (info.id === id || info.userId === id) return ws;
  }
  return null;
}

// Broadcast online users
function broadcastOnline() {
  const arr = [...users.values()];
  const msg = JSON.stringify({ type: "online_users", users: arr });
  wss.clients.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(msg));
}

// ---------------- Connection -----------------
wss.on("connection", ws => {
  const socketId = "s_" + counter++;
  users.set(ws, { id: socketId, userId: null, name: "Unknown", email: "unknown", publicIP: null });

  console.log(`[WS] Connected: ${socketId}`);

  ws.send(JSON.stringify({ type: "register_ack", socketId }));
  broadcastOnline();

  ws.on("message", async raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    const sender = users.get(ws);
    if (!sender) return;

    // REGISTER
    if (data.type === "register") {
      const dbUser = await User.findById(data.userId).lean();
      if (!dbUser) return;
      users.set(ws, { ...sender, userId: dbUser._id.toString(), name: dbUser.name, email: dbUser.email });
      console.log(`[WS] Registered: ${dbUser.name}`);
      broadcastOnline();
      return;
    }

    // PUBLIC IP EXCHANGE
    if (data.type === "public_ip") {
      sender.publicIP = data.ip;
      const targetWs = findWsById(data.to);
      if (!targetWs) return;
      targetWs.send(JSON.stringify({ type: "public_ip", from: sender.id, name: sender.name, ip: data.ip }));
      console.log(`[WS] PUBLIC_IP from ${sender.name} -> ${data.to}: ${data.ip}`);
      return;
    }

    // SIGNALING
    if (data.type === "signal") {
      const targetWs = findWsById(data.to);
      if (!targetWs) return;
      const forwardData = { ...data, from: sender.id };
targetWs.send(JSON.stringify(forwardData));
      return;
    }
  });

  ws.on("close", () => {
    const info = users.get(ws);
    users.delete(ws);
    broadcastOnline();
    console.log(`[WS] Disconnected: ${info?.id}`);
  });

  ws.on("error", err => console.log("[WS] error:", err));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
