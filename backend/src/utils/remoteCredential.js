/**
 * Remote execution credentials: per-endpoint WMI creds first, else platform chain
 * (rdsroot → rdsmon → Administrator with all configured passwords).
 */
const { resolveCredentialForVm, resolveCredentialsForVm } = require('./wmiCredentials');
const { decryptIfNeeded } = require('./credentialCrypto');

function vmPlain(vm) {
  const plain = { ...vm };
  if (plain.wmiPassword) plain.wmiPassword = decryptIfNeeded(plain.wmiPassword);
  return plain;
}

function resolveRemoteCredential(vm) {
  const plain = vmPlain(vm);
  if (plain.wmiUsername && plain.wmiPassword) {
    return resolveCredentialForVm(plain);
  }
  const chain = resolveCredentialsForVm(plain);
  return chain[0];
}

function resolveRemoteCredentials(vm) {
  return resolveCredentialsForVm(vmPlain(vm));
}

module.exports = { resolveRemoteCredential, resolveRemoteCredentials, vmPlain };
