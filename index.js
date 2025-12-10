require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");

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

const users = new Map(); // key: ws | val: {id, name}
let counter = 1;

// broadcast helper
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

wss.on("connection", ws => {
  const id = "s_" + counter++;
  users.set(ws, { id, name: "Unknown" });

  console.log("Connected:", id);

  // send full user list to this client
  ws.send(JSON.stringify({
    type: "online_users",
    users: [...users.values()]
  }));

  // wait for register before telling others
  ws.on("message", async(msg) => {
    const data = JSON.parse(msg.toString());

    if (data.type === "register") {
    const userId = data.userId;  // sent from Flutter (JWT decoded ID)
    // Fetch user from DB
    const dbUser = await User.findById(userId).lean();
    if (dbUser) {
        onlineUsers.set(ws, {
            id: socketId,
            userId: dbUser._id.toString(),
            name: dbUser.name,
            email: dbUser.email,
        });
    }

    // Send updated list to everyone
    broadcast({
        type: "online_users",
        users: [...onlineUsers.values()],
    });

    console.log(`${socketId} registered as ${dbUser.name}`);
    }
  });

  ws.on("close", () => {
    const user = users.get(ws);
    users.delete(ws);

    console.log("Disconnected:", user.id);

    broadcast({
      type: "user_left",
      user
    });
  });
});

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
