/**
 * WMI operations for endpoint detail tabs, local users, and power control.
 */
const agentProbe = require('./agentProbe');
const { runWmiPowershell, runWmiCmd, runWmiCmdAsync } = require('../utils/wmiExec');
const opsCred = require('../config/operationsCredential');
const { parseProvisionUsers } = require('../config/localUsers');
const wmiConfig = require('../config/wmi');
const { detectRscd } = require('./rscdDetection');
const { sanitizeErrorMessage } = require('../utils/wmiCredentials');
const audit = require('../utils/audit');

const QUERY_TIMEOUT = wmiConfig.queryTimeoutMs;

function verifyOpsPassword(submitted) {
  if (!submitted || submitted !== opsCred.password) {
    throw new Error('Invalid operations password');
  }
}

function opsSession(vm) {
  return {
    host: vm.fqdn || vm.name || vm.ip,
    username: opsCred.username,
    password: opsCred.password,
    domain: opsCred.domain || null,
  };
}

async function connectOps(vm) {
  const plain = { ...vm, wmiUsername: opsCred.username, wmiPassword: opsCred.password, wmiDomain: opsCred.domain };
  try {
    return await agentProbe.connectWmi(plain);
  } catch {
    return opsSession(vm);
  }
}

async function wmiPs(session, script, timeoutMs = QUERY_TIMEOUT) {
  const r = await runWmiPowershell(
    session.host, session.username, session.password, script, session.domain || null, timeoutMs,
  );
  return r.stdout || '';
}

async function wmiCmd(session, cmd, timeoutMs = QUERY_TIMEOUT, async = false) {
  const runner = async ? runWmiCmdAsync : runWmiCmd;
  const r = await runner(session.host, session.username, session.password, cmd, session.domain || null, timeoutMs);
  return r.stdout || '';
}

function parseKvLines(stdout) {
  const data = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_]+):(.+)$/);
    if (m) data[m[1]] = m[2].trim();
  }
  return data;
}

async function fetchOverview(vm) {
  const session = await connectOps(vm);
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    'Write-Output ("HOSTNAME:" + $env:COMPUTERNAME)',
    '$os=Get-CimInstance Win32_OperatingSystem',
    'Write-Output ("OS:" + $os.Caption)',
    'Write-Output ("OS_VERSION:" + $os.Version)',
    '$cs=Get-CimInstance Win32_ComputerSystem',
    'Write-Output ("MODEL:" + $cs.Model)',
    '$bios=Get-CimInstance Win32_BIOS',
    'Write-Output ("SERVICE_TAG:" + $bios.SerialNumber)',
    '$boot=$os.LastBootUpTime',
    'if($boot){ Write-Output ("LAST_BOOT:" + $boot.ToString("o")) }',
  ].join('\n');
  const out = await wmiPs(session, script);
  const kv = parseKvLines(out);
  const online = vm.status === 'online' || vm.connectivityState === 'online';
  return {
    hostname: kv.HOSTNAME || vm.name,
    ip: vm.ip || '',
    os: kv.OS || vm.os || 'Windows',
    osVersion: kv.OS_VERSION || vm.osVersion || '',
    model: kv.MODEL || vm.hardwareModel || '',
    serviceTag: kv.SERVICE_TAG || vm.serviceTag || '',
    lastSeen: vm.lastSeenAt || vm.lastCheck,
    lastBoot: kv.LAST_BOOT || null,
    health: online ? 'healthy' : (vm.connectivityState || vm.status || 'unknown'),
    powerState: vm.powerState || (online ? 'on' : 'unknown'),
  };
}

async function fetchSystem(vm) {
  const session = await connectOps(vm);
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    '$cpu=Get-CimInstance Win32_Processor|Select-Object -First 1',
    'Write-Output ("CPU:" + $cpu.Name)',
    'Write-Output ("CPU_CORES:" + $cpu.NumberOfCores)',
    '$ram=[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,2)',
    'Write-Output ("RAM_GB:" + $ram)',
    'Get-CimInstance Win32_LogicalDisk|Where-Object{$_.DriveType -eq 3}|ForEach-Object{',
    '  Write-Output ("DISK:" + $_.DeviceID + "|" + [math]::Round($_.Size/1GB,1) + "GB|" + [math]::Round($_.FreeSpace/1GB,1) + "GB free")',
    '}',
    'Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue|Where-Object{$_.IPAddress -notlike "127.*"}|ForEach-Object{',
    '  Write-Output ("NIC:" + $_.InterfaceAlias + "|" + $_.IPAddress)',
    '}',
  ].join('\n');
  const out = await wmiPs(session, script);
  const cpu = (out.match(/CPU:(.+)/) || [])[1] || '';
  const cores = (out.match(/CPU_CORES:(\d+)/) || [])[1] || '';
  const ram = (out.match(/RAM_GB:([\d.]+)/) || [])[1] || '';
  const disks = out.split('\n').filter((l) => l.startsWith('DISK:')).map((l) => l.slice(5));
  const nics = out.split('\n').filter((l) => l.startsWith('NIC:')).map((l) => l.slice(4));
  return { cpu, cores, ramGb: ram, disks, networkInterfaces: nics };
}

