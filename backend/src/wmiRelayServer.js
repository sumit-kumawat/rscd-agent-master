#!/usr/bin/env node
/**
 * WMI relay — runs on the Docker host (Mac/Linux) where VPN/corporate routes exist.
 * The app container calls this via WMI_RELAY_URL=http://host.docker.internal:19500
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
delete process.env.WMI_RELAY_URL;

const http = require('http');
const path = require('path');
const fs = require('fs');
const { runWmiCommand, resolveWmiexec, runWmiProbe } = require('./utils/wmiExec');
const { sanitizeErrorMessage } = require('./utils/wmiCredentials');
const { resolveRelayTarget } = require('./utils/relayDns');
const wmiConfig = require('./config/wmi');
const logger = require('./utils/logger');

const PORT = wmiConfig.relayPort;
const TOKEN = wmiConfig.relayToken;
const BIND = process.env.WMI_RELAY_BIND || '0.0.0.0';
const PROBE_SCRIPT = path.join(__dirname, '../wmi_probe.py');

const HOST_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,253}$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function validateTargetHost(host) {
  const h = String(host || '').trim();
  if (!h) return 'Missing target host';
  if (h.length > 255) return 'Target host too long';
  if (IPV4_RE.test(h)) return null;
  if (HOST_RE.test(h)) return null;
  return 'Invalid target host format';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function identityLabel(username, domain, host) {
  const who = domain ? `${domain}\\${username}` : username;
  return `${who}@${host}`;
}

function start() {
  if (!fs.existsSync(PROBE_SCRIPT)) {
    logger.warn(`WMI probe script missing: ${PROBE_SCRIPT}`);
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        wmiexec: resolveWmiexec(),
        probeScript: fs.existsSync(PROBE_SCRIPT),
        connectTimeoutMs: wmiConfig.connectTimeoutMs,
        connectTimeoutSource: wmiConfig.connectTimeoutSource,
        port: PORT,
        pid: process.pid,
      }));
      return;
    }

    if (req.method !== 'POST' || !['/exec', '/probe'].includes(req.url)) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (TOKEN && req.headers['x-wmi-relay-token'] !== TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }

    let clientGone = false;
    req.on('aborted', () => { clientGone = true; });
    res.on('close', () => { clientGone = true; });

    try {
      const body = JSON.parse(await readBody(req));
      const {
        host, username, password, command, domain = null,
        timeoutMs = wmiConfig.connectTimeoutMs,
        smbOnly = false,
        wmi = true,
      } = body;

      if (!host || !username || !password) {
        if (!clientGone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing host, username, or password' }));
        }
        return;
      }

      const hostErr = validateTargetHost(host);
      if (hostErr) {
        if (!clientGone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: hostErr }));
        }
        return;
      }

      const effectiveTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : wmiConfig.connectTimeoutMs;
      const resolved = await resolveRelayTarget(host);
      const targetHost = resolved.resolvedHost || host;
      const label = identityLabel(username, domain, targetHost);

      if (req.url === '/probe') {
        const started = Date.now();
        if (targetHost !== host) {
          logger.debug(
            `WMI relay resolved ${host} → ${targetHost}`
            + `${resolved.resolvedIp ? ` (${resolved.resolvedIp})` : ''}`,
          );
        }
        logger.debug(`WMI relay probe start: ${label} (timeout ${effectiveTimeout}ms, smbOnly=${smbOnly})`);
        const probe = await runWmiProbe(
          targetHost, username, password, domain, { timeoutMs: effectiveTimeout, smbOnly, wmi },
        );
        const duration = Date.now() - started;
        logger.info(
          `WMI relay probe ${probe.ok ? 'PASS' : 'FAIL'}: ${label} `
          + `category=${probe.failureCategory || 'none'} duration=${duration}ms`,
        );
        if (!clientGone && !res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...probe, relayDurationMs: duration }));
        }
        return;
      }

      if (!command) {
        if (!clientGone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing command' }));
        }
        return;
      }

      if (targetHost !== host) {
        logger.debug(
          `WMI relay resolved ${host} → ${targetHost}`
          + `${resolved.resolvedIp ? ` (${resolved.resolvedIp})` : ''}`,
        );
      }
      logger.debug(`WMI relay exec: ${label} (timeout ${effectiveTimeout}ms)`);

      const result = await runWmiCommand(
        targetHost, username, password, command, domain, effectiveTimeout,
      );

      if (clientGone || res.writableEnded) {
        logger.debug(`WMI relay client gone before response: ${label}`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      const safe = sanitizeErrorMessage(err.message || String(err));
      logger.debug(`WMI relay ${req.url} failed: ${safe}`);
      if (!clientGone && !res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: safe }));
      }
    }
  });

  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 120000;

  server.listen(PORT, BIND, () => {
    const source = wmiConfig.connectTimeoutSource === 'env'
      ? 'WMI_CONNECT_TIMEOUT_MS'
      : `default (${wmiConfig.DEFAULT_CONNECT_TIMEOUT_MS})`;
    logger.info(`WMI relay listening on ${BIND}:${PORT} (pid ${process.pid})`);
    logger.info(`WMI exec: ${resolveWmiexec()}`);
    logger.info(`WMI connect timeout: ${wmiConfig.connectTimeoutMs}ms (from ${source})`);
    if (TOKEN) logger.info('WMI relay token auth enabled');
  });

  return server;
}

process.on('uncaughtException', (err) => {
  logger.error(`WMI relay uncaught: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (err) => {
  logger.error(`WMI relay rejection: ${err?.stack || err}`);
});

if (require.main === module) {
  start();
}

module.exports = { start };
