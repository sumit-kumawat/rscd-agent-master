const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { getWmiRelayStatus } = require('../../utils/wmiExec');
const wmiConfig = require('../../config/wmi');
const { queueProvisionOnLogin } = require('../../services/localUserProvision');
const vcRedist2015 = require('../../services/vcRedist2015');
const endpointReadiness = require('../../services/endpointReadiness');
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
    message: 'User session started',
    category: 'system',
  }, io);
  if (process.env.PROVISION_ON_LOGIN === 'true') {
    queueProvisionOnLogin(io, { reason: 'login', actor });
  }
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
  const script = path.join(__dirname, '../../../scripts/db-reset.js');
  const actor = audit.resolveActor(req);
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, '--yes'], {
      cwd: path.join(__dirname, '../../..'),
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

/**
 * Verify VC++ 2015 x64 on all (or selected) Windows endpoints; install when missing.
 * Body: { "confirm": true, "install": true, "onlineOnly": false, "endpointIds": [] }
 */
router.post('/vcredist-2015/ensure', requireOperator, async (req, res) => {
  if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
    return res.status(400).json({
      success: false,
      message: 'Send { "confirm": true } to run fleet VC++ 2015 x64 check/install',
    });
  }
  const install = req.body?.install !== false && req.body?.install !== 'false';
  const onlineOnly = req.body?.onlineOnly === true || req.body?.onlineOnly === 'true';
  const endpointIds = Array.isArray(req.body?.endpointIds) ? req.body.endpointIds : undefined;
  const actor = audit.resolveActor(req);
  const io = req.app.get('io');

  vcRedist2015.queueFleetEnsure(io, {
    install,
    onlineOnly,
    endpointIds,
    actor,
    reason: 'api',
  });

  return res.json({
    success: true,
    message: install
      ? 'VC++ 2015 x64 verify/install job queued — watch Jobs and Activity logs'
      : 'VC++ 2015 x64 verify job queued — watch Jobs and Activity logs',
    install,
    onlineOnly,
  });
});

/** Check one endpoint by id (sync). Query: ?install=true */
/**
 * Fleet readiness: RSCD uninstalled, local users, VC++ 2015 x64.
 * Body: { "confirm": true, "remediateUsers": false, "remediateVc": true, "onlineOnly": true, "endpointIds": [] }
 */
router.post('/readiness/ensure', requireOperator, async (req, res) => {
  if (req.body?.confirm !== true && req.body?.confirm !== 'true') {
    return res.status(400).json({
      success: false,
      message: 'Send { "confirm": true } to run fleet readiness checks',
    });
  }
  const actor = audit.resolveActor(req);
  const io = req.app.get('io');
  endpointReadiness.queueFleetReadiness(io, {
    remediateUsers: req.body?.remediateUsers === true || req.body?.remediateUsers === 'true',
    remediateVc: req.body?.remediateVc === true || req.body?.remediateVc === 'true',
    onlineOnly: req.body?.onlineOnly !== false && req.body?.onlineOnly !== 'false',
    endpointIds: Array.isArray(req.body?.endpointIds) ? req.body.endpointIds : undefined,
    actor,
    reason: 'api',
  });
  return res.json({
    success: true,
    message: 'Readiness job queued — watch Jobs and endpoint Overview task list',
  });
});

router.post('/vcredist-2015/endpoints/:id', requireOperator, async (req, res) => {
  const VM = require('../../models/VM');
  const vm = await VM.findById(req.params.id).select('+wmiPassword');
  if (!vm) return res.status(404).json({ success: false, message: 'Endpoint not found' });
  const install = req.query.install !== 'false' && req.body?.install !== false;
  const result = await vcRedist2015.ensureOnEndpoint(vm, { install });
  return res.json({ success: result.ok, result });
});

module.exports = router;
