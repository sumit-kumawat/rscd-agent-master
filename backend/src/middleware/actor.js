const { resolveActor } = require('../utils/audit');

function attachActor(req, res, next) {
  req.operatorActor = resolveActor(req);
  next();
}

module.exports = { attachActor };
