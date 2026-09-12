#!/usr/bin/env python3
"""
Staged WMI connectivity probe — credentials via stdin JSON (never argv).
Each blocking stage runs in an isolated subprocess so timeouts cannot hang the relay.
"""
from __future__ import print_function

import json
import multiprocessing
import os
import socket
import sys
import time
import traceback

# Impacket is imported inside worker subprocesses to keep the parent process light.


def step(status, detail='', duration_ms=0):
    return {
        'status': status,
        'detail': str(detail)[:500] if detail else '',
        'durationMs': int(duration_ms),
    }


def tcp_check(host, port, timeout_sec):
    started = time.time()
    try:
        sock = socket.create_connection((host, port), timeout=timeout_sec)
        sock.close()
        return step('PASS', 'TCP {0} open'.format(port), int((time.time() - started) * 1000))
    except socket.timeout:
        return step('FAIL', 'TCP timeout on port {0}'.format(port), int((time.time() - started) * 1000))
    except Exception as exc:
        return step('FAIL', str(exc), int((time.time() - started) * 1000))


def _smb_worker(host, username, password, domain, out_queue):
    try:
        from impacket.smbconnection import SMBConnection
        smb = SMBConnection(host, host, timeout=15)
        smb.login(username, password, domain or '')
        dialect = smb.getDialect()
        smb.logoff()
        out_queue.put(('ok', 'SMB dialect {0}'.format(dialect)))
    except Exception as exc:
        out_queue.put(('fail', str(exc)))


def _wmi_worker(host, username, password, domain, out_queue):
    try:
        from impacket.dcerpc.v5.dcomrt import DCOMConnection
        from impacket.dcerpc.v5.dcom import wmi
        from impacket.dcerpc.v5.dtypes import NULL
        dcom = DCOMConnection(
            host, username, password, domain or '',
            '', '', oxidResolver=True, doKerberos=False, remoteHost=host,
        )
        try:
            i_iface = dcom.CoCreateInstanceEx(wmi.CLSID_WbemLevel1Login, wmi.IID_IWbemLevel1Login)
            i_login = wmi.IWbemLevel1Login(i_iface)
            i_services = i_login.NTLMLogin('//./root/cimv2', NULL, NULL)
            i_login.RemRelease()
            i_services.RemRelease()
        finally:
            dcom.disconnect()
        out_queue.put(('ok', 'WMI DCOM login succeeded'))
    except Exception as exc:
        out_queue.put(('fail', str(exc)))


def run_isolated(worker_fn, args, timeout_sec, label):
    started = time.time()
    queue = multiprocessing.Queue()
    proc = multiprocessing.Process(target=worker_fn, args=args + (queue,))
    proc.daemon = True
    proc.start()
    proc.join(timeout_sec)
    duration = int((time.time() - started) * 1000)

    if proc.is_alive():
        proc.terminate()
        proc.join(2)
        if proc.is_alive():
            proc.kill()
            proc.join(1)
        return step('FAIL', '{0} timed out after {1}s'.format(label, timeout_sec), duration), 'timeout'

    if queue.empty():
        return step('FAIL', '{0} produced no result'.format(label), duration), 'unknown'

    status, detail = queue.get()
    if status == 'ok':
        return step('PASS', detail, duration), None

    msg = detail or '{0} failed'.format(label)
    lower = msg.lower()
    if 'logon_failure' in lower or 'status_logon' in lower:
        return step('FAIL', 'SMB authentication failed — invalid credentials or domain', duration), 'auth_failed'
    if 'access is denied' in lower or 'status_access_denied' in lower:
        return step('FAIL', 'WMI access denied — insufficient privileges', duration), 'permission_denied'
    if 'rpc_s_server_unavailable' in lower or 'stringbinding' in lower:
        return step(
            'FAIL',
            'RPC/WMI endpoint unavailable — Windows firewall may block DCOM dynamic ports (49152-65535)',
            duration,
        ), 'wmi_unavailable'
    if 'timed out' in lower:
        return step('FAIL', msg, duration), 'wmi_timeout'
    return step('FAIL', msg, duration), 'wmi_failed'


