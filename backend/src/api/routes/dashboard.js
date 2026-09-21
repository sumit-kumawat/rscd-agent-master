const express = require('express');
const { getDashboard, getDashboardSynced, getDashboardLive } = require('../../services/dashboard');

const router = express.Router();

function parseFilter(req) {
  return { status: req.query.status || '' };
}

router.get('/', async (req, res) => {
  const data = await getDashboard(parseFilter(req));
  res.json({ success: true, data });
});

router.get('/synced', async (req, res) => {
  const data = await getDashboardSynced(parseFilter(req));
  res.json({ success: true, data });
});

router.get('/live', async (req, res) => {
  const data = await getDashboardLive(parseFilter(req));
  res.json({ success: true, data });
});

module.exports = router;
