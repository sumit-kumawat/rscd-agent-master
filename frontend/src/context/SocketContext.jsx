import { createContext, useContext, useEffect, useState } from 'react';
import { getSocket } from '../socket';

const SocketContext = createContext({
  connected: false,
  reconnecting: false,
  lastError: null,
});

export function SocketProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastError, setLastError] = useState(null);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      setReconnecting(false);
      setLastError(null);
    };
    const onDisconnect = () => setConnected(false);
    const onReconnectAttempt = () => setReconnecting(true);
    const onConnectError = (err) => {
      setLastError(err?.message || 'Connection failed');
      setConnected(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on('connect_error', onConnectError);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ connected, reconnecting, lastError }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketStatus() {
  return useContext(SocketContext);
}
