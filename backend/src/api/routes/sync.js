const express = require('express');
const endpointSync = require('../../services/endpointSync');
const audit = require('../../utils/audit');
const logger = require('../../utils/logger');

const router = express.Router();
const io = (req) => req.app.get('io');

router.get('/status', (req, res) => {
  res.json({ success: true, data: endpointSync.getSyncStatus() });
});

/** Start full sync in background — returns immediately so the portal never blocks. */
router.post('/full', (req, res) => {
  const actor = audit.resolveActor(req);
  const status = endpointSync.getSyncStatus();
  if (status.running) {
    return res.json({ success: true, data: { alreadyRunning: true, ...status } });
  }

  const reason = 'manual';
  setImmediate(() => {
    endpointSync.runFullSync(io(req), { actor, reason, broadcastUi: true }).catch((err) => {
      logger.error(`Background sync failed: ${err.message}`);
    });
  });

  return res.json({ success: true, data: { started: true, reason } });
});

module.exports = router;
