const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const connectDB = require("./config/database");

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
io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("avatar:move", (data) => {
        console.log("Avatar movement:", data);

        socket.broadcast.emit("avatar:moved", {
            userId: socket.id,
            x: data.x,
            y: data.y
        });
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);
    });
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