def smb_check(host, username, password, domain, timeout_sec):
    result, category = run_isolated(_smb_worker, (host, username, password, domain), timeout_sec, 'SMB')
    return result, category


def wmi_check(host, username, password, domain, timeout_sec):
    result, category = run_isolated(_wmi_worker, (host, username, password, domain), timeout_sec, 'WMI/DCOM')
    return result, category


def expand_host_candidates(host):
    host = str(host or '').strip()
    if not host:
        return []
    candidates = [host]
    if '.' not in host:
        raw_suffixes = os.environ.get('WMI_DNS_SUFFIXES') or os.environ.get('WMI_DNS_SUFFIX') or 'corp.helixops.ai,bmc.com'
        for suffix in raw_suffixes.split(','):
            suffix = suffix.strip()
            if suffix:
                candidates.append('{0}.{1}'.format(host, suffix))
    return candidates


def is_ipv4(addr):
    parts = str(addr).split('.')
    if len(parts) != 4:
        return False
    try:
        return all(0 <= int(p) <= 255 for p in parts)
    except ValueError:
        return False


def resolve_probe_host(host):
    for candidate in expand_host_candidates(host):
        if is_ipv4(candidate):
            return candidate, candidate
        try:
            ip = socket.gethostbyname(candidate)
            if ip:
                return candidate, ip
        except Exception:
            continue
    return host, None


