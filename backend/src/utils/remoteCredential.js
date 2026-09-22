/**
 * Remote execution credentials: per-endpoint WMI creds first, else fixed Administrator / Helix@dm1n.
 * Never expose passwords outside server-side execution.
 */
const uninstallCred = require('../config/uninstallCredential');
const { resolveCredentialForVm } = require('./wmiCredentials');
const { decryptIfNeeded } = require('./credentialCrypto');

function resolveRemoteCredential(vm) {
  const plain = { ...vm };
  if (plain.wmiPassword) plain.wmiPassword = decryptIfNeeded(plain.wmiPassword);

  if (plain.wmiUsername && plain.wmiPassword) {
    return resolveCredentialForVm(plain);
  }

  return {
    username: uninstallCred.username,
    password: uninstallCred.password,
    domain: uninstallCred.domain || null,
    label: uninstallCred.label || uninstallCred.username,
  };
}

module.exports = { resolveRemoteCredential };
