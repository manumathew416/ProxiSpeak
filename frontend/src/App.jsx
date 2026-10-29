
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { updateSpatialVolume } from "./utils/spatialAudio";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PROXIMITY_RADIUS = 100;
const AVATAR_RADIUS = 20;

const RTC_CONFIGURATION = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
    ],
};

const socket = io("http://localhost:5000");

function App() {
    const canvasRef = useRef(null);
    const peerConnections = useRef({});
    const remoteAudioRefs = useRef({});
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef({});
    const makingOffer = useRef({});

    const [position, setPosition] = useState({ x: 400, y: 250 });
    const [otherUsers, setOtherUsers] = useState({});
    const [nearbyUsers, setNearbyUsers] = useState([]);
    const [isMicOn, setIsMicOn] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [isConnected, setIsConnected] = useState(socket.connected);

    const cleanupPeerConnection = useCallback((userId) => {
        const connection = peerConnections.current[userId];

        if (connection) {
            connection.ontrack = null;
            connection.onicecandidate = null;
            connection.onconnectionstatechange = null;
            connection.close();
            delete peerConnections.current[userId];
        }

        const audio = remoteAudioRefs.current[userId];

        if (audio) {
            audio.pause();
            audio.srcObject = null;
            delete remoteAudioRefs.current[userId];
        }

        delete pendingCandidates.current[userId];
        delete makingOffer.current[userId];
    }, []);

    const createPeerConnection = useCallback((userId, stream) => {
        if (peerConnections.current[userId]) {
            return peerConnections.current[userId];
        }

        const pc = new RTCPeerConnection(RTC_CONFIGURATION);

        peerConnections.current[userId] = pc;
        pendingCandidates.current[userId] = [];

        stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
        });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("webrtc:ice-candidate", {
                    targetUserId: userId,
                    candidate: event.candidate,
                });
            }
        };

        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];

            if (!remoteStream) return;

            let audio = remoteAudioRefs.current[userId];

            if (!audio) {
                audio = new Audio();
                audio.autoplay = true;
                audio.playsInline = true;
                remoteAudioRefs.current[userId] = audio;
            }

            audio.srcObject = remoteStream;

            const remoteUser = otherUsers[userId];

            if (remoteUser) {
                updateSpatialVolume(audio, position, remoteUser);
            }

            audio.play().catch((error) => {
                console.warn("Audio playback failed:", error.message);
                setErrorMessage(
                    "Remote audio could not start. Check browser audio permissions."
                );
            });
        };

        pc.onconnectionstatechange = () => {
            console.log(
                `WebRTC connection with ${userId}:`,
                pc.connectionState
            );

            if (
                pc.connectionState === "failed" ||
                pc.connectionState === "closed"
            ) {
                cleanupPeerConnection(userId);
            }
        };

        return pc;
    }, [cleanupPeerConnection, otherUsers, position]);

    const flushPendingCandidates = useCallback(async (userId, pc) => {
        const candidates = pendingCandidates.current[userId] || [];

        pendingCandidates.current[userId] = [];

        for (const candidate of candidates) {
            try {
                await pc.addIceCandidate(candidate);
            } catch (error) {
                console.error("Could not add queued ICE candidate:", error);
            }
        }
    }, []);

    const makeOffer = useCallback(async (userId) => {
        const stream = localStreamRef.current;

        if (!stream || makingOffer.current[userId]) return;

        const pc = createPeerConnection(userId, stream);

        if (pc.signalingState !== "stable") return;

        try {
            makingOffer.current[userId] = true;

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.emit("webrtc:offer", {
                targetUserId: userId,
                offer: pc.localDescription,
            });
        } catch (error) {
            console.error("Could not create WebRTC offer:", error);
        } finally {
            makingOffer.current[userId] = false;
        }
    }, [createPeerConnection]);

    // Socket connection status
    useEffect(() => {
        const handleConnect = () => {
            setIsConnected(true);
            setErrorMessage("");
        };

        const handleDisconnect = () => {
            setIsConnected(false);
            setNearbyUsers([]);

            Object.keys(peerConnections.current).forEach((userId) => {
                cleanupPeerConnection(userId);
            });
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
        };
    }, [cleanupPeerConnection]);

    // Draw the office and avatars
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = "#f2f4f7";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Local user's hearing radius
        ctx.beginPath();
        ctx.arc(position.x, position.y, PROXIMITY_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
        ctx.fill();

        ctx.strokeStyle = "rgba(59, 130, 246, 0.45)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Other users
        Object.entries(otherUsers).forEach(([userId, user]) => {
            const isNearby = nearbyUsers.some(
                (nearby) => nearby.userId === userId
            );

            ctx.beginPath();
            ctx.arc(user.x, user.y, AVATAR_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = isNearby ? "#16a34a" : "#dc2626";
            ctx.fill();

            ctx.fillStyle = "#111827";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.fillText(user.username, user.x, user.y + 35);
        });

        // Local avatar
        ctx.beginPath();
        ctx.arc(position.x, position.y, AVATAR_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#2563eb";
        ctx.fill();

        ctx.fillStyle = "#111827";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.fillText("You", position.x, position.y + 35);
    }, [position, otherUsers, nearbyUsers]);

    // Receive other avatar movements
    useEffect(() => {
        const handleAvatarMoved = (user) => {
            setOtherUsers((previous) => ({
                ...previous,
                [user.userId]: {
                    username: user.username,
                    x: user.x,
                    y: user.y,
                },
            }));
        };

        socket.on("avatar:moved", handleAvatarMoved);

        return () => {
            socket.off("avatar:moved", handleAvatarMoved);
        };
    }, []);

    // Remove disconnected users
    useEffect(() => {
        const handleAvatarLeft = ({ userId }) => {
            setOtherUsers((previous) => {
                const updated = { ...previous };
                delete updated[userId];
                return updated;
            });

            setNearbyUsers((previous) =>
                previous.filter((user) => user.userId !== userId)
            );

            cleanupPeerConnection(userId);
        };

        socket.on("avatar:left", handleAvatarLeft);

        return () => {
            socket.off("avatar:left", handleAvatarLeft);
        };
    }, [cleanupPeerConnection]);

    // Update nearby users and manage audio connections
    useEffect(() => {
        const handleProximityUpdate = (users) => {
            setNearbyUsers(users);

            const nearbyIds = new Set(
                users.map((user) => user.userId)
            );

            Object.keys(peerConnections.current).forEach((userId) => {
                if (!nearbyIds.has(userId)) {
                    cleanupPeerConnection(userId);
                }
            });

           if (localStreamRef.current) {
            users.forEach((user) => {
                if (
                    socket.id &&
                    socket.id.localeCompare(user.userId) < 0 &&
                    !peerConnections.current[user.userId]
        ) {
            makeOffer(user.userId);
        }
    });
}
        };

        socket.on("proximity:update", handleProximityUpdate);

        return () => {
            socket.off("proximity:update", handleProximityUpdate);
        };
    }, [cleanupPeerConnection, makeOffer]);

    // Incoming WebRTC offers
    useEffect(() => {
        const handleOffer = async ({ senderUserId, offer }) => {
            const stream = localStreamRef.current;

            if (!stream || !senderUserId || !offer) return;

            const isNearby = nearbyUsers.some(
                (user) => user.userId === senderUserId
            );

            if (!isNearby) return;

            try {
                const pc = createPeerConnection(senderUserId, stream);

                await pc.setRemoteDescription(
                    new RTCSessionDescription(offer)
                );

                await flushPendingCandidates(senderUserId, pc);

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                socket.emit("webrtc:answer", {
                    targetUserId: senderUserId,
                    answer: pc.localDescription,
                });
            } catch (error) {
                console.error("Could not handle WebRTC offer:", error);
            }
        };

        socket.on("webrtc:offer", handleOffer);

        return () => {
            socket.off("webrtc:offer", handleOffer);
        };
    }, [createPeerConnection, flushPendingCandidates, nearbyUsers]);

    // Incoming WebRTC answers
    useEffect(() => {
        const handleAnswer = async ({ senderUserId, answer }) => {
            const pc = peerConnections.current[senderUserId];

            if (!pc || !answer) return;

            try {
                await pc.setRemoteDescription(
                    new RTCSessionDescription(answer)
                );

                await flushPendingCandidates(senderUserId, pc);
            } catch (error) {
                console.error("Could not handle WebRTC answer:", error);
            }
        };

        socket.on("webrtc:answer", handleAnswer);

        return () => {
            socket.off("webrtc:answer", handleAnswer);
        };
    }, [flushPendingCandidates]);

    // Queue ICE candidates until remote description is available
    useEffect(() => {
        const handleCandidate = async ({ senderUserId, candidate }) => {
            if (!senderUserId || !candidate) return;

            const pc = peerConnections.current[senderUserId];

            if (!pc || !pc.remoteDescription) {
                if (!pendingCandidates.current[senderUserId]) {
                    pendingCandidates.current[senderUserId] = [];
                }

                pendingCandidates.current[senderUserId].push(candidate);
                return;
            }

            try {
                await pc.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            } catch (error) {
                console.error("Could not add ICE candidate:", error);
            }
        };

        socket.on("webrtc:ice-candidate", handleCandidate);

        return () => {
            socket.off("webrtc:ice-candidate", handleCandidate);
        };
    }, []);

    // Server-side signaling validation errors
    useEffect(() => {
        const handleWebRTCError = ({ message }) => {
            setErrorMessage(message || "WebRTC signaling error.");
        };

        socket.on("webrtc:error", handleWebRTCError);

        return () => {
            socket.off("webrtc:error", handleWebRTCError);
        };
    }, []);

    // Distance-based volume
    useEffect(() => {
        Object.entries(remoteAudioRefs.current).forEach(
            ([userId, audioElement]) => {
                const remoteUser = otherUsers[userId];

                if (!remoteUser) {
                    audioElement.volume = 0;
                    return;
                }

                updateSpatialVolume(
                    audioElement,
                    position,
                    remoteUser
                );
            }
        );
    }, [position, otherUsers]);

    // Keyboard movement
    useEffect(() => {
        const handleKeyDown = (event) => {
            const keys = [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
            ];

            if (!keys.includes(event.key)) return;

            event.preventDefault();

            setPosition((previous) => {
                let x = previous.x;
                let y = previous.y;
                const step = 10;

                if (event.key === "ArrowUp") y -= step;
                if (event.key === "ArrowDown") y += step;
                if (event.key === "ArrowLeft") x -= step;
                if (event.key === "ArrowRight") x += step;

                x = Math.max(
                    AVATAR_RADIUS,
                    Math.min(CANVAS_WIDTH - AVATAR_RADIUS, x)
                );

                y = Math.max(
                    AVATAR_RADIUS,
                    Math.min(CANVAS_HEIGHT - AVATAR_RADIUS, y)
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
        if (!localStreamRef.current) {
            try {
                setErrorMessage("");

                const stream =
                    await navigator.mediaDevices.getUserMedia({
                        audio: true,
                        video: false,
                    });

                localStreamRef.current = stream;
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
                console.error("Microphone access failed:", error);
                setErrorMessage(
                    "Could not access your microphone. Check browser permissions and ensure it is not being used exclusively by another app."
                );
            }

            return;
        }

        Object.keys(peerConnections.current).forEach((userId) => {
            cleanupPeerConnection(userId);
        });

        localStreamRef.current.getTracks().forEach((track) => {
            track.stop();
        });

        localStreamRef.current = null;
        setIsMicOn(false);
    };

    // Clean up when the component unmounts
    useEffect(() => {
        return () => {
            Object.keys(peerConnections.current).forEach((userId) => {
                cleanupPeerConnection(userId);
            });

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach((track) => {
                    track.stop();
                });
                localStreamRef.current = null;
            }
        };
    }, [cleanupPeerConnection]);

    return (
        <main style={{ fontFamily: "Arial, sans-serif", padding: 20 }}>
            <h1>ProxiSpeak Virtual Office</h1>

            <p>
                Move with the arrow keys. You can hear users who are
                within {PROXIMITY_RADIUS} pixels.
            </p>

            <p>
                Server status:{" "}
                <strong style={{ color: isConnected ? "green" : "red" }}>
                    {isConnected ? "Connected" : "Disconnected"}
                </strong>
            </p>

            <p>
                Microphone:{" "}
                <strong>{isMicOn ? "On" : "Off"}</strong>
            </p>

            <button onClick={toggleMicrophone}>
                {isMicOn ? "Turn Microphone Off" : "Turn Microphone On"}
            </button>

            {errorMessage && (
                <p style={{ color: "red" }}>{errorMessage}</p>
            )}

            <p>Nearby users: {nearbyUsers.length}</p>

            <ul>
                {nearbyUsers.map((user) => (
                    <li key={user.userId}>
                        {user.username} — ({Math.round(user.x)},{" "}
                        {Math.round(user.y)})
                    </li>
                ))}
            </ul>

            <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                style={{
                    border: "1px solid #d1d5db",
                    maxWidth: "100%",
                    height: "auto",
                    display: "block",
                }}
            />
        </main>
    );
}

export default App;
