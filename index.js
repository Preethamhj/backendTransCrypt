// backendTransCrypt/index.js

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const authRoutes = require('./routes/auth'); // For your existing auth endpoints
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Express Middleware
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// --- WebSocket Signaling Server Setup ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map to store connected clients: { userId: WebSocket }
const clients = new Map();

wss.on('connection', (ws, req) => {
    console.log('New client connected.');
    
    // 1. Initial Authentication and ID Registration (The "join" step)
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                const userId = data.userId;
                
                // Store connection
                clients.set(userId, ws);
                ws.userId = userId;
                
                console.log(`User ${userId} joined the signaling server.`);
                
                // Notify user of successful connection and provide connected users list
                ws.send(JSON.stringify({
                    type: 'join_success',
                    message: 'Successfully joined signaling server.',
                    users: Array.from(clients.keys()).filter(id => id !== userId) // Send other users
                }));
                
                // Notify all other users about the new user (for real-time update)
                clients.forEach((client, id) => {
                    if (id !== userId && client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'user_joined',
                            userId: userId
                        }));
                    }
                });
                
            } 
            // 2. Message Routing Logic
            else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate' || data.type === 'ready') {
                const targetId = data.targetId;
                const targetClient = clients.get(targetId);

                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    // Forward the message to the target peer
                    targetClient.send(JSON.stringify({
                        ...data,
                        senderId: ws.userId // Attach the original sender's ID
                    }));
                } else {
                    console.log(`Target user ${targetId} not found or not open.`);
                    // Optionally notify the sender that the target is offline
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `User ${targetId} is not available.`
                    }));
                }
            } else {
                console.log(`Received unknown message type: ${data.type}`);
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    // 3. Cleanup on Disconnect
    ws.on('close', () => {
        const disconnectedId = ws.userId;
        if (disconnectedId) {
            clients.delete(disconnectedId);
            console.log(`User ${disconnectedId} disconnected.`);
            
            // Notify remaining users that a user left
            clients.forEach((client, id) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'user_left',
                        userId: disconnectedId
                    }));
                }
            });
        }
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

// Start the combined HTTP/WebSocket server
server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});