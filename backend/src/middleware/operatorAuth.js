/** Optional API key for destructive operations (set OPERATOR_API_KEY in env). */
function requireOperator(req, res, next) {
  const expected = process.env.OPERATOR_API_KEY;
  if (!expected) return next();
  const provided = req.headers['x-operator-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (provided && provided === expected) return next();
  return res.status(403).json({ success: false, message: 'Unauthorized — operator credentials required' });
}

module.exports = { requireOperator };
