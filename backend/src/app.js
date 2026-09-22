require('dotenv').config();
const path = require('path');
const fs = require('fs');

function readAppVersion() {
  const candidates = [
    path.join(__dirname, '../../version.txt'),
    path.join(__dirname, '../version.txt'),
  ];
  for (const file of candidates) {
    try {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v;
    } catch {
      // try next path
    }
  }
  return '2.0.1';
}

const APP_VERSION = readAppVersion();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const monitor = require('./services/monitor');
const logger = require('./utils/logger');

const vmRoutes = require('./api/routes/vms');
const jobRoutes = require('./api/routes/jobs');
const logRoutes = require('./api/routes/logs');
const searchRoutes = require('./api/routes/search');
const systemRoutes = require('./api/routes/system');
const dashboardRoutes = require('./api/routes/dashboard');
const syncRoutes = require('./api/routes/sync');
const endpointSync = require('./services/endpointSync');
const endpointsRoutes = require('./api/routes/endpoints');
const packagesRoutes = require('./api/routes/packages');
const deploymentsRoutes = require('./api/routes/deployments');
const mongoose = require('mongoose');

const isProd = process.env.NODE_ENV === 'production';
const corsOrigin = process.env.CORS_ORIGIN || '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin === '*' ? '*' : corsOrigin.split(',') } });
app.set('io', io);
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',') }));
app.use(express.json({ limit: '20mb' }));
const { attachActor } = require('./middleware/actor');
app.use(attachActor);

app.get('/health', (req, res) => {
  let wmi = {};
  try {
    const wmiConfig = require('./config/wmi');
    wmi = {
      connectTimeoutMs: wmiConfig.connectTimeoutMs,
      connectTimeoutSource: wmiConfig.connectTimeoutSource,
      commandTimeoutMs: wmiConfig.commandTimeoutMs,
      relayConfigured: !!wmiConfig.relayUrl,
    };
  } catch {
    // WMI config unavailable
  }
  res.json({
    status: 'ok',
    platform: 'windows-only',
    connectivity: 'wmi',
    version: APP_VERSION,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    wmi,
    uptimeSec: Math.round(process.uptime()),
  });
});

app.get('/ready', async (req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  let dbPing = false;
  if (dbOk) {
    try {
      await mongoose.connection.db.admin().command({ ping: 1 });
      dbPing = true;
    } catch {
      dbPing = false;
    }
  }
  const sync = endpointSync.getSyncStatus();
  const ready = dbPing;
  res.status(ready ? 200 : 503).json({
    ready,
    version: APP_VERSION,
    mongodb: dbPing ? 'ok' : 'fail',
    sync: { running: sync.running, lastSyncAt: sync.lastSyncAt },
    uptimeSec: Math.round(process.uptime()),
  });
});

app.use('/api/vms', vmRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/endpoints', endpointsRoutes);
app.use('/api/packages', packagesRoutes);
app.use('/api/deployments', deploymentsRoutes);

const publicDir = path.join(__dirname, '../public');
app.use('/assets', express.static(path.join(publicDir, 'assets'), {
  maxAge: isProd ? '365d' : 0,
  immutable: isProd,
}));
app.use(express.static(publicDir, {
  maxAge: 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.get(/^\/(?!api|socket\.io|assets|favicon\.svg|icons\.svg).*/, (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ message: 'Not found' });
  });
});

io.on('connection', (socket) => {
  socket.on('join:job', (id) => socket.join(`job:${id}`));
});

const PORT = process.env.PORT || 5000;

const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down`);
  monitor.timer && clearInterval(monitor.timer);
  endpointSync.stopHourlySync();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const bootStarted = Date.now();
connectDB().then(() => {
  server.listen(PORT, () => {
    const bootMs = Date.now() - bootStarted;
    logger.info(`RSCD Manager v${APP_VERSION} ${isProd ? '(production)' : '(dev)'} on port ${PORT} — boot ${bootMs}ms`);
    logger.info(`MongoDB: connected | API: /api | Health: /health | Ready: /ready`);
    try {
      const wmiConfig = require('./config/wmi');
      const { resolveWmiexec, checkWmiRelay } = require('./utils/wmiExec');
      const source = wmiConfig.connectTimeoutSource === 'env'
        ? 'WMI_CONNECT_TIMEOUT_MS'
        : `default (${wmiConfig.DEFAULT_CONNECT_TIMEOUT_MS})`;
      logger.info(`WMI connect timeout: ${wmiConfig.connectTimeoutMs}ms (from ${source})`);
      if (wmiConfig.connectTimeoutSource === 'invalid-env') {
        logger.warn(
          `WMI_CONNECT_TIMEOUT_MS is invalid — using default ${wmiConfig.DEFAULT_CONNECT_TIMEOUT_MS}ms`,
        );
      }
      monitor.start(io, { deferInitialRun: wmiConfig.startupCheckOnBoot });
      endpointSync.startHourlySync(io);

      if (wmiConfig.startupCheckOnBoot) {
        (async () => {
          if (wmiConfig.relayUrl) {
            let relayOk = false;
            for (let attempt = 0; attempt < 15; attempt++) {
              relayOk = await checkWmiRelay();
              if (relayOk) break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            if (relayOk) logger.info(`WMI relay ready: ${wmiConfig.relayUrl}`);
            else logger.error(`WMI relay unreachable at ${wmiConfig.relayUrl} — run ./scripts/start-wmi-relay.sh on the host`);
          } else {
            logger.info(`WMI ready: ${resolveWmiexec()}`);
          }
          await monitor.startupSweep();
        })().catch((err) => {
          logger.warn(`Startup VM check: ${err.message}`);
        });
      } else if (wmiConfig.relayUrl) {
        checkWmiRelay().then((ok) => {
          if (ok) logger.info(`WMI relay ready: ${wmiConfig.relayUrl}`);
          else logger.error(`WMI relay unreachable at ${wmiConfig.relayUrl} — run ./scripts/start-wmi-relay.sh on the host`);
        });
      } else {
        logger.info(`WMI ready: ${resolveWmiexec()}`);
      }
    } catch (err) {
      logger.warn(`WMI not available: ${err.message}`);
      monitor.start(io);
    }
  });
});

module.exports = { app, server };
