import { getApiBase, isCrossOriginApi } from './config/connection';

const API = getApiBase();
const DEFAULT_TIMEOUT_MS = 15000;
const FETCH_CREDENTIALS = isCrossOriginApi() ? 'include' : 'same-origin';

async function request(path, options = {}) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API}${path}`, {
      method: options.method || 'GET',
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: FETCH_CREDENTIALS,
      body: options.body,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Request timed out — server may be busy');
      e.name = 'AbortError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (path, opts) => request(path, { ...opts }),
  post: (path, body, opts) => request(path, { method: 'POST', body: JSON.stringify(body), ...opts }),
  put: (path, body, opts) => request(path, { method: 'PUT', body: JSON.stringify(body), ...opts }),
  delete: (path, opts) => request(path, { method: 'DELETE', ...opts }),
  upload: async (path, formData, timeout = 120000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        body: formData,
        credentials: FETCH_CREDENTIALS,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Upload timed out');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
};

export default api;
