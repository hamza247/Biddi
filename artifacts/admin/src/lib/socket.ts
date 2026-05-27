import { io, Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;

export function connectAdminSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  socket = io(window.location.origin, {
    transports: ["websocket"],
    auth: { token },
    path: "/socket.io",
    reconnection: true,
  });
  return socket;
}

export function disconnectAdminSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
