const express = require('express');
const { getDashboard } = require('../../services/dashboard');

const router = express.Router();

router.get('/', async (req, res) => {
  const filter = { status: req.query.status || '' };
  const data = await getDashboard(filter);
  res.json({ success: true, data });
});

module.exports = router;
