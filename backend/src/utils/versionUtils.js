/**
 * Compare BMC/BladeLogic version strings (e.g. 20.02.00.31, 8.7.00.239, 25.4.00.52)
 */
function parseParts(version) {
  return String(version || '')
    .trim()
    .split('.')
    .map((p) => parseInt(p, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parseParts(a);
  const pb = parseParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isBelowVersion(version, threshold) {
  if (!version || version === 'unknown' || version === 'removed') return false;
  return compareVersions(version, threshold) < 0;
}

function isAtOrAboveVersion(version, threshold) {
  if (!version || version === 'unknown' || version === 'removed') return false;
  return compareVersions(version, threshold) >= 0;
}

module.exports = {
  compareVersions,
  isBelowVersion,
  isAtOrAboveVersion,
  DEFAULT_UNINSTALL_BELOW: process.env.UNINSTALL_BELOW_VERSION || '22.4.00',
};
