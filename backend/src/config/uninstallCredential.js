/**
 * Optional override for dedicated uninstall-only WMI user (env).
 * Default uninstall path uses the full platform chain via connectForUninstall.
 */
const { normalizeIdentity } = require('../utils/wmiCredentials');
const { getPlatformCredentialChain } = require('./platformCredentials');

const chain = getPlatformCredentialChain();
const adminHelix = chain.find((c) => c.username.toLowerCase() === 'administrator') || chain[chain.length - 1];

const cred = normalizeIdentity({
  username: process.env.RSCD_UNINSTALL_USER || adminHelix.username,
  password: process.env.RSCD_UNINSTALL_PASSWORD || adminHelix.password,
  domain: process.env.RSCD_UNINSTALL_DOMAIN || process.env.WMI_DEFAULT_DOMAIN || '',
});

module.exports = cred;
