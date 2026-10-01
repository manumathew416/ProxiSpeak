import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

function App() {
    const canvasRef = useRef(null);

    const [position, setPosition] = useState({
        x: 400,
        y: 250
    });

    const [otherUsers, setOtherUsers] = useState({});
    const [nearbyUsers, setNearbyUsers] = useState([]);

    const [isMicOn, setIsMicOn] = useState(false);
    const [localStream, setLocalStream] = useState(null);

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

        // Draw proximity radius
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

        // Draw our avatar
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

        // Draw other users
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
                    nearbyUser.userId === user.userId
            );

            context.fillStyle = isNearby
                ? "#22c55e"
                : "#ef4444";

            context.fill();

            context.closePath();
        });
    }, [position, otherUsers, nearbyUsers]);

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
        const handleProximityUpdate = (data) => {
            setNearbyUsers(
                data.nearbyUsers || []
            );
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
    }, []);

    // Keyboard movement
    useEffect(() => {
        const handleKeyDown = (event) => {
            // Prevent browser scrolling
            if (
                event.key === "ArrowUp" ||
                event.key === "ArrowDown" ||
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight"
            ) {
                event.preventDefault();
            }

            setPosition((currentPosition) => {
                let newX = currentPosition.x;
                let newY = currentPosition.y;

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

                // Send new position to backend
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
                Use the arrow keys to move your
                avatar.
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