import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

function App() {
    const canvasRef = useRef(null);

    const peerConnections = useRef({});
    const remoteAudioRefs = useRef({});

    const [position, setPosition] = useState({
        x: 400,
        y: 250
    });

    const [otherUsers, setOtherUsers] = useState({});
    const [nearbyUsers, setNearbyUsers] = useState([]);

    const [isMicOn, setIsMicOn] = useState(false);
    const [localStream, setLocalStream] = useState(null);

    const rtcConfiguration = {
        iceServers: [
            {
                urls: "stun:stun.l.google.com:19302"
            }
        ]
    };

    // Create WebRTC peer connection
    const createPeerConnection = async (
        userId,
        stream,
        createOffer = false
    ) => {
        if (peerConnections.current[userId]) {
            return peerConnections.current[userId];
        }

        const peerConnection =
            new RTCPeerConnection(rtcConfiguration);

        peerConnections.current[userId] =
            peerConnection;

        // Add microphone tracks
        stream.getTracks().forEach((track) => {
            peerConnection.addTrack(
                track,
                stream
            );
        });

        // Send ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit(
                    "webrtc:ice-candidate",
                    {
                        targetUserId: userId,
                        candidate: event.candidate
                    }
                );
            }
        };

        // Receive remote audio
        peerConnection.ontrack = (event) => {
            const [remoteStream] = event.streams;

            let audio =
                remoteAudioRefs.current[userId];

            if (!audio) {
                audio = new Audio();
                audio.autoplay = true;

                remoteAudioRefs.current[userId] =
                    audio;
            }

            audio.srcObject = remoteStream;

            audio.play().catch((error) => {
                console.log(
                    "Remote audio playback waiting for user interaction:",
                    error
                );
            });
        };

        // Monitor connection state
        peerConnection.onconnectionstatechange = () => {
            console.log(
                `WebRTC connection with ${userId}:`,
                peerConnection.connectionState
            );
        };

        // Create offer
        if (createOffer) {
            const offer =
                await peerConnection.createOffer();

            await peerConnection.setLocalDescription(
                offer
            );

            socket.emit("webrtc:offer", {
                targetUserId: userId,
                offer
            });
        }

        return peerConnection;
    };

    // Draw the virtual office
    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const context = canvas.getContext("2d");

        context.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        // Background
        context.fillStyle = "#f2f2f2";
        context.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        // Proximity radius
        context.beginPath();

        context.arc(
            position.x,
            position.y,
            100,
            0,
            Math.PI * 2
        );

        context.strokeStyle =
            "rgba(37, 99, 235, 0.3)";

        context.stroke();
        context.closePath();

        // Current user
        context.beginPath();

        context.arc(
            position.x,
            position.y,
            20,
            0,
            Math.PI * 2
        );

        context.fillStyle = "#2563eb";
        context.fill();

        context.closePath();

        // Other users
        Object.values(otherUsers).forEach((user) => {
            context.beginPath();

            context.arc(
                user.x,
                user.y,
                20,
                0,
                Math.PI * 2
            );

            const isNearby = nearbyUsers.some(
                (nearbyUser) =>
                    nearbyUser.userId ===
                    user.userId
            );

            context.fillStyle = isNearby
                ? "#22c55e"
                : "#ef4444";

            context.fill();

            context.closePath();
        });
    }, [
        position,
        otherUsers,
        nearbyUsers
    ]);

    // Receive movement from other users
    useEffect(() => {
        const handleAvatarMoved = (data) => {
            setOtherUsers((currentUsers) => ({
                ...currentUsers,
                [data.userId]: {
                    userId: data.userId,
                    username: data.username,
                    x: data.x,
                    y: data.y
                }
            }));
        };

        socket.on(
            "avatar:moved",
            handleAvatarMoved
        );

        return () => {
            socket.off(
                "avatar:moved",
                handleAvatarMoved
            );
        };
    }, []);

    // Receive proximity updates
    useEffect(() => {
        const handleProximityUpdate = async (data) => {
            const users =
                data.nearbyUsers || [];

            setNearbyUsers(users);

            // Don't start WebRTC without microphone
            if (!localStream) {
                return;
            }

            // Connect to nearby users
            for (const user of users) {
                if (
                    !peerConnections.current[
                        user.userId
                    ]
                ) {
                    await createPeerConnection(
                        user.userId,
                        localStream,
                        true
                    );
                }
            }
        };

        socket.on(
            "proximity:update",
            handleProximityUpdate
        );

        return () => {
            socket.off(
                "proximity:update",
                handleProximityUpdate
            );
        };
    }, [localStream]);

    // WebRTC signaling
    useEffect(() => {
        const handleOffer = async ({
            senderUserId,
            offer
        }) => {
            if (!localStream) {
                return;
            }

            const peerConnection =
                await createPeerConnection(
                    senderUserId,
                    localStream,
                    false
                );

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(offer)
            );

            const answer =
                await peerConnection.createAnswer();

            await peerConnection.setLocalDescription(
                answer
            );

            socket.emit("webrtc:answer", {
                targetUserId: senderUserId,
                answer
            });
        };

        const handleAnswer = async ({
            senderUserId,
            answer
        }) => {
            const peerConnection =
                peerConnections.current[
                    senderUserId
                ];

            if (!peerConnection) {
                return;
            }

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(answer)
            );
        };

        const handleIceCandidate = async ({
            senderUserId,
            candidate
        }) => {
            const peerConnection =
                peerConnections.current[
                    senderUserId
                ];

            if (!peerConnection) {
                return;
            }

            try {
                await peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            } catch (error) {
                console.error(
                    "ICE candidate error:",
                    error
                );
            }
        };

        socket.on(
            "webrtc:offer",
            handleOffer
        );

        socket.on(
            "webrtc:answer",
            handleAnswer
        );

        socket.on(
            "webrtc:ice-candidate",
            handleIceCandidate
        );

        return () => {
            socket.off(
                "webrtc:offer",
                handleOffer
            );

            socket.off(
                "webrtc:answer",
                handleAnswer
            );

            socket.off(
                "webrtc:ice-candidate",
                handleIceCandidate
            );
        };
    }, [localStream]);

    // Keyboard movement
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (
                event.key === "ArrowUp" ||
                event.key === "ArrowDown" ||
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight"
            ) {
                event.preventDefault();
            }

            setPosition((currentPosition) => {
                let newX =
                    currentPosition.x;

                let newY =
                    currentPosition.y;

                const movement = 10;

                if (event.key === "ArrowUp") {
                    newY -= movement;
                }

                if (event.key === "ArrowDown") {
                    newY += movement;
                }

                if (event.key === "ArrowLeft") {
                    newX -= movement;
                }

                if (event.key === "ArrowRight") {
                    newX += movement;
                }

                // Keep avatar inside canvas
                newX = Math.max(
                    20,
                    Math.min(780, newX)
                );

                newY = Math.max(
                    20,
                    Math.min(480, newY)
                );

                socket.emit("avatar:move", {
                    x: newX,
                    y: newY
                });

                return {
                    x: newX,
                    y: newY
                };
            });
        };

        window.addEventListener(
            "keydown",
            handleKeyDown
        );

        return () => {
            window.removeEventListener(
                "keydown",
                handleKeyDown
            );
        };
    }, []);

    // Toggle microphone
    const toggleMicrophone = async () => {
        try {
            // Turn microphone ON
            if (!isMicOn) {
                const stream =
                    await navigator.mediaDevices.getUserMedia(
                        {
                            audio: true,
                            video: false
                        }
                    );

                setLocalStream(stream);
                setIsMicOn(true);

                console.log(
                    "Microphone enabled"
                );
            }

            // Turn microphone OFF
            else {
                Object.values(
                    peerConnections.current
                ).forEach((peerConnection) => {
                    peerConnection.close();
                });

                peerConnections.current = {};

                if (localStream) {
                    localStream
                        .getTracks()
                        .forEach((track) => {
                            track.stop();
                        });
                }

                setLocalStream(null);
                setIsMicOn(false);

                console.log(
                    "Microphone disabled"
                );
            }
        } catch (error) {
            console.error(
                "Microphone access failed:",
                error
            );
        }
    };

    return (
        <div>
            <h1>ProxiSpeak</h1>

            <p>
                Use the arrow keys to move
                your avatar.
            </p>

            <p>
                Nearby users:{" "}
                <strong>
                    {nearbyUsers.length}
                </strong>
            </p>

            {nearbyUsers.length > 0 && (
                <div>
                    <strong>
                        Users within 100 pixels:
                    </strong>

                    <ul>
                        {nearbyUsers.map(
                            (user) => (
                                <li
                                    key={
                                        user.userId
                                    }
                                >
                                    {user.username}
                                </li>
                            )
                        )}
                    </ul>
                </div>
            )}

            <button
                onClick={toggleMicrophone}
            >
                {isMicOn
                    ? "🎙️ Microphone On"
                    : "🎤 Turn Microphone On"}
            </button>

            <br />
            <br />

            <canvas
                ref={canvasRef}
                width={800}
                height={500}
                style={{
                    border: "1px solid black"
                }}
            />
        </div>
    );
}

export default App;