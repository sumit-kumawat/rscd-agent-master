/**
 * Password confirmation for destructive power actions in the UI (matches primary platform user rdsroot).
 * WMI/scripting uses the full platform chain via agentProbe.connectWmi — not this file alone.
 */
module.exports = {
  username: (process.env.RDSROOT_OPERATIONS_USER || 'rdsroot').toLowerCase(),
  password: process.env.RDSROOT_OPERATIONS_PASSWORD || process.env.RDSROOT_PASSWORD || '1Rs50U$D',
  domain: (process.env.RDSROOT_OPERATIONS_DOMAIN || '').trim(),
  label: 'RDSROOT',
};
