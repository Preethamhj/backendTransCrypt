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

const users = new Map();  // ws => { id, userId, name, email }
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

  // Temporary placeholder until registration
  users.set(ws, {
    id: socketId,
    userId: null,
    name: "Unknown User",
    email: "unknown"
  });

  console.log("Client connected:", socketId);

  // Send current online list to this user
  ws.send(JSON.stringify({
    type: "online_users",
    users: [...users.values()]
  }));

  // helper: find ws by userId
function findWsByUserId(userId) {
  for (const [ws, info] of users.entries()) {
    if (info.userId === userId) return ws;
  }
  return null;
}

ws.on("message", async (msg) => {
  const data = JSON.parse(msg.toString());
  console.log("WS Message:", data);

  // registration handling (already implemented)...

  // ---- P2P Request (initiator asks target for permission) ----
  if (data.type === "p2p_request") {
    const targetId = data.to;
    const targetWs = findWsByUserId(targetId);
    if (!targetWs) {
      // notify caller target not available
      ws.send(JSON.stringify({ type: "p2p_error", message: "Target offline", to: data.from }));
      return;
    }

    // forward request to callee
    targetWs.send(JSON.stringify({
      type: "p2p_request",
      from: data.from,
      meta: data.meta || {}
    }));
  }

  // ---- P2P Response (callee accepts/declines) ----
  if (data.type === "p2p_response") {
    const callerId = data.to;
    const callerWs = findWsByUserId(callerId);
    if (callerWs) {
      callerWs.send(JSON.stringify({
        type: "p2p_response",
        from: data.from,
        accepted: !!data.accepted
      }));
    }
  }

  // ---- WebRTC Offer/Answer & ICE relaying ----
  if (data.type === "webrtc_offer" || data.type === "webrtc_answer" || data.type === "ice_candidate") {
    const targetId = data.to;
    const targetWs = findWsByUserId(targetId);
    if (targetWs) {
      targetWs.send(JSON.stringify(data)); // relay entire object
    } else {
      ws.send(JSON.stringify({ type: "p2p_error", message: "Target offline", to: data.from }));
    }
  }

  // ... keep existing register handling and others
});


  // Handle incoming messages
  ws.on("message", async (msg) => {
    const data = JSON.parse(msg.toString());
    console.log("WS Message:", data);

    // Handle register event
    if (data.type === "register") {
      try {
        const userId = data.userId;
        const dbUser = await User.findById(userId).lean();

        if (!dbUser) {
          console.log("User not found:", userId);
          return;
        }

        // Update user info
        users.set(ws, {
          id: socketId,
          userId: dbUser._id.toString(),
          name: dbUser.name,
          email: dbUser.email
        });

        console.log(`${socketId} registered as ${dbUser.name}`);

        // Broadcast updated list
        broadcast({
          type: "online_users",
          users: [...users.values()]
        });

      } catch (err) {
        console.error("Register error:", err);
      }
    }
  });

  // On disconnect
  ws.on("close", () => {
    const user = users.get(ws);
    users.delete(ws);

    console.log("Client disconnected:", user.id);

    broadcast({
      type: "user_left",
      user
    });
  });
});


server.listen(PORT, () => console.log(`Server running on ${PORT}`));
