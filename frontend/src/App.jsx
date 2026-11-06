
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
    createSpatialAudio,
    updateSpatialAudio
} from "./utils/spatialAudio";

const socket = io("http://localhost:5000", {
    autoConnect: false
});

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const AVATAR_SIZE = 20;

// Solid objects in the office
const OBSTACLES = [
    // Meeting room table
    { x: 590, y: 75, width: 120, height: 55 },

    // Meeting room chairs
    { x: 570, y: 85, width: 15, height: 15 },
    { x: 570, y: 115, width: 15, height: 15 },
    { x: 725, y: 85, width: 15, height: 15 },
    { x: 725, y: 115, width: 15, height: 15 },
    { x: 625, y: 60, width: 15, height: 15 },
    { x: 675, y: 145, width: 15, height: 15 },

    // Desks and their chairs
    ...[
        [80, 100],
        [220, 100],
        [360, 100],
        [80, 260],
        [220, 260],
        [360, 260]
    ].flatMap(([x, y]) => [
        { x, y, width: 90, height: 45 },
        { x: x + 35, y: y + 55, width: 20, height: 20 }
    ]),

    // Plants
    { x: 23, y: 426, width: 24, height: 24 },
    { x: 448, y: 426, width: 24, height: 24 },
    { x: 743, y: 446, width: 24, height: 24 },

    // Reception desk
    { x: 550, y: 240, width: 210, height: 65 },

    // Meeting room walls, with an opening at the bottom
    { x: 518, y: 18, width: 264, height: 5 },
    { x: 518, y: 18, width: 5, height: 164 },
    { x: 777, y: 18, width: 5, height: 164 },
    { x: 518, y: 177, width: 92, height: 5 },
    { x: 690, y: 177, width: 92, height: 5 }
];

const MOVE_SPEED = 5;
const MOVEMENT_SMOOTHNESS = 0.08;
const MOVE_EMIT_INTERVAL = 50;


function drawOffice(ctx) {
    // Office floor
    ctx.fillStyle = "#eef2f3";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Main office area
    ctx.fillStyle = "#e8f0e8";
    ctx.fillRect(10, 10, 780, 480);

    // Meeting room
    ctx.fillStyle = "#dbeafe";
    ctx.fillRect(520, 20, 260, 160);

    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 3;
    ctx.strokeRect(520, 20, 260, 160);

    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.fillText("MEETING ROOM", 650, 45);

    // Meeting table
    ctx.fillStyle = "#a16207";
    ctx.fillRect(590, 75, 120, 55);

    // Meeting chairs
    const chairs = [
        [570, 85],
        [570, 115],
        [725, 85],
        [725, 115],
        [625, 60],
        [675, 145]
    ];

    chairs.forEach(([x, y]) => {
        ctx.fillStyle = "#475569";
        ctx.fillRect(x, y, 15, 15);
    });

    // Workstation area
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(20, 20, 470, 460);

    ctx.strokeStyle = "#d6a94b";
    ctx.strokeRect(20, 20, 470, 460);

    ctx.fillStyle = "#713f12";
    ctx.font = "bold 16px Arial";
    ctx.fillText("WORKSTATIONS", 250, 45);

    // Draw desks
    const desks = [
        [80, 100],
        [220, 100],
        [360, 100],
        [80, 260],
        [220, 260],
        [360, 260]
    ];

    desks.forEach(([x, y], index) => {
        // Desk
        ctx.fillStyle = "#a16207";
        ctx.fillRect(x, y, 90, 45);

        // Monitor
        ctx.fillStyle = "#334155";
        ctx.fillRect(x + 30, y + 7, 30, 20);

        // Monitor screen
        ctx.fillStyle = "#7dd3fc";
        ctx.fillRect(x + 33, y + 10, 24, 14);

        // Keyboard
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(x + 28, y + 32, 35, 5);

        // Chair
        ctx.fillStyle = "#475569";
        ctx.fillRect(x + 35, y + 55, 20, 20);

        ctx.fillStyle = "#713f12";
        ctx.font = "11px Arial";
        ctx.fillText(`Desk ${index + 1}`, x + 45, y - 8);
    });

    // Plants
    const plants = [
        [35, 430],
        [460, 430],
        [755, 450]
    ];

    plants.forEach(([x, y]) => {
        ctx.fillStyle = "#854d0e";
        ctx.fillRect(x - 8, y + 8, 16, 12);

        ctx.fillStyle = "#16a34a";
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
    });

    // Reception area
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(550, 240, 210, 65);

    ctx.fillStyle = "#334155";
    ctx.font = "bold 14px Arial";
    ctx.fillText("RECEPTION", 655, 278);

    // Office entrance
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 13px Arial";
    ctx.fillText("ENTRANCE", 650, 460);
}

