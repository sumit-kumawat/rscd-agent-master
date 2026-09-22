/**
 * Canonical BMC BladeLogic / RSCD installation paths on Windows endpoints.
 * Used for WMI probe, detection, uninstall directory cleanup, and install-root hints.
 */
const RSCD_KNOWN_PATHS = [
  'C:\\Program Files\\BMC Software\\BladeLogic\\RSCD',
  'C:\\PROGRA~1\\BMCSOF~1\\BLADEL~1\\NSH',
  'C:\\Program Files\\BMC Software\\BladeLogic\\NSH',
  'C:\\Program Files\\BMC Software\\BladeLogic26.2_slnt\\NSH',
  'C:\\Program Files\\BMC Software\\BladeLogic244p1\\NSH',
  'C:\\Program Files\\BMC Software\\BladeLogic26.2\\NSH',
  'C:\\Program Files (x86)\\BMC Software\\BladeLogic\\NSH',
];

/** Primary default when registry does not specify InstallDir */
const DEFAULT_INSTALL_ROOT = RSCD_KNOWN_PATHS[0];

/** All paths to scan (deduped, order preserved — RSCD service root first) */
function getRscdCandidateRoots() {
  return [...RSCD_KNOWN_PATHS];
}

/** Paths for uninstall verification and directory removal (includes parent BMC trees) */
function getRscdCleanupRoots() {
  const extra = [
    'C:\\Program Files\\BMC Software',
    'C:\\Program Files (x86)\\BMC Software',
    'C:\\ProgramData\\BMC',
  ];
  const seen = new Set();
  const out = [];
  for (const p of [...RSCD_KNOWN_PATHS, ...extra]) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Escape path for embedding in PowerShell single-quoted strings */
function psQuote(path) {
  return String(path).replace(/'/g, "''");
}

/** PowerShell array literal: @('path1','path2') */
function powershellRootsArray(paths = RSCD_KNOWN_PATHS) {
  return `@('${paths.map(psQuote).join("','")}')`;
}

/** PowerShell block: foreach known root, emit DIR: if Test-Path */
function powershellEmitExistingDirs(paths = RSCD_KNOWN_PATHS) {
  return paths.map((p) => (
    `if(Test-Path '${psQuote(p)}'){ Write-Output "DIR:${p}" }`
  )).join('\n');
}

/** Pick best install root from probe/detection (prefer RSCD\\ over NSH variants) */
function resolveInstallRoot(detectedPath, hintRoot) {
  const hint = String(hintRoot || '').trim();
  if (hint && RSCD_KNOWN_PATHS.some((p) => p.toLowerCase() === hint.toLowerCase())) return hint;
  const det = String(detectedPath || '').trim();
  if (det) {
    const match = RSCD_KNOWN_PATHS.find((p) => det.toLowerCase().startsWith(p.toLowerCase())
      || p.toLowerCase().startsWith(det.toLowerCase()));
    if (match) return match;
    return det;
  }
  return DEFAULT_INSTALL_ROOT;
}

module.exports = {
  RSCD_KNOWN_PATHS,
  DEFAULT_INSTALL_ROOT,
  getRscdCandidateRoots,
  getRscdCleanupRoots,
  powershellRootsArray,
  powershellEmitExistingDirs,
  resolveInstallRoot,
};
