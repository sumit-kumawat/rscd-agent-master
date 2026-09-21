/**
 * Local Windows users provisioned on login to managed endpoints.
 * Format: username:password:group (comma-separated). Passwords must never be logged.
 */
const DEFAULT_PROVISION_USERS = [
  { username: 'rdsroot', password: '1Rs50U$D', group: 'Administrators' },
  { username: 'rdsmon', password: 'D0N0harm', group: 'Administrators' },
  { username: 'administrator', password: 'Helix@dm1n', group: 'Administrators' },
];

function parseProvisionUserPair(pair) {
  const parts = String(pair || '').trim().split(':');
  if (parts.length < 2) return null;
  const username = parts[0].trim();
  if (parts.length === 2) {
    const password = parts[1];
    if (!username || !password) return null;
    return { username, password, group: 'Administrators' };
  }
  const group = parts[parts.length - 1].trim() || 'Administrators';
  const password = parts.slice(1, -1).join(':');
  if (!username || !password) return null;
  return { username, password, group };
}

function parseProvisionUsers() {
  const raw = process.env.PROVISION_LOCAL_USERS || process.env.RSCD_PROVISION_USERS || '';
  if (!raw.trim()) {
    return DEFAULT_PROVISION_USERS.map((u) => ({ ...u }));
  }
  const parsed = raw.split(',').map(parseProvisionUserPair).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_PROVISION_USERS.map((u) => ({ ...u }));
}

module.exports = {
  DEFAULT_PROVISION_USERS,
  parseProvisionUsers,
};
