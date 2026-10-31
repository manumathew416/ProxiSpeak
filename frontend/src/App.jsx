
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
    createSpatialAudio,
    updateSpatialAudio
} from "./utils/spatialAudio";

const socket = io("http://localhost:5000");

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const AVATAR_SIZE = 20;
const MOVE_SPEED = 5;
const MOVEMENT_SMOOTHNESS = 0.08;
const MOVE_EMIT_INTERVAL = 50;

function App() {
    const canvasRef = useRef(null);

    const positionRef = useRef({ x: 400, y: 250 });
    const targetPosition = useRef({ x: 400, y: 250 });

    const peerConnections = useRef({});
    const remoteAudioRefs = useRef({});
    const spatialAudioRefs = useRef({});
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef({});
    const makingOffer = useRef({});
    const lastMoveEmit = useRef(0);

    const [position, setPosition] = useState({
        x: 400,
        y: 250
    });

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

        ctx.fillStyle = "#f5f5f5";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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

    // Receive avatar movement
    useEffect(() => {
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

        socket.on("avatar:moved", handleAvatarMoved);
        socket.on("avatar:left", handleAvatarLeft);

        return () => {
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
    useEffect(() => {
        let animationId;
        let lastFrameTime = 0;

        const animate = (timestamp) => {
            const current = positionRef.current;
            const target = targetPosition.current;

            const dx = target.x - current.x;
            const dy = target.y - current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 0.5) {
                const newPosition = {
                    x: current.x + dx * MOVEMENT_SMOOTHNESS,
                    y: current.y + dy * MOVEMENT_SMOOTHNESS
                };

                positionRef.current = newPosition;
                setPosition(newPosition);

                if (
                    timestamp - lastFrameTime >= MOVE_EMIT_INTERVAL
                ) {
                    socket.emit("avatar:move", newPosition);
                    lastFrameTime = timestamp;
                }
            } else if (distance > 0) {
                positionRef.current = target;
                setPosition(target);
                socket.emit("avatar:move", target);
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