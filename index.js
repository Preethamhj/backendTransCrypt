require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/auth");

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

const users = new Map(); // ws => { id, userId, name, email, publicIP }
let counter = 1;

// broadcast helper
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

wss.on("connection", ws => {

  const socketId = "s_" + counter++;

  // Placeholder user (unregistered)
  users.set(ws, {
    id: socketId,
    userId: null,
    name: "Unknown User",
    email: "unknown",
    publicIP: null
  });

  console.log("Client connected:", socketId);

  // Send list of online users to new connection
  ws.send(JSON.stringify({
    type: "online_users",
    users: [...users.values()]
  }));

  // helper: find ws by userId
  function findWsByUserId(userId) {
    for (const [wsocket, info] of users.entries()) {
      if (info.userId === userId) return wsocket;
    }
    return null;
  }

  // incoming WS messages
  ws.on("message", async msg => {
    const data = JSON.parse(msg.toString());
    console.log("WS Message:", data);

    // ---------------- REGISTER -------------------
    if (data.type === "register") {
      try {
        const userId = data.userId;
        const dbUser = await User.findById(userId).lean();

        if (!dbUser) return;

        users.set(ws, {
          id: socketId,
          userId: dbUser._id.toString(),
          name: dbUser.name,
          email: dbUser.email,
          publicIP: null
        });

        console.log(`${socketId} registered as ${dbUser.name}`);

        // broadcast updated list
        broadcast({
          type: "online_users",
          users: [...users.values()]
        });

      } catch (err) {
        console.error("Register error:", err);
      }
    }

    // ---------------- PUBLIC IP EXCHANGE -------------------
    if (data.type === "public_ip") {
      const user = users.get(ws);
      user.publicIP = data.ip;

      console.log(`Public IP from ${user.name}: ${data.ip}`);

      const targetUserId = data.to;
      const targetWs = findWsByUserId(targetUserId);

      if (targetWs) {
        targetWs.send(JSON.stringify({
          type: "public_ip",
          ip: data.ip,
          from: user.userId,
          name: user.name
        }));
      }

      return;
    }

    // ---------------- WebRTC / Signals -------------------
    if (data.type === "signal_to") {
      const targetWs = findWsByUserId(data.to);
      if (targetWs) {
        targetWs.send(JSON.stringify({
          type: "signal",
          from: data.from,
          data: data.data
        }));
      }
      return;
    }

  });

  // ---------------- DISCONNECT -------------------
  ws.on("close", () => {
    const usr = users.get(ws);
    users.delete(ws);
    console.log("Client disconnected:", usr.id);

    broadcast({
      type: "user_left",
      user: usr
    });
  });
});

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
