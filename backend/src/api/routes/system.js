const express = require('express');
const { getWmiRelayStatus } = require('../../utils/wmiExec');
const wmiConfig = require('../../config/wmi');
const { queueProvisionOnLogin } = require('../../services/localUserProvision');
const audit = require('../../utils/audit');

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

/** @deprecated use POST /login */
router.post('/operator-session', (req, res) => {
  triggerLoginProvision(req);
  return res.json({ success: true, authenticated: true });
});

module.exports = router;