// Check whether a circular avatar collides with a rectangle
function checkCollision(x, y, obstacle) {
    const closestX = Math.max(
        obstacle.x,
        Math.min(x, obstacle.x + obstacle.width)
    );

    const closestY = Math.max(
        obstacle.y,
        Math.min(y, obstacle.y + obstacle.height)
    );

    const dx = x - closestX;
    const dy = y - closestY;

    return (
        dx * dx + dy * dy <
        AVATAR_SIZE * AVATAR_SIZE
    );
}

// Check all office obstacles
function isPositionBlocked(x, y) {
    return OBSTACLES.some(obstacle =>
        checkCollision(x, y, obstacle)
    );
}

// Find a random safe starting position
function getSafeSpawnPosition() {
    const minX = 40;
    const maxX = CANVAS_WIDTH - 40;
    const minY = 40;
    const maxY = CANVAS_HEIGHT - 40;

    for (let i = 0; i < 100; i++) {
        const x = Math.floor(
            Math.random() * (maxX - minX + 1) + minX
        );

        const y = Math.floor(
            Math.random() * (maxY - minY + 1) + minY
        );

        if (!isPositionBlocked(x, y)) {
            return { x, y };
        }
    }

    // Fallback position
    return { x: 500, y: 350 };
}


function App() {
    const [initialPosition] = useState(
    () => getSafeSpawnPosition()
);
    const canvasRef = useRef(null);
    const positionRef = useRef(initialPosition);
    const targetPosition = useRef(initialPosition);

    const peerConnections = useRef({});
    const remoteAudioRefs = useRef({});
    const spatialAudioRefs = useRef({});
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef({});
    const makingOffer = useRef({});
    const lastMoveEmit = useRef(0);

    const [position, setPosition] = useState(initialPosition);

    const [otherUsers, setOtherUsers] = useState([]);
    const [nearbyUsers, setNearbyUsers] = useState([]);
    const [isMicOn, setIsMicOn] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [isConnected, setIsConnected] = useState(false);

    // Update local position and movement target
    const moveTo = useCallback((x, y) => {
        const newPosition = {
            x: Math.max(
                AVATAR_SIZE,
                Math.min(CANVAS_WIDTH - AVATAR_SIZE, x)
            ),
            y: Math.max(
                AVATAR_SIZE,
                Math.min(CANVAS_HEIGHT - AVATAR_SIZE, y)
            )
        };

        targetPosition.current = newPosition;

        return newPosition;
    }, []);

    // Clean up a peer connection
    const cleanupPeerConnection = useCallback((userId) => {
        const pc = peerConnections.current[userId];

        if (pc) {
            pc.close();
            delete peerConnections.current[userId];
        }

        const audio = remoteAudioRefs.current[userId];

        if (audio) {
            audio.pause();
            audio.srcObject = null;
            delete remoteAudioRefs.current[userId];
        }

        const spatialAudio = spatialAudioRefs.current[userId];

        if (spatialAudio) {
            spatialAudio.audioContext.close().catch(() => {});
            delete spatialAudioRefs.current[userId];
        }

        delete pendingCandidates.current[userId];
        delete makingOffer.current[userId];
    }, []);

    // Create WebRTC peer connection
    const createPeerConnection = useCallback((userId) => {
        if (peerConnections.current[userId]) {
            return peerConnections.current[userId];
        }

        const pc = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "stun:stun.l.google.com:19302"
                }
            ]
        });

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStreamRef.current);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("webrtc:ice-candidate", {
                    targetUserId: userId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            let audio = remoteAudioRefs.current[userId];

            if (!audio) {
                audio = new Audio();
                audio.autoplay = true;

                remoteAudioRefs.current[userId] = audio;

                const spatialAudio = createSpatialAudio(audio);
                spatialAudioRefs.current[userId] = spatialAudio;

                if (spatialAudio.audioContext.state === "suspended") {
                    spatialAudio.audioContext.resume().catch(console.error);
                }
            }

            audio.srcObject = event.streams[0];

            audio.play().catch((error) => {
                console.log("Audio playback requires interaction:", error);
            });
        };

        pc.onconnectionstatechange = () => {
            console.log(
                `Connection with ${userId}:`,
                pc.connectionState
            );

            if (
                pc.connectionState === "failed" ||
                pc.connectionState === "closed"
            ) {
                cleanupPeerConnection(userId);
            }
        };

        peerConnections.current[userId] = pc;

        return pc;
    }, [cleanupPeerConnection]);

    // Create and send WebRTC offer
    const makeOffer = useCallback(async (userId) => {
        if (makingOffer.current[userId]) return;

        try {
            makingOffer.current[userId] = true;

            const pc = createPeerConnection(userId);
            const offer = await pc.createOffer();

            await pc.setLocalDescription(offer);

            socket.emit("webrtc:offer", {
                targetUserId: userId,
                offer: pc.localDescription
            });

        } catch (error) {
            console.error("Error creating offer:", error);
            cleanupPeerConnection(userId);
        } finally {
            makingOffer.current[userId] = false;
        }
    }, [createPeerConnection, cleanupPeerConnection]);

    // Socket connection status
    useEffect(() => {
        const handleConnect = () => {
            setIsConnected(true);
            console.log("Connected to ProxiSpeak server");
        };

        const handleDisconnect = () => {
            setIsConnected(false);
            console.log("Disconnected from server");
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);

        if (socket.connected) {
            setIsConnected(true);
        }

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
        };
    }, []);

    // Draw canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        drawOffice(ctx);

        // Other users
        otherUsers.forEach((user) => {
            const isNearby = nearbyUsers.some(
                (nearbyUser) => nearbyUser.userId === user.userId
            );

            ctx.beginPath();
            ctx.arc(user.x, user.y, AVATAR_SIZE, 0, Math.PI * 2);

            ctx.fillStyle = isNearby ? "#22c55e" : "#ef4444";
            ctx.fill();

            ctx.fillStyle = "#111";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.fillText(user.username, user.x, user.y + 32);
        });

        // Local user
        ctx.beginPath();
        ctx.arc(
            position.x,
            position.y,
            AVATAR_SIZE,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = "#2563eb";
        ctx.fill();

        ctx.fillStyle = "#111";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.fillText("You", position.x, position.y + 32);

    }, [position, otherUsers, nearbyUsers]);

    