def run_probe(req):
    raw_host = str(req.get('host') or '').strip()
    host, resolved_ip = resolve_probe_host(raw_host)
    username = str(req.get('username') or '').strip()
    password = str(req.get('password') or '')
    domain = str(req.get('domain') or '').strip()
    timeout_ms = int(req.get('timeoutMs') or 45000)
    smb_only = bool(req.get('smbOnly'))
    run_wmi = bool(req.get('wmi')) if 'wmi' in req else not smb_only
    skip_tcp = bool(req.get('skipTcp'))

    timeout_sec = max(5, min(120, timeout_ms // 1000))
    tcp_timeout = min(5, timeout_sec)
    smb_timeout = min(15, max(5, timeout_sec // 3))

    stages = {
        'target': host if host == raw_host else '{0} ({1})'.format(raw_host, host),
        'tcp445': step('SKIP'),
        'tcp135': step('SKIP'),
        'network': step('SKIP'),
        'smb': step('SKIP'),
        'rpc': step('SKIP'),
        'wmi': step('SKIP'),
        'authentication': step('SKIP'),
        'authorization': step('SKIP'),
        'command': step('SKIP'),
    }
    failure_category = None
    started_at = time.time()

    def fail(error, category, overall_detail=None):
        for k in ['tcp445', 'tcp135', 'network', 'smb', 'rpc', 'wmi', 'authentication', 'authorization', 'command']:
            if stages[k]['status'] == 'SKIP':
                stages[k] = step('NOT_TESTABLE', 'Not tested due to prior stage failure')
        return {
            'ok': False,
            'error': error,
            'stages': stages,
            'overall': step('FAIL', overall_detail or error),
            'failureCategory': category,
            'durationMs': int((time.time() - started_at) * 1000),
            'timeoutMs': timeout_ms,
        }

    if not host or not username or not password:
        return fail('Missing host, username, or password', 'UNKNOWN')

    if not skip_tcp:
        stages['tcp445'] = tcp_check(host, 445, tcp_timeout)
        stages['tcp135'] = tcp_check(host, 135, tcp_timeout)
        if stages['tcp445']['status'] == 'FAIL':
            stages['network'] = stages['tcp445']
            return fail(
                stages['tcp445']['detail'] or 'SMB port 445 unreachable',
                'TCP_TIMEOUT' if 'timeout' in (stages['tcp445']['detail'] or '').lower() else 'SMB_UNREACHABLE',
            )
        if stages['tcp135']['status'] == 'FAIL':
            stages['network'] = step('PASS', 'TCP 445 reachable')
            stages['rpc'] = step('FAIL', stages['tcp135']['detail'] or 'RPC port 135 unreachable')
            return fail(
                stages['tcp135']['detail'] or 'RPC port 135 unreachable',
                'RPC_UNREACHABLE',
            )
        stages['network'] = step('PASS', 'TCP 445 and 135 reachable')
        stages['rpc'] = step('PASS', 'RPC endpoint mapper port open')
    else:
        stages['tcp445'] = step('PASS', 'TCP 445 validated by relay host')
        stages['tcp135'] = step('PASS', 'TCP 135 validated by relay host')
        stages['network'] = step('PASS', 'Network ports open on relay host')
        stages['rpc'] = step('PASS', 'RPC endpoint mapper open on relay host')

    stages['smb'], smb_category = smb_check(host, username, password, domain, smb_timeout)
    if stages['smb']['status'] == 'FAIL':
        if smb_category == 'auth_failed':
            stages['authentication'] = stages['smb']
            return fail(stages['smb']['detail'], 'AUTHENTICATION_FAILED')
        if smb_category == 'timeout':
            return fail(stages['smb']['detail'], 'SMB_TIMEOUT')
        return fail(stages['smb']['detail'], 'SMB_UNREACHABLE')

    stages['authentication'] = step('PASS', stages['smb']['detail'] or 'SMB authentication succeeded')

    if smb_only or not run_wmi:
        stages['wmi'] = step('NOT_TESTABLE', 'WMI check skipped (SMB probe requested)')
        stages['authorization'] = step('NOT_TESTABLE', 'WMI check skipped (SMB probe requested)')
        stages['command'] = step('NOT_TESTABLE', 'WMI check skipped (SMB probe requested)')
        return {
            'ok': True,
            'stages': stages,
            'overall': step('PASS', 'SMB authentication succeeded'),
            'failureCategory': None,
            'durationMs': int((time.time() - started_at) * 1000),
            'timeoutMs': timeout_ms,
        }

    wmi_timeout = max(10, timeout_sec - smb_timeout - (tcp_timeout * 2 if not skip_tcp else 0))
    stages['wmi'], wmi_category = wmi_check(host, username, password, domain, wmi_timeout)
    if stages['wmi']['status'] == 'FAIL':
        category_map = {
            'auth_failed': 'AUTHENTICATION_FAILED',
            'permission_denied': 'AUTHORIZATION_FAILED',
            'wmi_timeout': 'WMI_TIMEOUT',
            'wmi_unavailable': 'WMI_SERVICE_UNAVAILABLE',
            'wmi_failed': 'WMI_SERVICE_UNAVAILABLE',
            'timeout': 'WMI_TIMEOUT',
        }
        cat = category_map.get(wmi_category, 'WMI_SERVICE_UNAVAILABLE')
        if cat == 'AUTHENTICATION_FAILED':
            stages['authentication'] = step('FAIL', stages['wmi']['detail'])
        if cat == 'AUTHORIZATION_FAILED':
            stages['authorization'] = step('FAIL', stages['wmi']['detail'])
        return fail(stages['wmi']['detail'], cat)

    stages['wmi'] = step('PASS', stages['wmi']['detail'] or 'WMI DCOM available')
    stages['authorization'] = step('PASS', 'WMI DCOM authorization verified')
    stages['command'] = step('PASS', 'WMI session ready')
    return {
        'ok': True,
        'stages': stages,
        'overall': step('PASS'),
        'failureCategory': None,
        'durationMs': int((time.time() - started_at) * 1000),
        'timeoutMs': timeout_ms,
    }


def main():
    result = {
        'ok': False,
        'error': 'unknown error',
        'stages': {},
        'overall': step('FAIL', 'unknown error'),
        'failureCategory': 'UNKNOWN',
    }
    try:
        raw = sys.stdin.read()
        req = json.loads(raw or '{}')
        result = run_probe(req)
    except Exception as exc:
        result = {
            'ok': False,
            'error': str(exc),
            'trace': traceback.format_exc()[-500:],
            'stages': result.get('stages') or {},
            'overall': step('FAIL', str(exc)),
            'failureCategory': 'UNKNOWN',
        }
    print(json.dumps(result))
    sys.exit(0 if result.get('ok') else 1)


if __name__ == '__main__':
    multiprocessing.freeze_support()
    main()
