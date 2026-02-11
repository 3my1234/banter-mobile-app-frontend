import { io, Socket } from "socket.io-client";
import { API_BASE_URL, getSession } from "./api";

const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

let socketInstance: Socket | null = null;
let connecting: Promise<Socket> | null = null;

export async function getSocket(): Promise<Socket> {
  if (socketInstance && socketInstance.connected) return socketInstance;
  if (connecting) return connecting;

  connecting = (async () => {
    const session = await getSession();
    socketInstance = io(API_ORIGIN, {
      transports: ["websocket"],
      auth: session?.token ? { token: session.token } : undefined,
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
