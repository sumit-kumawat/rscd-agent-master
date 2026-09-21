import { io } from 'socket.io-client';

let socket;

export function getSocket() {
  if (!socket) {
    socket = io({
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
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
