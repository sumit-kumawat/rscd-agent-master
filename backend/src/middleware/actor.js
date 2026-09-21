const { resolveActor } = require('../utils/audit');

function attachActor(req, res, next) {
  req.userActor = resolveActor(req);
  next();
}

module.exports = { attachActor };
