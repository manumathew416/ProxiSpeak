
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");

const connectDB = require("./config/database");
const User = require("./models/user");

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 5000;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PROXIMITY_RADIUS = 100;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        status: "ProxiSpeak backend is running",
    });
});

// Calculate distance between two users
function calculateDistance(position1, position2) {
    const dx = position1[0] - position2[0];
    const dy = position1[1] - position2[1];

    return Math.sqrt(dx * dx + dy * dy);
}

// Check whether two connected users are within earshot
async function areUsersNearby(socketId1, socketId2) {
    const users = await User.find({
        socketId: { $in: [socketId1, socketId2] },
    });

    if (users.length !== 2) {
        return false;
    }

    return (
        calculateDistance(users[0].position, users[1].position) <
        PROXIMITY_RADIUS
    );
}

// Send an updated nearby-user list to every connected client
async function broadcastProximityUpdates() {
    const users = await User.find(
        {},
        { socketId: 1, username: 1, position: 1 }
    );

    for (const currentUser of users) {
        const nearbyUsers = users
            .filter((otherUser) => {
                if (otherUser.socketId === currentUser.socketId) {
                    return false;
                }

                return (
                    calculateDistance(
                        currentUser.position,
                        otherUser.position
                    ) < PROXIMITY_RADIUS
                );
            })
            .map((otherUser) => ({
                userId: otherUser.socketId,
                username: otherUser.username,
                x: otherUser.position[0],
                y: otherUser.position[1],
            }));

        io.to(currentUser.socketId).emit(
            "proximity:update",
            nearbyUsers
        );
    }
}

// WebRTC signaling relay with proximity validation
async function relayWebRTCEvent(
    socket,
    eventName,
    payload,
    dataKey
) {
    try {
        const { targetUserId } = payload || {};
        const data = payload?.[dataKey];

        if (
            typeof targetUserId !== "string" ||
            !targetUserId ||
            !data
        ) {
            return;
        }

        const nearby = await areUsersNearby(
            socket.id,
            targetUserId
        );

        if (!nearby) {
            socket.emit("webrtc:error", {
                message: "User is outside the audio range.",
            });
            return;
        }

        io.to(targetUserId).emit(eventName, {
            senderUserId: socket.id,
            [dataKey]: data,
        });
    } catch (error) {
        console.error(`${eventName} error:`, error.message);
    }
}

// Socket.io connections
io.on("connection", async (socket) => {
    console.log("User connected:", socket.id);

    try {
        const user = await User.create({
            socketId: socket.id,
            username: `User-${socket.id.slice(0, 5)}`,
            position: [400, 250],
        });

        console.log("User saved:", user.username);

        // Send initial position to the newly connected client
        const existingUsers = await User.find({
            socketId: { $ne: socket.id },
        });

        existingUsers.forEach((existingUser) => {
            socket.emit("avatar:moved", {
                userId: existingUser.socketId,
                username: existingUser.username,
                x: existingUser.position[0],
                y: existingUser.position[1],
            });
        });

        // Notify other clients about the new user
        socket.broadcast.emit("avatar:moved", {
            userId: socket.id,
            username: user.username,
            x: user.position[0],
            y: user.position[1],
        });

        await broadcastProximityUpdates();
    } catch (error) {
        console.error("User initialization error:", error.message);
        socket.disconnect(true);
        return;
    }

    // Handle avatar movement
    socket.on("avatar:move", async ({ x, y } = {}) => {
        try {
            if (
                !Number.isFinite(x) ||
                !Number.isFinite(y) ||
                x < 0 ||
                x > CANVAS_WIDTH ||
                y < 0 ||
                y > CANVAS_HEIGHT
            ) {
                return;
            }

            const user = await User.findOneAndUpdate(
                { socketId: socket.id },
                { $set: { position: [x, y] } },
                { new: true }
            );

            if (!user) {
                return;
            }

            // Synchronize avatar position
            socket.broadcast.emit("avatar:moved", {
                userId: socket.id,
                username: user.username,
                x,
                y,
            });

            // Refresh nearby lists for all users
            await broadcastProximityUpdates();
        } catch (error) {
            console.error("Avatar movement error:", error.message);
        }
    });

    // WebRTC offer
    socket.on("webrtc:offer", async (payload) => {
        await relayWebRTCEvent(
            socket,
            "webrtc:offer",
            payload,
            "offer"
        );
    });

    // WebRTC answer
    socket.on("webrtc:answer", async (payload) => {
        await relayWebRTCEvent(
            socket,
            "webrtc:answer",
            payload,
            "answer"
        );
    });

    // WebRTC ICE candidate
    socket.on("webrtc:ice-candidate", async (payload) => {
        await relayWebRTCEvent(
            socket,
            "webrtc:ice-candidate",
            payload,
            "candidate"
        );
    });

    // Handle disconnection
    socket.on("disconnect", async () => {
        try {
            const user = await User.findOneAndDelete({
                socketId: socket.id,
            });

            if (user) {
                console.log("User disconnected:", user.username);

                socket.broadcast.emit("avatar:left", {
                    userId: socket.id,
                });

                await broadcastProximityUpdates();
            }
        } catch (error) {
            console.error("Disconnect cleanup error:", error.message);
        }
    });
});

// Start server after MongoDB connects
async function startServer() {
    try {
        await connectDB();

        server.listen(PORT, () => {
            console.log(`ProxiSpeak server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Server startup failed:", error.message);
        process.exit(1);
    }
}

startServer();
