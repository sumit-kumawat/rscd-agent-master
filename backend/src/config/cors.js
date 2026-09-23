function parseOriginList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function createCorsOptions() {
  const corsOrigin = process.env.CORS_ORIGIN || '*';
  const split = process.env.CORS_SPLIT_PORTS === 'true';
  const frontendPort = process.env.FRONTEND_PORT || '80';

  if (split) {
    const allowList = parseOriginList(corsOrigin);
    return {
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        try {
          const u = new URL(origin);
          const port = u.port || (u.protocol === 'https:' ? '443' : '80');
          if (port === frontendPort) return callback(null, true);
        } catch {
          // fall through
        }
        if (corsOrigin === '*' || allowList.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS blocked'));
      },
      credentials: true,
    };
  }

  return {
    origin: corsOrigin === '*' ? true : parseOriginList(corsOrigin),
    credentials: corsOrigin !== '*',
  };
}

function createSocketCorsOptions() {
  const opts = createCorsOptions();
  if (typeof opts.origin === 'function') {
    return { origin: opts.origin, credentials: true };
  }
  return { origin: opts.origin, credentials: opts.credentials };
}

module.exports = { createCorsOptions, createSocketCorsOptions };
