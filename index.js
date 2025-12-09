require('dotenv').config(); // must be at the very top
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

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

wss.on("connection", (ws) => {
  console.log("Client connected via WebSocket");

  ws.send(JSON.stringify({ msg: "Connected to TransCrypt Cloud" }));

  ws.on("message", (msg) => {
    console.log("Received:", msg.toString());
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});


server.listen(port, () => console.log(`Server running on port ${port}`));
