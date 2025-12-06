require('dotenv').config(); // must be at the very top
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");

const app = express();
const port = process.env.PORT || 5000;

// Express middleware
app.use(express.json());

// MongoDB connection
const mongoURI = process.env.MONGO_URL;
mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB Atlas connected"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // stop server if DB fails
  });

// Routes
app.use("/api/auth", authRoutes);

// --- WebSocket Server ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "join") {
        const userId = data.userId;
        clients.set(userId, ws);
        ws.userId = userId;

        ws.send(JSON.stringify({
          type: "join_success",
          message: "Joined signaling server",
          users: Array.from(clients.keys()).filter(id => id !== userId)
        }));

        clients.forEach((client, id) => {
          if (id !== userId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "user_joined", userId }));
          }
        });
      } else if (["offer","answer","ice-candidate","ready"].includes(data.type)) {
        const targetClient = clients.get(data.targetId);
        if (targetClient && targetClient.readyState === WebSocket.OPEN) {
          targetClient.send(JSON.stringify({ ...data, senderId: ws.userId }));
        } else {
          ws.send(JSON.stringify({ type: "error", message: `User ${data.targetId} not available` }));
        }
      }
    } catch(err) {
      console.error("WebSocket message error:", err);
    }
  });

  ws.on("close", () => {
    const disconnectedId = ws.userId;
    if (disconnectedId) {
      clients.delete(disconnectedId);
      clients.forEach((client) => {
        if(client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "user_left", userId: disconnectedId }));
        }
      });
    }
  });

  ws.on("error", (err) => console.error("WebSocket error:", err));
});

server.listen(port, () => console.log(`Server running on port ${port}`));