// Receive and synchronize users
useEffect(() => {
    const handleInitialUsers = (users) => {
        console.log("INITIAL USERS RECEIVED:", users);
        setOtherUsers(users);
    
    };

    const handleAvatarJoined = (user) => {
    console.log("NEW USER JOINED:", user);

    setOtherUsers((previousUsers) => {
        if (previousUsers.some((item) => item.userId === user.userId)) {
            return previousUsers;
        }

        return [...previousUsers, user];
    });
};
    const handleAvatarMoved = (user) => {
        setOtherUsers((previousUsers) => {
            const exists = previousUsers.some(
                (item) => item.userId === user.userId
            );

            if (exists) {
                return previousUsers.map((item) =>
                    item.userId === user.userId ? user : item
                );
            }

            return [...previousUsers, user];
        });
    };

    const handleAvatarLeft = ({ userId }) => {
        setOtherUsers((previousUsers) =>
            previousUsers.filter(
                (user) => user.userId !== userId
            )
        );

        cleanupPeerConnection(userId);
    };

    socket.on("users:initial", handleInitialUsers);
    socket.on("avatar:joined", handleAvatarJoined);
    socket.on("avatar:moved", handleAvatarMoved);
    socket.on("avatar:left", handleAvatarLeft);

    return () => {
        socket.off("users:initial", handleInitialUsers);
        socket.off("avatar:joined", handleAvatarJoined);
        socket.off("avatar:moved", handleAvatarMoved);
        socket.off("avatar:left", handleAvatarLeft);
    };
}, [cleanupPeerConnection]);


    // Handle nearby users
    useEffect(() => {
        const handleProximityUpdate = (users) => {
            setNearbyUsers(users);

            const nearbyIds = users.map((user) => user.userId);

            Object.keys(peerConnections.current).forEach((userId) => {
                if (!nearbyIds.includes(userId)) {
                    cleanupPeerConnection(userId);
                }
            });

            if (!localStreamRef.current) return;

            users.forEach((user) => {
                if (
                    socket.id &&
                    socket.id.localeCompare(user.userId) < 0 &&
                    !peerConnections.current[user.userId]
                ) {
                    makeOffer(user.userId);
                }
            });
        };

        socket.on("proximity:update", handleProximityUpdate);

        return () => {
            socket.off("proximity:update", handleProximityUpdate);
        };
    }, [makeOffer, cleanupPeerConnection]);

    // Receive WebRTC offer
    useEffect(() => {
        const handleOffer = async ({ senderUserId, offer }) => {
            const isNearby = nearbyUsers.some(
                (user) => user.userId === senderUserId
            );

            if (!isNearby || !localStreamRef.current) return;

            try {
                const pc = createPeerConnection(senderUserId);

                await pc.setRemoteDescription(
                    new RTCSessionDescription(offer)
                );

                const answer = await pc.createAnswer();

                await pc.setLocalDescription(answer);

                socket.emit("webrtc:answer", {
                    targetUserId: senderUserId,
                    answer: pc.localDescription
                });

                const candidates =
                    pendingCandidates.current[senderUserId] || [];

                for (const candidate of candidates) {
                    await pc.addIceCandidate(
                        new RTCIceCandidate(candidate)
                    );
                }

                delete pendingCandidates.current[senderUserId];

            } catch (error) {
                console.error("Error handling offer:", error);
                cleanupPeerConnection(senderUserId);
            }
        };

        socket.on("webrtc:offer", handleOffer);

        return () => {
            socket.off("webrtc:offer", handleOffer);
        };
    }, [nearbyUsers, createPeerConnection, cleanupPeerConnection]);

    // Receive WebRTC answer
    useEffect(() => {
        const handleAnswer = async ({ senderUserId, answer }) => {
            try {
                const pc = peerConnections.current[senderUserId];

                if (!pc) return;

                await pc.setRemoteDescription(
                    new RTCSessionDescription(answer)
                );

                const candidates =
                    pendingCandidates.current[senderUserId] || [];

                for (const candidate of candidates) {
                    await pc.addIceCandidate(
                        new RTCIceCandidate(candidate)
                    );
                }

                delete pendingCandidates.current[senderUserId];

            } catch (error) {
                console.error("Error handling answer:", error);
            }
        };

        socket.on("webrtc:answer", handleAnswer);

        return () => {
            socket.off("webrtc:answer", handleAnswer);
        };
    }, []);

    // Receive ICE candidates
    useEffect(() => {
        const handleCandidate = async ({
            senderUserId,
            candidate
        }) => {
            try {
                const pc = peerConnections.current[senderUserId];

                if (!pc) return;

                if (pc.remoteDescription) {
                    await pc.addIceCandidate(
                        new RTCIceCandidate(candidate)
                    );
                } else {
                    if (!pendingCandidates.current[senderUserId]) {
                        pendingCandidates.current[senderUserId] = [];
                    }

                    pendingCandidates.current[senderUserId].push(candidate);
                }
            } catch (error) {
                console.error("Error adding ICE candidate:", error);
            }
        };

        socket.on("webrtc:ice-candidate", handleCandidate);

        return () => {
            socket.off("webrtc:ice-candidate", handleCandidate);
        };
    }, []);

    // Receive WebRTC errors
    useEffect(() => {
        const handleError = (message) => {
            console.error("WebRTC error:", message);

            setErrorMessage(
                typeof message === "string"
                    ? message
                    : "WebRTC connection error"
            );
        };

        socket.on("webrtc:error", handleError);

        return () => {
            socket.off("webrtc:error", handleError);
        };
    }, []);

    // Update spatial audio
    useEffect(() => {
        nearbyUsers.forEach((user) => {
            const spatialAudio = spatialAudioRefs.current[user.userId];

            if (spatialAudio) {
                updateSpatialAudio(
                    spatialAudio,
                    position,
                    { x: user.x, y: user.y }
                );
            }
        });
    }, [position, nearbyUsers]);

    // Smooth movement animation
    // Smooth movement with collision detection
