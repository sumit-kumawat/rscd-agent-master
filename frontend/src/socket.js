import { io } from 'socket.io-client';
import { getSocketOrigin, isCrossOriginApi } from './config/connection';

let socket;

export function getSocket() {
  if (!socket) {
    const origin = getSocketOrigin();
    socket = io(origin || undefined, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      withCredentials: isCrossOriginApi(),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 15000,
    });
  }
  return socket;
}

export function onSocket(event, handler) {
  getSocket().on(event, handler);
  return () => getSocket().off(event, handler);
}
