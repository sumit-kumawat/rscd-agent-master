const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.WMI_CREDENTIAL_KEY || '';
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plaintext) {
  if (!plaintext) return '';
  const key = getKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(stored) {
  if (!stored) return '';
  if (!String(stored).startsWith(PREFIX)) return stored;
  const key = getKey();
  if (!key) return '';
  const body = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(':');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptIfNeeded(value) {
  if (!value || String(value).startsWith(PREFIX)) return value;
  return encrypt(value);
}

function decryptIfNeeded(value) {
  if (!value) return '';
  return decrypt(value);
}

module.exports = {
  encrypt, decrypt, encryptIfNeeded, decryptIfNeeded, isEncrypted: (v) => String(v || '').startsWith(PREFIX),
};
