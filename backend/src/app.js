require('dotenv').config();
const path = require('path');
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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    platform: 'windows-only',
    connectivity: 'wmi',
    version: '2.0.0',
  });
});

app.use('/api/vms', vmRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/search', searchRoutes);

const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
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
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

connectDB().then(() => {
  server.listen(PORT, () => {
    logger.info(`RSCD Manager ${isProd ? '(production)' : '(dev)'} on port ${PORT}`);
    if (isProd && !process.env.OPERATOR_API_KEY) {
      logger.warn('OPERATOR_API_KEY not set — destructive API actions are unprotected');
    }
    try {
      const { resolveWmiexec } = require('./utils/wmiExec');
      logger.info(`WMI ready: ${resolveWmiexec()}`);
    } catch (err) {
      logger.warn(`WMI not available: ${err.message}`);
    }
    monitor.start(io);
  });
});

module.exports = { app, server };
