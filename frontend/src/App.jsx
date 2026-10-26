import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { updateSpatialVolume } from "./utils/spatialAudio";

const socket = io("http://localhost:5000");

const RTC_CONFIGURATION = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302",
        },
    ],
};

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PROXIMITY_RADIUS = 100;
const AVATAR_RADIUS = 20;

function App() {
    const canvasRef = useRef(null);
    const peerConnections = useRef({});
    const remoteAudioRefs = useRef({});
    const localStreamRef = useRef(null);

    const [position, setPosition] = useState({
        x: 400,
        y: 250,
    });

    const [otherUsers, setOtherUsers] = useState({});
    const [nearbyUsers, setNearbyUsers] = useState([]);
    const [isMicOn, setIsMicOn] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    // Create a WebRTC peer connection for another user.
    const createPeerConnection = (
        userId,
        stream,
        createOffer = false
    ) => {
        if (peerConnections.current[userId]) {
            return peerConnections.current[userId];
        }

        const peerConnection = new RTCPeerConnection(
            RTC_CONFIGURATION
        );

        peerConnections.current[userId] = peerConnection;

        stream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, stream);
        });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("webrtc:ice-candidate", {
                    targetUserId: userId,
                    candidate: event.candidate,
                });
            }
        };

        peerConnection.ontrack = (event) => {
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

            audio.play().catch((error) => {
                console.warn(
                    "Remote audio playback requires interaction:",
                    error.message
                );
            });
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(
                `WebRTC connection with ${userId}:`,
                peerConnection.connectionState
            );

            if (
                peerConnection.connectionState === "failed" ||
                peerConnection.connectionState === "closed"
            ) {
                cleanupPeerConnection(userId);
            }
        };

        if (createOffer) {
            // Create the offer asynchronously.
            makeOffer(peerConnection, userId);
        }

        return peerConnection;
    };

    // Create and send a WebRTC offer.
    const makeOffer = async (peerConnection, userId) => {
        try {
            const offer = await peerConnection.createOffer();

            await peerConnection.setLocalDescription(offer);

            socket.emit("webrtc:offer", {
                targetUserId: userId,
                offer: peerConnection.localDescription,
            });
        } catch (error) {
            console.error("Could not create WebRTC offer:", error);
        }
    };

    // Clean up one user's audio connection.
    const cleanupPeerConnection = (userId) => {
        const peerConnection = peerConnections.current[userId];

        if (peerConnection) {
            peerConnection.ontrack = null;
            peerConnection.onicecandidate = null;
            peerConnection.onconnectionstatechange = null;
            peerConnection.close();

            delete peerConnections.current[userId];
        }

        const audio = remoteAudioRefs.current[userId];

        if (audio) {
            audio.pause();
            audio.srcObject = null;

            delete remoteAudioRefs.current[userId];
        }
    };

    // Draw the virtual world and avatars.
    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) return;

        const context = canvas.getContext("2d");

        context.clearRect(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
        );

        context.fillStyle = "#f2f2f2";

        context.fillRect(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT
        );

        // Draw local user's proximity radius.
        context.beginPath();

        context.arc(
            position.x,
            position.y,
            PROXIMITY_RADIUS,
            0,
            Math.PI * 2
        );

        context.strokeStyle = "rgba(37, 99, 235, 0.4)";
        context.lineWidth = 2;
        context.stroke();

        // Draw local avatar.
        context.beginPath();

        context.arc(
            position.x,
            position.y,
            AVATAR_RADIUS,
            0,
            Math.PI * 2
        );

        context.fillStyle = "#2563eb";
        context.fill();

        context.closePath();

        // Draw other users.
        Object.values(otherUsers).forEach((user) => {
            const isNearby = nearbyUsers.some(
                (nearbyUser) => nearbyUser.userId === user.userId
            );

            context.beginPath();

            context.arc(
                user.x,
                user.y,
                AVATAR_RADIUS,
                0,
                Math.PI * 2
            );

            context.fillStyle = isNearby ? "#22c55e" : "#ef4444";
            context.fill();

            context.closePath();

            context.fillStyle = "#111827";
            context.font = "12px Arial";
            context.textAlign = "center";

            context.fillText(
                user.username,
                user.x,
                user.y - AVATAR_RADIUS - 8
            );
        });
    }, [position, otherUsers, nearbyUsers]);

    // Receive movement updates from other users.
    useEffect(() => {
        const handleAvatarMoved = (data) => {
            setOtherUsers((currentUsers) => ({
                ...currentUsers,
                [data.userId]: {
                    userId: data.userId,
                    username: data.username,
                    x: data.x,
                    y: data.y,
                },
            }));
        };

        socket.on("avatar:moved", handleAvatarMoved);

        return () => {
            socket.off("avatar:moved", handleAvatarMoved);
        };
    }, []);

    // Remove disconnected avatars and their audio connections.
    useEffect(() => {
        const handleAvatarLeft = ({ userId }) => {
            setOtherUsers((currentUsers) => {
                const updatedUsers = { ...currentUsers };

                delete updatedUsers[userId];

                return updatedUsers;
            });

            setNearbyUsers((currentUsers) =>
                currentUsers.filter(
                    (user) => user.userId !== userId
                )
            );

            cleanupPeerConnection(userId);

            console.log("User left the virtual office:", userId);
        };

        socket.on("avatar:left", handleAvatarLeft);

        return () => {
            socket.off("avatar:left", handleAvatarLeft);
        };
    }, []);

    // Receive proximity updates and establish connections with nearby users.
    useEffect(() => {
        const handleProximityUpdate = async (data) => {
            const users = data.nearbyUsers || [];

            setNearbyUsers(users);

            const nearbyIds = new Set(
                users.map((user) => user.userId)
            );

            // Close audio connections when users are no longer nearby.
            Object.keys(peerConnections.current).forEach((userId) => {
                if (!nearbyIds.has(userId)) {
                    cleanupPeerConnection(userId);
                }
            });

            const stream = localStreamRef.current;

            if (!stream) return;

            for (const user of users) {
                if (!peerConnections.current[user.userId]) {
                    createPeerConnection(
                        user.userId,
                        stream,
                        true
                    );
                }
            }
        };

        socket.on("proximity:update", handleProximityUpdate);

        return () => {
            socket.off("proximity:update", handleProximityUpdate);
        };
    }, []);

    // Handle incoming WebRTC offers, answers, and ICE candidates.
    useEffect(() => {
        const handleOffer = async ({ senderUserId, offer }) => {
            const stream = localStreamRef.current;

            if (!stream) {
                console.warn(
                    "Cannot answer WebRTC offer: microphone is off."
                );
                return;
            }

            try {
                const peerConnection = createPeerConnection(
                    senderUserId,
                    stream
                );

                await peerConnection.setRemoteDescription(
                    new RTCSessionDescription(offer)
                );

                const answer = await peerConnection.createAnswer();

                await peerConnection.setLocalDescription(answer);

                socket.emit("webrtc:answer", {
                    targetUserId: senderUserId,
                    answer: peerConnection.localDescription,
                });
            } catch (error) {
                console.error("Error handling WebRTC offer:", error);
            }
        };

        const handleAnswer = async ({ senderUserId, answer }) => {
            const peerConnection =
                peerConnections.current[senderUserId];

            if (!peerConnection) return;

            try {
                await peerConnection.setRemoteDescription(
                    new RTCSessionDescription(answer)
                );
            } catch (error) {
                console.error("Error handling WebRTC answer:", error);
            }
        };

        const handleIceCandidate = async ({
            senderUserId,
            candidate,
        }) => {
            const peerConnection =
                peerConnections.current[senderUserId];

            if (!peerConnection || !candidate) return;

            try {
                await peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            } catch (error) {
                console.error("Error adding ICE candidate:", error);
            }
        };

        socket.on("webrtc:offer", handleOffer);
        socket.on("webrtc:answer", handleAnswer);
        socket.on("webrtc:ice-candidate", handleIceCandidate);

        return () => {
            socket.off("webrtc:offer", handleOffer);
            socket.off("webrtc:answer", handleAnswer);
            socket.off(
                "webrtc:ice-candidate",
                handleIceCandidate
            );
        };
    }, []);

    // Keyboard-based avatar movement.
    useEffect(() => {
        const handleKeyDown = (event) => {
            const movements = {
                ArrowUp: [0, -10],
                ArrowDown: [0, 10],
                ArrowLeft: [-10, 0],
                ArrowRight: [10, 0],
            };

            const movement = movements[event.key];

            if (!movement) return;

            event.preventDefault();

            setPosition((currentPosition) => {
                const x = Math.max(
                    AVATAR_RADIUS,
                    Math.min(
                        CANVAS_WIDTH - AVATAR_RADIUS,
                        currentPosition.x + movement[0]
                    )
                );

                const y = Math.max(
                    AVATAR_RADIUS,
                    Math.min(
                        CANVAS_HEIGHT - AVATAR_RADIUS,
                        currentPosition.y + movement[1]
                    )
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

    // Enable or disable the microphone.
    const toggleMicrophone = async () => {
        setErrorMessage("");

        if (!localStreamRef.current) {
            try {
                const stream =
                    await navigator.mediaDevices.getUserMedia({
                        audio: true,
                        video: false,
                    });

                localStreamRef.current = stream;
                setIsMicOn(true);

                console.log("Microphone enabled");

                // Create connections for users already nearby.
                for (const user of nearbyUsers) {
                    if (!peerConnections.current[user.userId]) {
                        createPeerConnection(
                            user.userId,
                            stream,
                            true
                        );
                    }
                }
            } catch (error) {
                console.error("Microphone access failed:", error);

                setErrorMessage(
                    "Could not access the microphone. Check browser permissions."
                );
            }

            return;
        }

        // Close peer connections when the microphone is turned off.
        Object.keys(peerConnections.current).forEach((userId) => {
            cleanupPeerConnection(userId);
        });

        localStreamRef.current.getTracks().forEach((track) => {
            track.stop();
        });

        localStreamRef.current = null;
        setIsMicOn(false);

        console.log("Microphone disabled");
    };

    return (
        <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
            <h1>ProxiSpeak</h1>

            <p>Use the arrow keys to move your avatar.</p>

            <p>
                Nearby users: <strong>{nearbyUsers.length}</strong>
            </p>

            <p>
                Microphone:{" "}
                <strong>{isMicOn ? "On" : "Off"}</strong>
            </p>

            {errorMessage && (
                <p style={{ color: "red" }}>{errorMessage}</p>
            )}

            <button onClick={toggleMicrophone}>
                {isMicOn
                    ? "🎙️ Turn Microphone Off"
                    : "🎤 Turn Microphone On"}
            </button>

            {nearbyUsers.length > 0 && (
                <div>
                    <h3>Users within 100 pixels</h3>

                    <ul>
                        {nearbyUsers.map((user) => (
                            <li key={user.userId}>
                                {user.username}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                style={{
                    border: "1px solid black",
                    maxWidth: "100%",
                    height: "auto",
                    display: "block",
                }}
            />
        </div>
    );
}

export default App;