useEffect(() => {
    let animationId;
    let lastFrameTime = 0;

    const animate = (timestamp) => {
        const current = positionRef.current;
        const target = targetPosition.current;

        const dx = target.x - current.x;
        const dy = target.y - current.y;

        let newX = current.x;
        let newY = current.y;

        // Calculate next horizontal position
        const proposedX =
            current.x + dx * MOVEMENT_SMOOTHNESS;

        if (!isPositionBlocked(proposedX, current.y)) {
            newX = proposedX;
        }

        // Calculate next vertical position
        const proposedY =
            current.y + dy * MOVEMENT_SMOOTHNESS;

        if (!isPositionBlocked(newX, proposedY)) {
            newY = proposedY;
        }

        const newPosition = {
            x: newX,
            y: newY
        };

        const moved =
            newX !== current.x ||
            newY !== current.y;

        if (moved) {
            positionRef.current = newPosition;
            setPosition(newPosition);

            if (
                timestamp - lastFrameTime >= MOVE_EMIT_INTERVAL
            ) {
                socket.emit("avatar:move", newPosition);
                lastFrameTime = timestamp;
            }
        }

        // Stop when the target is reached or movement is blocked
        const remainingX = target.x - newX;
        const remainingY = target.y - newY;

        if (
            Math.abs(remainingX) < 0.5 &&
            Math.abs(remainingY) < 0.5
        ) {
            positionRef.current = target;
            setPosition(target);
        }

        animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationId);
}, []);

    // Mouse click movement
    const handleCanvasClick = (event) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();

        const scaleX = CANVAS_WIDTH / rect.width;
        const scaleY = CANVAS_HEIGHT / rect.height;

        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;

        moveTo(x, y);
    };

    // Keyboard movement
    useEffect(() => {
        const handleKeyDown = (event) => {
            const directions = {
                ArrowUp: [0, -MOVE_SPEED],
                ArrowDown: [0, MOVE_SPEED],
                ArrowLeft: [-MOVE_SPEED, 0],
                ArrowRight: [MOVE_SPEED, 0]
            };

            const direction = directions[event.key];

            if (!direction) return;

            event.preventDefault();

            const current = targetPosition.current;

            moveTo(
                current.x + direction[0],
                current.y + direction[1]
            );
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [moveTo]);

    // Microphone toggle
    const toggleMicrophone = async () => {
        if (!isMicOn) {
            try {
                setErrorMessage("");

                const stream =
                    await navigator.mediaDevices.getUserMedia({
                        audio: true
                    });

                localStreamRef.current = stream;

                Object.values(spatialAudioRefs.current).forEach(
                    (spatialAudio) => {
                        if (
                            spatialAudio.audioContext.state === "suspended"
                        ) {
                            spatialAudio.audioContext.resume().catch(
                                console.error
                            );
                        }
                    }
                );

                setIsMicOn(true);

                nearbyUsers.forEach((user) => {
                    if (
                        socket.id &&
                        socket.id.localeCompare(user.userId) < 0 &&
                        !peerConnections.current[user.userId]
                    ) {
                        makeOffer(user.userId);
                    }
                });

            } catch (error) {
                console.error("Microphone error:", error);
                setErrorMessage(
                    "Microphone access denied or unavailable."
                );
            }

        } else {
            Object.keys(peerConnections.current).forEach(
                cleanupPeerConnection
            );

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(
                    (track) => track.stop()
                );

                localStreamRef.current = null;
            }

            setIsMicOn(false);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
    // Connect only after all socket event listeners are registered.
    socket.connect();

    return () => {
        Object.keys(peerConnections.current).forEach(
            cleanupPeerConnection
        );

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(
                (track) => track.stop()
            );
        }

        socket.disconnect();
    };
}, [cleanupPeerConnection]);

    return (
        <div style={{ padding: "20px", fontFamily: "Arial" }}>
            <h1>ProxiSpeak Virtual Office</h1>

            <p>
                Server status:{" "}
                <strong
                    style={{
                        color: isConnected ? "green" : "red"
                    }}
                >
                    {isConnected ? "Connected" : "Disconnected"}
                </strong>
            </p>

            <button onClick={toggleMicrophone}>
                {isMicOn
                    ? "Turn Microphone Off"
                    : "Turn Microphone On"}
            </button>

            {errorMessage && (
                <p style={{ color: "red" }}>
                    {errorMessage}
                </p>
            )}

            <p>Nearby users: {nearbyUsers.length}</p>

            <div>
                {nearbyUsers.map((user) => (
                    <p key={user.userId}>
                        {user.username} - Nearby
                    </p>
                ))}
            </div>

            <p>
                Use arrow keys or click anywhere on the canvas to move.
            </p>

            <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onClick={handleCanvasClick}
                style={{
                    border: "2px solid black",
                    background: "#f5f5f5",
                    maxWidth: "100%",
                    cursor: "pointer"
                }}
            />
        </div>
    );
}

export default App;