/** Legacy middleware — portal is open to all authenticated users; no operator gate. */
function requireOperator(req, res, next) {
  return next();
}

function isOperatorAuthenticated() {
  return true;
}

function operatorSessionToken() {
  return null;
}

module.exports = { requireOperator, isOperatorAuthenticated, operatorSessionToken };
