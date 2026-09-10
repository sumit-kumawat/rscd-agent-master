import { io } from 'socket.io-client';

let socket;

export function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io/', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function onSocket(event, handler) {
  getSocket().on(event, handler);
  return () => getSocket().off(event, handler);
}
