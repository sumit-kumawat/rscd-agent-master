/**
 * Fixed credential for RSCD bulk/single uninstall — not configurable from UI.
 * Uses Administrator / Helix@dm1n by default (same as provisioned local admin).
 */
const { normalizeIdentity } = require('../utils/wmiCredentials');

const cred = normalizeIdentity({
  username: process.env.RSCD_UNINSTALL_USER || 'Administrator',
  password: process.env.RSCD_UNINSTALL_PASSWORD || 'Helix@dm1n',
  domain: process.env.RSCD_UNINSTALL_DOMAIN || process.env.WMI_DEFAULT_DOMAIN || '',
});

module.exports = cred;
