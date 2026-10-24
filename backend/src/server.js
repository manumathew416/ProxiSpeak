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

app.use(cors());
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"]
    }
});

const PROXIMITY_RADIUS = 100;

app.get("/api/health", (req, res) => {
    res.json({
        status: "ProxiSpeak backend is running"
    });
});

// Calculate distance between two users
function calculateDistance(position1, position2) {
    const dx = position1[0] - position2[0];
    const dy = position1[1] - position2[1];

    return Math.sqrt(dx * dx + dy * dy);
}

// Check whether two users are close enough
async function areUsersNearby(socketId1, socketId2) {
    const users = await User.find({
        socketId: {
            $in: [socketId1, socketId2]
        }
    }).select("socketId position");

    if (users.length !== 2) {
        return false;
    }

    const user1 = users.find(
        (user) => user.socketId === socketId1
    );

    const user2 = users.find(
        (user) => user.socketId === socketId2
    );

    if (!user1 || !user2) {
        return false;
    }

    return (
        calculateDistance(
            user1.position,
            user2.position
        ) <= PROXIMITY_RADIUS
    );
}

io.on("connection", async (socket) => {
    console.log(`User connected: ${socket.id}`);

    try {
        const user = await User.create({
            socketId: socket.id,
            username: `User-${socket.id.slice(0, 5)}`,
            position: [400, 250]
        });

        console.log(`User saved: ${user.username}`);

        // Handle avatar movement
        socket.on("avatar:move", async (data) => {
            try {
                const { x, y } = data || {};

                if (
                    typeof x !== "number" ||
                    typeof y !== "number" ||
                    !Number.isFinite(x) ||
                    !Number.isFinite(y) ||
                    x < 0 || x > 800 ||
                    y < 0 || y > 500
                ) {
                    return;
                }

                await User.findOneAndUpdate(
                    { socketId: socket.id },
                    { position: [x, y] }
                );

                // Synchronize avatar movement
                socket.broadcast.emit("avatar:moved", {
                    userId: socket.id,
                    username: user.username,
                    x,
                    y
                });

                // Find nearby users
                const nearbyUsers = await User.find({
                    socketId: {
                        $ne: socket.id
                    },
                    position: {
                        $near: [x, y],
                        $maxDistance: PROXIMITY_RADIUS
                    }
                }).select("socketId username position");

                socket.emit("proximity:update", {
                    nearbyUsers: nearbyUsers.map(
                        (nearbyUser) => ({
                            userId: nearbyUser.socketId,
                            username: nearbyUser.username,
                            x: nearbyUser.position[0],
                            y: nearbyUser.position[1]
                        })
                    )
                });

                console.log(
                    `${user.username}: ${nearbyUsers.length} nearby user(s)`
                );
            } catch (error) {
                console.error(
                    "Avatar movement error:",
                    error.message
                );
            }
        });

        // Validate proximity before relaying WebRTC offers
        socket.on(
            "webrtc:offer",
            async ({ targetUserId, offer } = {}) => {
                try {
                    if (!targetUserId || !offer) {
                        return;
                    }

                    const nearby = await areUsersNearby(
                        socket.id,
                        targetUserId
                    );

                    if (!nearby) {
                        console.log(
                            "Offer rejected: users are not nearby"
                        );
                        return;
                    }

                    io.to(targetUserId).emit(
                        "webrtc:offer",
                        {
                            senderUserId: socket.id,
                            offer
                        }
                    );
                } catch (error) {
                    console.error(
                        "WebRTC offer error:",
                        error.message
                    );
                }
            }
        );

        // Validate proximity before relaying WebRTC answers
        socket.on(
            "webrtc:answer",
            async ({ targetUserId, answer } = {}) => {
                try {
                    if (!targetUserId || !answer) {
                        return;
                    }

                    const nearby = await areUsersNearby(
                        socket.id,
                        targetUserId
                    );

                    if (!nearby) {
                        return;
                    }

                    io.to(targetUserId).emit(
                        "webrtc:answer",
                        {
                            senderUserId: socket.id,
                            answer
                        }
                    );
                } catch (error) {
                    console.error(
                        "WebRTC answer error:",
                        error.message
                    );
                }
            }
        );

        // Validate proximity before relaying ICE candidates
        socket.on(
            "webrtc:ice-candidate",
            async ({ targetUserId, candidate } = {}) => {
                try {
                    if (!targetUserId || !candidate) {
                        return;
                    }

                    const nearby = await areUsersNearby(
                        socket.id,
                        targetUserId
                    );

                    if (!nearby) {
                        return;
                    }

                    io.to(targetUserId).emit(
                        "webrtc:ice-candidate",
                        {
                            senderUserId: socket.id,
                            candidate
                        }
                    );
                } catch (error) {
                    console.error(
                        "WebRTC ICE error:",
                        error.message
                    );
                }
            }
        );

        // Remove disconnected user from MongoDB
        socket.on("disconnect", async () => {
            console.log(
                `User disconnected: ${socket.id}`
            );

            try {
                await User.findOneAndDelete({
                    socketId: socket.id
                });

                // Inform clients that this avatar disappeared
                socket.broadcast.emit(
                    "avatar:left",
                    {
                        userId: socket.id
                    }
                );
            } catch (error) {
                console.error(
                    "User cleanup error:",
                    error.message
                );
            }
        });
    } catch (error) {
        console.error(
            "Socket user error:",
            error.message
        );

        socket.disconnect(true);
    }
});

const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        await connectDB();

        server.listen(PORT, () => {
            console.log(
                `ProxiSpeak server running on http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error(
            "Failed to start server:",
            error.message
        );
    }
}

startServer();