
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

// Basic health check
app.get("/api/health", (req, res) => {
    res.json({
        status: "ProxiSpeak backend is running"
    });
});

// Socket.io connection
io.on("connection", async (socket) => {
    console.log(`User connected: ${socket.id}`);

    try {
        const user = await User.create({
            socketId: socket.id,
            username: `User-${socket.id.slice(0, 5)}`,
            position: [400, 250]
        });

        console.log(`User saved: ${user.username}`);

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

                // Update the current user's position
                await User.findOneAndUpdate(
                    { socketId: socket.id },
                    { position: [x, y] }
                );

                // Broadcast movement to other users
                socket.broadcast.emit("avatar:moved", {
                    userId: socket.id,
                    username: user.username,
                    x,
                    y
                });

                // Find users within 100 pixels
                const nearbyUsers = await User.find({
                    socketId: { $ne: socket.id },
                    position: {
                        $near: [x, y],
                        $maxDistance: 100
                    }
                }).select("socketId username position");

                // Send nearby users to the current user
                socket.emit("proximity:update", {
                    nearbyUsers: nearbyUsers.map((nearbyUser) => ({
                        userId: nearbyUser.socketId,
                        username: nearbyUser.username,
                        x: nearbyUser.position[0],
                        y: nearbyUser.position[1]
                    }))
                });

                // Log proximity count for testing
                console.log(
                    `${user.username}: ${nearbyUsers.length} nearby user(s)`
                );

            } catch (error) {
                console.error("Avatar movement error:", error.message);
            }
        });

        socket.on("disconnect", async () => {
            console.log(`User disconnected: ${socket.id}`);

            try {
                await User.findOneAndDelete({
                    socketId: socket.id
                });
            } catch (error) {
                console.error("User cleanup error:", error.message);
            }
        });

    } catch (error) {
        console.error("Socket user error:", error.message);
        socket.disconnect(true);
    }
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    try {
        await connectDB();

        server.listen(PORT, () => {
            console.log(
                `ProxiSpeak server running on http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error("Failed to start server:", error.message);
    }
};

startServer();