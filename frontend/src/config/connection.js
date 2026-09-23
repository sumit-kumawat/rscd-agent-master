/**
 * API / WebSocket base URLs.
 * Default: same origin (/api). With VITE_BACKEND_PORT (e.g. 81), UI on :80 calls API on :81.
 */
function backendOrigin() {
  const explicit = import.meta.env.VITE_API_URL;
  if (explicit) {
    try {
      const u = new URL(explicit.replace(/\/api\/?$/, '') || explicit);
      return u.origin;
    } catch {
      return '';
    }
  }
  const port = import.meta.env.VITE_BACKEND_PORT;
  if (port && typeof window !== 'undefined') {
    const u = new URL(window.location.href);
    u.port = String(port);
    return u.origin;
  }
  return '';
}

export function getApiBase() {
  const explicit = import.meta.env.VITE_API_URL;
  if (explicit) {
    const trimmed = String(explicit).replace(/\/$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  const origin = backendOrigin();
  return origin ? `${origin}/api` : '/api';
}

export function isCrossOriginApi() {
  if (typeof window === 'undefined') return false;
  const base = getApiBase();
  if (!base.startsWith('http')) return false;
  try {
    return new URL(base).origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function getSocketOrigin() {
  const explicit = import.meta.env.VITE_SOCKET_URL;
  if (explicit) return explicit;
  const origin = backendOrigin();
  return origin || undefined;
}

export function getHealthUrl() {
  const origin = backendOrigin();
  return origin ? `${origin}/health` : '/health';
}
