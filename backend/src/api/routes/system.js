const express = require('express');
const { getWmiRelayStatus } = require('../../utils/wmiExec');
const wmiConfig = require('../../config/wmi');
const { isOperatorAuthenticated, operatorSessionToken } = require('../../middleware/operatorAuth');
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
    operatorApiKeyConfigured: !!process.env.OPERATOR_API_KEY,
  });
});

router.get('/operator-status', (req, res) => {
  const required = !!process.env.OPERATOR_API_KEY;
  res.json({
    success: true,
    required,
    authenticated: isOperatorAuthenticated(req),
  });
});

function triggerLoginProvision(req) {
  const io = req.app.get('io');
  const actor = audit.resolveActor(req);
  audit.log({
    action: 'login.success',
    status: 'success',
    actor,
    message: 'Operator login successful — provisioning queued',
    category: 'system',
  }, io);
  queueProvisionOnLogin(io, { reason: 'login', actor });
}

router.post('/operator-session', (req, res) => {
  const expected = process.env.OPERATOR_API_KEY;
  if (!expected) {
    triggerLoginProvision(req);
    return res.json({ success: true, required: false, authenticated: true });
  }

  const provided = req.body?.key
    || req.headers['x-operator-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!provided || provided !== expected) {
    return res.status(403).json({
      success: false,
      message: 'Invalid operator key — check OPERATOR_API_KEY in your server .env',
    });
  }

  const token = operatorSessionToken();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `operator_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`,
  );
  triggerLoginProvision(req);
  return res.json({ success: true, required: true, authenticated: true });
});

router.delete('/operator-session', (req, res) => {
  res.setHeader('Set-Cookie', 'operator_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return res.json({ success: true, authenticated: false });
});

module.exports = router;
