/**
 * Registry-based installed software detection (never Win32_Product).
 */
const wmiConfig = require('../config/wmi');
const { runWmiPowershell } = require('../utils/wmiExec');

const QUERY_TIMEOUT = wmiConfig.queryTimeoutMs;

const REGISTRY_PS = [
  '$ErrorActionPreference="SilentlyContinue"',
  'function Emit-Prog($root,$arch){',
  '  Get-ChildItem $root -EA 0|ForEach-Object{',
  '    $p=Get-ItemProperty $_.PSPath -EA 0',
  '    if(-not $p.DisplayName){ return }',
  '    $un=$p.UninstallString',
  '    $qn=$p.QuietUninstallString',
  '    if(-not $qn -and $un -match "msiexec"){ $qn=$un }',
  '    Write-Output ("PROG:" + ($p.DisplayName -replace "\\|","/") + "|" + ($p.DisplayVersion -or "") + "|" + ($p.Publisher -or "") + "|" + ($p.InstallLocation -or "") + "|" + ($un -replace "\\|","/") + "|" + ($qn -replace "\\|","/") + "|" + $arch + "|" + $root)',
  '  }',
  '}',
  'Emit-Prog "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" "x64"',
  'Emit-Prog "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall" "x86"',
].join('\n');

const RSCD_NAME_PATTERNS = [
  /\brscd\b/i,
  /\bbmc\s*rscd\b/i,
  /remote\s*system\s*call\s*daemon/i,
  /\bbladelogic\b/i,
  /\bbmc\s*agent\b/i,
  /truesight/i,
];

const CROWDSTRIKE_PATTERNS = [
  /crowdstrike/i,
  /falcon\s*sensor/i,
  /\bcs\s*falcon\b/i,
];

const PROTECTED_PRODUCT_PATTERNS = [
  /microsoft\s*visual\s*c\+\+/i,
  /\.net\s*(runtime|framework)/i,
  /windows\s*update/i,
  /^driver\b/i,
];

function normalizeKey(name, version, publisher) {
  return `${String(name || '').trim().toLowerCase()}|${String(version || '').trim()}|${String(publisher || '').trim().toLowerCase()}`;
}

function parsePrograms(stdout) {
  const seen = new Set();
  const programs = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.startsWith('PROG:')) continue;
    const parts = line.slice(5).split('|');
    if (parts.length < 8) continue;
    const [name, version, publisher, installLocation, uninstallString, quietUninstall, architecture, registrySource] = parts;
    const key = normalizeKey(name, version, publisher);
    if (seen.has(key)) continue;
    seen.add(key);
    programs.push({
      name: name.trim(),
      displayName: name.trim(),
      version: (version || '').trim(),
      publisher: (publisher || '').trim(),
      installLocation: (installLocation || '').trim(),
      uninstallString: (uninstallString || '').trim(),
      quietUninstallString: (quietUninstall || '').trim(),
      architecture,
      registrySource,
    });
  }
  return programs;
}

function classifyProgram(program) {
  const text = `${program.displayName} ${program.publisher}`;
  if (RSCD_NAME_PATTERNS.some((re) => re.test(text))) return 'rscd';
  if (CROWDSTRIKE_PATTERNS.some((re) => re.test(text))) return 'crowdstrike';
  return 'other';
}

function isProtectedProduct(program) {
  const text = `${program.displayName} ${program.publisher}`;
  return PROTECTED_PRODUCT_PATTERNS.some((re) => re.test(text));
}

function summarizeAgents(programs) {
  const rscd = programs.filter((p) => classifyProgram(p) === 'rscd');
  const cs = programs.filter((p) => classifyProgram(p) === 'crowdstrike');
  const pick = (list) => {
    if (!list.length) return { status: 'absent', version: '' };
    const best = list.sort((a, b) => String(b.version).localeCompare(String(a.version)))[0];
    return { status: 'installed', version: best.version || 'unknown', program: best };
  };
  return { rscd: pick(rscd), crowdStrike: pick(cs) };
}

async function fetchInstalledPrograms(session, timeoutMs = QUERY_TIMEOUT * 3) {
  const r = await runWmiPowershell(
    session.host,
    session.username,
    session.password,
    REGISTRY_PS,
    session.domain || null,
    timeoutMs,
  );
  const programs = parsePrograms(r.stdout || '');
  const agents = summarizeAgents(programs);
  return { programs, agents, capturedAt: new Date() };
}

function groupProductsByName(programs) {
  const map = new Map();
  for (const p of programs) {
    const name = p.displayName || p.name;
    if (!name) continue;
    if (!map.has(name)) map.set(name, { productName: name, versions: new Map(), endpointIds: new Set() });
    const entry = map.get(name);
    const ver = p.version || '(unknown)';
    entry.versions.set(ver, (entry.versions.get(ver) || 0) + 1);
  }
  return map;
}

module.exports = {
  REGISTRY_PS,
  parsePrograms,
  classifyProgram,
  isProtectedProduct,
  summarizeAgents,
  fetchInstalledPrograms,
  groupProductsByName,
  RSCD_NAME_PATTERNS,
  CROWDSTRIKE_PATTERNS,
};
