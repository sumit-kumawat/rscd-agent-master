const path = require('path');

/** Official MSVC 2015–2022 x64 runtime (covers apps built with VS 2015). */
const DEFAULT_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';

module.exports = {
  /** Download URL used when installing from the internet on each host. */
  installUrl: (process.env.VC_REDIST_2015_X64_URL || DEFAULT_URL).trim(),
  /**
   * Optional installer on the app container/host (avoids per-VM download).
   * Place file at backend/data/prerequisites/vc_redist.x64.exe or set this path.
   */
  localInstallerPath: process.env.VC_REDIST_2015_X64_LOCAL_PATH
    || path.join(__dirname, '../../data/prerequisites/vc_redist.x64.exe'),
  concurrency: Math.max(1, parseInt(process.env.VC_REDIST_CONCURRENCY || '5', 10) || 5),
  installArgs: process.env.VC_REDIST_2015_INSTALL_ARGS || '/install /quiet /norestart',
};
