const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { getWmiRelayStatus } = require('../../utils/wmiExec');
const wmiConfig = require('../../config/wmi');
const { queueProvisionOnLogin } = require('../../services/localUserProvision');
const audit = require('../../utils/audit');
const { requireOperator } = require('../../middleware/operatorAuth');

const execFileAsync = promisify(execFile);
const router = express.Router();

router.get('/wmi-relay', async (req, res) => {
  const relay = await getWmiRelayStatus();
  res.json({
    success: true,
    relay,
    connectTimeoutMs: wmiConfig.connectTimeoutMs,
    connectTimeoutSource: wmiConfig.connectTimeoutSource,
  });
});

function triggerLoginProvision(req) {
  const io = req.app.get('io');
  const actor = audit.resolveActor(req);
  audit.log({
    action: 'login.success',
    status: 'success',
    actor,
    message: 'User session started — provisioning queued',
    category: 'system',
  }, io);
  queueProvisionOnLogin(io, { reason: 'login', actor });
}

router.post('/login', (req, res) => {
  triggerLoginProvision(req);
  return res.json({ success: true, authenticated: true });
});

/** Drop all MongoDB collections (fresh start). Requires operator + confirm flag. */
router.post('/db-reset', requireOperator, async (req, res) => {
  if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
    return res.status(400).json({
      success: false,
      message: 'Send { "confirm": true } to drop all collections',
    });
  }
  const script = path.join(__dirname, '../../scripts/db-reset.js');
  const actor = audit.resolveActor(req);
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, '--yes'], {
      cwd: path.join(__dirname, '../..'),
      env: process.env,
      timeout: 120000,
    });
    audit.log({
      action: 'system.db_reset',
      status: 'success',
      actor,
      message: 'Database reset — all collections dropped',
      category: 'system',
    }, req.app.get('io'));
    return res.json({ success: true, message: 'Database reset complete', log: stdout });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      log: err.stdout || err.stderr || '',
    });
  }
});

/** @deprecated use POST /login */
router.post('/operator-session', (req, res) => {
  triggerLoginProvision(req);
  return res.json({ success: true, authenticated: true });
});

module.exports = router;
