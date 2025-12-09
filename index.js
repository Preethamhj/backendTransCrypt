require('dotenv').config(); // must be at the very top
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
const onlineUsers = new Map(); 
// key: socket_id   value: user info (id, name)

const mongoURI = process.env.MONGO_URL;
mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB Atlas connected"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1); 
  });

app.use("/api/auth", authRoutes);

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let socketCounter = 0; // unique socket id generator

wss.on("connection", (ws) => {
  const socketId = `s_${socketCounter++}`;

  console.log("Client connected:", socketId);

  // TEMP until login is integrated
  onlineUsers.set(socketId, {
    id: socketId,
    name: "Unknown User",
  });

  // Notify THIS client of the current list
  ws.send(JSON.stringify({
    type: "online_users",
    users: Array.from(onlineUsers.values())
  }));

  // Notify EVERYONE that a user came online
  broadcast({
    type: "user_joined",
    user: onlineUsers.get(socketId)
  });

  // When server receives message
  ws.on("message", (msg) => {
    console.log("WS Message:", msg.toString());
  });

  // On disconnect
  ws.on("close", () => {
    const user = onlineUsers.get(socketId);
    onlineUsers.delete(socketId);

    console.log("Client disconnected:", socketId);

    broadcast({
      type: "user_left",
      user
    });
  });
});

function broadcast(data) {
  const json = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}



server.listen(port, () => console.log(`Server running on port ${port}`));
