const express = require('express');
const activityLog = require('../../services/activityLog');

const router = express.Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const { category, level, search } = req.query;
  const logs = await activityLog.list({ limit, category, level, search });
  res.json({ success: true, data: logs, total: logs.length });
});

module.exports = router;
