import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

function App() {
    const canvasRef = useRef(null);

    const [position, setPosition] = useState({
        x: 400,
        y: 250
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        context.clearRect(0, 0, canvas.width, canvas.height);

        context.fillStyle = "#f2f2f2";
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.beginPath();
        context.arc(position.x, position.y, 20, 0, Math.PI * 2);
        context.fillStyle = "#2563eb";
        context.fill();

        context.closePath();
    }, [position]);

    useEffect(() => {
        const handleKeyDown = (event) => {
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

                newX = Math.max(20, Math.min(780, newX));
                newY = Math.max(20, Math.min(480, newY));

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

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return (
        <div>
            <h1>ProxiSpeak</h1>

            <p>Use the arrow keys to move your avatar.</p>

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