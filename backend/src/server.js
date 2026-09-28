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
            const { x, y } = data;

            if (typeof x !== "number" || typeof y !== "number") {
                return;
            }

            await User.findOneAndUpdate(
                { socketId: socket.id },
                {
                    position: [x, y]
                }
            );

            socket.broadcast.emit("avatar:moved", {
                userId: socket.id,
                username: user.username,
                x,
                y
            });
        });

        socket.on("disconnect", async () => {
            console.log(`User disconnected: ${socket.id}`);

            await User.findOneAndDelete({
                socketId: socket.id
            });
        });

    } catch (error) {
        console.error("Socket user error:", error.message);
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