
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const connectDB = require("./config/database");
const User = require("./models/user");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const AVATAR_SIZE = 20;
const PROXIMITY_RADIUS = 100;

app.use(cors());
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({ message: "ProxiSpeak backend is running" });
});

// Calculate distance between two users
const calculateDistance = (user1, user2) => {
    const dx = user1.position[0] - user2.position[0];
    const dy = user1.position[1] - user2.position[1];

    return Math.sqrt(dx * dx + dy * dy);
};

// Format user data for frontend
const formatUser = (user) => ({
    userId: user.socketId,
    username: user.username,
    x: user.position[0],
    y: user.position[1]
});

// Check whether two users are nearby
const areUsersNearby = async (socketId1, socketId2) => {
    try {
        const user1 = await User.findOne({ socketId: socketId1 });
        const user2 = await User.findOne({ socketId: socketId2 });

        if (!user1 || !user2) return false;

        return calculateDistance(user1, user2) <= PROXIMITY_RADIUS;
    } catch (error) {
        console.error("Proximity check error:", error.message);
        return false;
    }
};

// Send proximity updates to all connected users
const broadcastProximityUpdates = async () => {
    try {
        const users = await User.find();

        for (const user of users) {
            const nearbyUsers = [];

            for (const otherUser of users) {
                if (user.socketId === otherUser.socketId) continue;

                const distance = calculateDistance(user, otherUser);

                if (distance <= PROXIMITY_RADIUS) {
                    nearbyUsers.push({
                        userId: otherUser.socketId,
                        username: otherUser.username,
                        x: otherUser.position[0],
                        y: otherUser.position[1]
                    });
                }
            }

            io.to(user.socketId).emit("proximity:update", nearbyUsers);
        }
    } catch (error) {
        console.error("Proximity update error:", error.message);
    }
};

// Validate and relay WebRTC events
const relayWebRTCEvent = async (socket, eventName, data) => {
    try {
        if (!data || !data.target || !data.signal) return;

        const nearby = await areUsersNearby(socket.id, data.target);

        if (!nearby) {
            socket.emit("webrtc:error", {
                message: "Users must be within proximity to connect."
            });
            return;
        }

        io.to(data.target).emit(eventName, {
            sender: socket.id,
            signal: data.signal
        });
    } catch (error) {
        console.error(`WebRTC ${eventName} error:`, error.message);
    }
};

// Socket.IO connection
io.on("connection", async (socket) => {
    console.log("User connected:", socket.id);

    try {
        // Create the new user
        const user = await User.create({
            socketId: socket.id,
            username: `User-${socket.id.slice(0, 5)}`,
            position: [400, 250]
        });

        // Send existing users to the newly connected user
        const existingUsers = await User.find({
            socketId: { $ne: socket.id }
        });

        socket.emit(
            "users:initial",
            existingUsers.map(formatUser)
        );

        // Notify existing users about the new user
        socket.broadcast.emit("avatar:joined", formatUser(user));

        // Update proximity
        await broadcastProximityUpdates();

        // Handle avatar movement
        socket.on("avatar:move", async ({ x, y }) => {
            try {
                if (
                    typeof x !== "number" ||
                    typeof y !== "number" ||
                    !Number.isFinite(x) ||
                    !Number.isFinite(y)
                ) {
                    return;
                }

                const safeX = Math.max(
                    AVATAR_SIZE,
                    Math.min(CANVAS_WIDTH - AVATAR_SIZE, x)
                );

                const safeY = Math.max(
                    AVATAR_SIZE,
                    Math.min(CANVAS_HEIGHT - AVATAR_SIZE, y)
                );

                const updatedUser = await User.findOneAndUpdate(
                    { socketId: socket.id },
                    { position: [safeX, safeY] },
                    { new: true }
                );

                if (!updatedUser) return;

                // Broadcast movement to other users
                socket.broadcast.emit("avatar:moved", formatUser(updatedUser));

                await broadcastProximityUpdates();
            } catch (error) {
                console.error("Avatar movement error:", error.message);
            }
        });

        // WebRTC signaling
        socket.on("webrtc:offer", (data) => {
            relayWebRTCEvent(socket, "webrtc:offer", data);
        });

        socket.on("webrtc:answer", (data) => {
            relayWebRTCEvent(socket, "webrtc:answer", data);
        });

        socket.on("webrtc:ice-candidate", (data) => {
            relayWebRTCEvent(socket, "webrtc:ice-candidate", data);
        });

        // Handle disconnection
        socket.on("disconnect", async (reason) => {
            try {
                console.log("User disconnected:", socket.id, reason);

                const deletedUser = await User.findOneAndDelete({
                    socketId: socket.id
                });

                if (deletedUser) {
                    socket.broadcast.emit("avatar:left", {
                        userId: socket.id
                    });
                }

                await broadcastProximityUpdates();
            } catch (error) {
                console.error("Disconnect error:", error.message);
            }
        });

    } catch (error) {
        console.error("Socket connection setup error:", error.message);
        socket.disconnect(true);
    }
});

// Start server after MongoDB connection
connectDB().then(async () => {
    try {
        // Remove stale records from previous server sessions.
        // This assumes this server is the only process using this collection.
        const result = await User.deleteMany({});
        console.log(`Cleared ${result.deletedCount} old user records`);

        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Server startup error:", error.message);
        process.exit(1);
    }
});
