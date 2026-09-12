const net = require('net');

function tcpCheck(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        status,
        detail: detail || '',
        durationMs: Date.now() - started,
        port,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish('PASS', `TCP ${port} open`));
    socket.once('timeout', () => finish('FAIL', `TCP timeout on port ${port}`));
    socket.once('error', (err) => finish('FAIL', err.message || `TCP error on port ${port}`));
    socket.connect(port, host);
  });
}

async function runTcpStageProbe(host, timeoutMs = 5000) {
  const [tcp445, tcp135] = await Promise.all([
    tcpCheck(host, 445, timeoutMs),
    tcpCheck(host, 135, timeoutMs),
  ]);
  return { tcp445, tcp135 };
}

module.exports = { tcpCheck, runTcpStageProbe };