async function fetchLocalUsers(vm) {
  const required = parseProvisionUsers().map((u) => ({
    key: u.username.toLowerCase() === 'administrator' ? 'Administrator' : u.username,
    configName: u.username,
  }));
  const session = await connectOps(vm);
  const names = required.map((r) => r.key).join("','");
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    `$names=@('${names}')`,
    'foreach($n in $names){',
    '  $u=Get-LocalUser -Name $n -EA SilentlyContinue',
    '  if($u){',
    '    $groups=(Get-LocalGroupMember -Group Administrators -EA SilentlyContinue|Where-Object{$_.Name -like "*\\$n"}|ForEach-Object{$_.Name}) -join ","',
    '    $ll=if($u.LastLogon){$u.LastLogon.ToString("o")}else{""}',
    '    Write-Output ("USER:" + $n + "|present|enabled:" + $u.Enabled + "|groups:" + $groups + "|lastlogin:" + $ll)',
    '  } else { Write-Output ("USER:" + $n + "|missing") }',
    '}',
  ].join('\n');
  const out = await wmiPs(session, script);
  const users = required.map((req) => {
    const line = out.split('\n').find((l) => l.toLowerCase().includes(`user:${req.key.toLowerCase()}`));
    if (!line || line.includes('|missing')) {
      return { name: req.configName, present: false, enabled: false, groups: [], lastLogin: null };
    }
    const enabled = /enabled:True/i.test(line);
    const groupsMatch = line.match(/groups:([^|]+)/);
    const lastMatch = line.match(/lastlogin:(.*)$/);
    return {
      name: req.configName,
      present: true,
      enabled,
      groups: groupsMatch ? groupsMatch[1].split(',').filter(Boolean) : [],
      lastLogin: lastMatch && lastMatch[1] ? lastMatch[1] : null,
    };
  });
  const present = users.filter((u) => u.present).length;
  return { required: users.length, present, users, checkedAt: new Date() };
}

async function fetchSoftware(vm) {
  const session = await connectOps(vm);
  const registrySoftware = require('./registrySoftware');
  const { programs, agents, capturedAt } = await registrySoftware.fetchInstalledPrograms(session, QUERY_TIMEOUT * 3);
  return {
    programs: programs.map((p) => ({ name: p.displayName, version: p.version, publisher: p.publisher })),
    agents,
    capturedAt,
  };
}

async function fetchRscd(vm, onLog = () => {}) {
  const session = await connectOps(vm);
  const state = await detectRscd(session, onLog, { passwords: [opsCred.password] });
  return {
    serviceInstalled: state.serviceInstalled,
    serviceStatus: state.serviceStatus,
    productCodes: state.productCodes,
    programs: state.programs,
    installPaths: state.installPaths || [],
    agentVersion: vm.version,
    agentStatus: vm.agentStatus,
    errors: state.errors || [],
  };
}

async function fetchPowerState(vm) {
  const online = vm.status === 'online' || vm.connectivityState === 'online';
  if (!online) return { state: vm.powerState || 'unknown', source: 'connectivity' };
  try {
    const session = await connectOps(vm);
    const out = await wmiCmd(session, 'echo POWER_PROBE_OK', QUERY_TIMEOUT);
    if (/POWER_PROBE_OK/i.test(out)) return { state: 'on', source: 'wmi' };
  } catch {
    // fall through
  }
  return { state: online ? 'on' : 'unknown', source: 'probe' };
}

const POWER_COMMANDS = {
  power_off_graceful: 'shutdown /s /t 60 /c "RSCD Portal graceful shutdown"',
  power_off_force: 'shutdown /s /f /t 0',
  restart_graceful: 'shutdown /r /t 60 /c "RSCD Portal graceful restart"',
  restart_force: 'shutdown /r /f /t 0',
  reset: 'shutdown /r /f /t 0',
  power_cycle: null,
  graceful_shutdown: 'shutdown /s /t 0',
  power_on: null,
  wake_on_lan: null,
};

async function executePower(vm, action, password, io, actor) {
  verifyOpsPassword(password);
  const cmd = POWER_COMMANDS[action];
  if (!cmd) {
    throw new Error(`Power action "${action}" is not supported via WMI on this endpoint`);
  }
  const session = await connectOps(vm);
  const started = Date.now();
  await audit.log({
    action: `power.${action}`,
    status: 'started',
    actor,
    vmId: vm._id,
    vmName: vm.name,
    message: `Power ${action} initiated on ${vm.name}`,
  }, io);
  try {
    await runWmiCmdAsync(session.host, session.username, session.password, cmd, session.domain || null, QUERY_TIMEOUT);
    await audit.log({
      action: `power.${action}`,
      status: 'success',
      actor,
      vmId: vm._id,
      vmName: vm.name,
      durationMs: Date.now() - started,
      message: `Power ${action} command sent to ${vm.name}`,
    }, io);
    return { ok: true, action, state: action.includes('off') ? 'off' : 'unknown' };
  } catch (err) {
    const msg = sanitizeErrorMessage(err.message, [password]);
    await audit.log({
      action: `power.${action}`,
      status: 'failed',
      actor,
      vmId: vm._id,
      vmName: vm.name,
      durationMs: Date.now() - started,
      level: 'error',
      message: msg,
    }, io);
    throw new Error(msg);
  }
}

function consoleInfo(vm) {
  const host = vm.fqdn || vm.name || vm.ip;
  return {
    supported: !!host,
    protocol: 'rdp',
    url: host ? `rdp://full%20address=s:${host}` : null,
    instructions: host
      ? `Open Remote Desktop Connection to ${host} using the RDSROOT account.`
      : 'No hostname available for console launch.',
  };
}

module.exports = {
  opsCred,
  verifyOpsPassword,
  connectOps,
  fetchOverview,
  fetchSystem,
  fetchLocalUsers,
  fetchSoftware,
  fetchRscd,
  fetchPowerState,
  executePower,
  consoleInfo,
  POWER_COMMANDS,
};
