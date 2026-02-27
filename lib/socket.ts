import { io, Socket } from "socket.io-client";
import { API_BASE_URL, getSession } from "./api";

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

let socketInstance: Socket | null = null;
let connecting: Promise<Socket> | null = null;

export async function getSocket(): Promise<Socket> {
  const session = await getSession();
  const nextToken = session?.token;

  if (socketInstance) {
    const currentToken = (socketInstance.auth as any)?.token;
    if (nextToken && currentToken !== nextToken) {
      socketInstance.auth = { token: nextToken };
      if (socketInstance.connected) {
        socketInstance.disconnect();
      }
      socketInstance.connect();
    }
    if (socketInstance.connected) return socketInstance;
  }

  if (connecting) return connecting;

  connecting = (async () => {
    socketInstance = io(API_ORIGIN, {
      transports: ["websocket"],
      auth: nextToken ? { token: nextToken } : undefined,
      autoConnect: true,
    });
    return socketInstance;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
