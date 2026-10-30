
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

function App() {
    const canvasRef = useRef(null);

    const peerConnections = useRef({});
    const remoteAudioRefs = useRef({});
    const spatialAudioRefs = useRef({});
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef({});
    const makingOffer = useRef({});

    const [position, setPosition] = useState({
        x: 400,
        y: 250
    });

    const [otherUsers, setOtherUsers] = useState([]);
    const [nearbyUsers, setNearbyUsers] = useState([]);
    const [isMicOn, setIsMicOn] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [isConnected, setIsConnected] = useState(false);

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
            }

            audio.srcObject = event.streams[0];

            audio.play().catch((error) => {
                console.log("Audio playback requires user interaction:", error);
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

        // Draw nearby users
        otherUsers.forEach((user) => {
            const isNearby = nearbyUsers.some(
                (nearbyUser) => nearbyUser.userId === user.userId
            );

            ctx.beginPath();
            ctx.arc(
                user.x,
                user.y,
                AVATAR_SIZE,
                0,
                Math.PI * 2
            );

            ctx.fillStyle = isNearby ? "#22c55e" : "#ef4444";
            ctx.fill();

            ctx.fillStyle = "#111";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.fillText(
                user.username,
                user.x,
                user.y + 32
            );
        });

        // Draw local avatar
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
                const existingUser = previousUsers.find(
                    (item) => item.userId === user.userId
                );

                if (existingUser) {
                    return previousUsers.map((item) =>
                        item.userId === user.userId
                            ? user
                            : item
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

    // Handle proximity updates
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
                // Only one side initiates the connection
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
        const handleOffer = async ({
            senderUserId,
            offer
        }) => {
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
        const handleAnswer = async ({
            senderUserId,
            answer
        }) => {
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

    // WebRTC server errors
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

    // Update spatial audio when avatars move
    useEffect(() => {
        nearbyUsers.forEach((user) => {
            const spatialAudio = spatialAudioRefs.current[user.userId];

            if (spatialAudio) {
                updateSpatialAudio(
                    spatialAudio,
                    position,
                    {
                        x: user.x,
                        y: user.y
                    }
                );
            }
        });
    }, [position, nearbyUsers]);

    // Keyboard movement
    useEffect(() => {
        const handleKeyDown = (event) => {
            const keys = [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight"
            ];

            if (!keys.includes(event.key)) return;

            event.preventDefault();

            setPosition((previousPosition) => {
                let x = previousPosition.x;
                let y = previousPosition.y;

                if (event.key === "ArrowUp") y -= MOVE_SPEED;
                if (event.key === "ArrowDown") y += MOVE_SPEED;
                if (event.key === "ArrowLeft") x -= MOVE_SPEED;
                if (event.key === "ArrowRight") x += MOVE_SPEED;

                x = Math.max(
                    AVATAR_SIZE,
                    Math.min(CANVAS_WIDTH - AVATAR_SIZE, x)
                );

                y = Math.max(
                    AVATAR_SIZE,
                    Math.min(CANVAS_HEIGHT - AVATAR_SIZE, y)
                );

                socket.emit("avatar:move", { x, y });

                return { x, y };
            });
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

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

                // Resume audio contexts after user interaction
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
                <strong style={{
                    color: isConnected ? "green" : "red"
                }}>
                    {isConnected ? "Connected" : "Disconnected"}
                </strong>
            </p>

            <button onClick={toggleMicrophone}>
                {isMicOn ? "Turn Microphone Off" : "Turn Microphone On"}
            </button>

            {errorMessage && (
                <p style={{ color: "red" }}>
                    {errorMessage}
                </p>
            )}

            <p>
                Nearby users: {nearbyUsers.length}
            </p>

            <div>
                {nearbyUsers.map((user) => (
                    <p key={user.userId}>
                        {user.username} - Nearby
                    </p>
                ))}
            </div>

            <p>Use arrow keys to move your avatar.</p>

            <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                style={{
                    border: "2px solid black",
                    background: "#f5f5f5",
                    maxWidth: "100%"
                }}
            />
        </div>
    );
}

export default App;
