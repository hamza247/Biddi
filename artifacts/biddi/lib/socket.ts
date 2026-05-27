import { io, Socket } from "socket.io-client";
import { getBaseUrl, getTokenSync, loadToken } from "./api";

let socket: Socket | null = null;
let sessionGeneration = 0;

/**
 * Returns the current session generation. Callers should capture this before
 * starting an async connect so they can detect if logout ran during the await.
 */
export function getSessionGeneration(): number {
  return sessionGeneration;
}

/**
 * Connects (or reuses) the global socket for the current session.
 *
 * If `requiredGen` is provided and no longer matches the current generation
 * (because logout ran while this call was awaiting the token), the function
 * returns null immediately without creating or touching any socket, making
 * the stale connect attempt a no-op.
 */
export async function connectSocket(requiredGen?: number): Promise<Socket | null> {
  const token = getTokenSync() ?? (await loadToken());
  if (requiredGen !== undefined && requiredGen !== sessionGeneration) return null;
  const base = getBaseUrl();
  if (!token || !base) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  socket = io(base, {
    transports: ["websocket"],
    auth: { token },
    path: "/socket.io",
    // reconnection is intentionally disabled. AppContext.tsx implements its
    // own reconnect loop (onDisconnect) and foreground-resume logic
    // (AppState "change" listener) that call connectSocket() and then wire up
    // listeners — including re-emitting "driver:online" via onSocketConnect.
    //
    // If reconnection were re-enabled here, Socket.IO would silently reconnect
    // at the transport layer. When the app is backgrounded, no AppState event
    // fires, so the custom reconnect loop is bypassed entirely. The "connect"
    // event would still fire on the existing socket instance, and because
    // onSocketConnect is already attached to that event (in attachListeners),
    // the "driver:online" re-emit WOULD happen correctly. However, the full
    // flow should be re-verified end-to-end before enabling reconnection,
    // paying particular attention to:
    //   1. Session-generation checks (stale sessions must not create sockets).
    //   2. The driverOnlineRef value being accurate when the connect event
    //      fires after a background reconnect.
    //   3. The custom onDisconnect loop not racing with the built-in one.
    reconnection: false,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

/**
 * Disconnects the global socket and increments the session generation so that
 * any in-flight connectSocket() call becomes stale and returns null after its
 * await resolves, preventing orphaned sockets from any session.
 */
export function disconnectSocket(): void {
  sessionGeneration++;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
