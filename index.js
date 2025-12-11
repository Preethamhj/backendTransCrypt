require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/auth"); // mongoose user model
const authRoutes = require("./routes/auth");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ----------------- MongoDB -----------------
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => {
    console.log("MongoDB Error:", err);
    process.exit(1);
  });

// ----------------- API Routes -----------------
app.use("/api/auth", authRoutes);

// ----------------- WebSocket -----------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// users map
/*
  users: Map<WebSocket, {
    id: socketId,          // s_#
    userId: <db id>,
    name,
    email,
    publicIP
  }>
*/
const users = new Map();
let socketCounter = 1;

// helper: broadcast to ALL
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// helper: convert users map → array
function getOnlineUsers() {
  return [...users.values()];
}

// helpers: find target
function findWsBySocketId(id) {
  for (const [ws, u] of users.entries()) {
    if (u.id === id) return ws;
  }
  return null;
}

function findWsByUserId(id) {
  for (const [ws, u] of users.entries()) {
    if (u.userId === id) return ws;
  }
  return null;
}

function findTarget(id) {
  return findWsBySocketId(id) || findWsByUserId(id);
}

// ----------------- WebSocket Events -----------------
wss.on("connection", (ws) => {
  const socketId = "s_" + socketCounter++;
  console.log(`[WS] Connected: ${socketId}`);

  // temp placeholder until registration
  users.set(ws, {
    id: socketId,
    userId: null,
    name: "Unknown",
    email: "",
    publicIP: null,
  });

  // tell client its socket ID
  ws.send(
    JSON.stringify({
      type: "register_ack",
      socketId,
    })
  );

  // ========= MESSAGE HANDLER =========
  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (e) {
      console.log("[WS] Invalid JSON");
      return;
    }

    const sender = users.get(ws);

    // =================== REGISTER ===================
    if (data.type === "register") {
      try {
        const dbUser = await User.findById(data.userId).lean();
        if (!dbUser) {
          console.log("[WS] Register failed: user not found");
          return;
        }

        users.set(ws, {
          id: socketId,
          userId: dbUser._id.toString(),
          name: dbUser.name,
          email: dbUser.email,
          publicIP: null,
        });

        console.log(
          `[WS] Registered: ${socketId} → ${dbUser.name} (${dbUser._id})`
        );

        // send updated online users to ALL
        broadcast({
          type: "online_users",
          users: getOnlineUsers(),
        });

        return;
      } catch (err) {
        console.log("[WS] Register error:", err);
        return;
      }
    }

    // ================= PUBLIC_IP =================
    if (data.type === "public_ip") {
      if (!sender.userId) {
        console.log("[WS] Ignored public_ip from unregistered user");
        return;
      }

      const target = findTarget(data.to);
      sender.publicIP = data.ip;

      if (target && target.readyState === WebSocket.OPEN) {
        target.send(
          JSON.stringify({
            type: "public_ip",
            ip: data.ip,
            from: sender.userId || sender.id,
            name: sender.name,
          })
        );
      } else {
        console.log("[WS] public_ip target not found:", data.to);
      }
      return;
    }

    // ================= SIGNAL (WebRTC) =================
    if (data.type === "signal") {
      if (!sender.userId) {
        console.log("[WS] Ignored signal from unregistered user");
        return;
      }

      const targetWs = findTarget(data.to);
      if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
        console.log("[WS] Signal target not found:", data.to);
        return;
      }

      targetWs.send(
        JSON.stringify({
          type: "signal",
          from: sender.userId || sender.id,
          data: data.data,
        })
      );

      console.log(
        `[WS] SIGNAL → ${data.to} | action: ${data?.data?.action || "unknown"}`
      );

      return;
    }

    console.log("[WS] Unknown type:", data.type);
  });

  // =================== DISCONNECT ===================
  ws.on("close", () => {
    const user = users.get(ws);
    users.delete(ws);

    console.log(
      `[WS] Disconnected: ${user?.name || user?.id || "unknown user"}`
    );

    // notify everyone someone left
    broadcast({
      type: "user_left",
      user,
    });

    // also send updated online list
    broadcast({
      type: "online_users",
      users: getOnlineUsers(),
    });
  });

  // error event
  ws.on("error", (err) => {
    console.log("[WS] Socket error:", err);
  });
});

// ----------------- LAUNCH -----------------
server.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
