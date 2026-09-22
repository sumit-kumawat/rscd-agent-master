/**
 * Platform login order for WMI, PowerShell remoting, RDP gateway, and deploy scripts.
 * 1. rdsroot  2. rdsmon  3. Administrator (each configured password, in order)
 * Per-endpoint WMI credentials in MongoDB take precedence when present.
 * Never expose these values to the frontend or API responses.
 */
function getPlatformCredentialChain() {
  return [
    {
      username: 'rdsroot',
      password: process.env.RDSROOT_PASSWORD || '1Rs50U$D',
    },
    {
      username: 'rdsmon',
      password: process.env.RDSMON_PASSWORD || 'D0N0harm',
    },
    {
      username: 'Administrator',
      password: process.env.ADMIN_PASSWORD || 'Helix@dm1n',
    },
    {
      username: 'Administrator',
      password: process.env.ADMIN_PASSWORD_ALT || 'bmcAdm1n',
    },
    {
      username: 'Administrator',
      password: process.env.ADMIN_PASSWORD_ALT2 || '#D3Pl0y_M3nT$',
    },
  ];
}

module.exports = { getPlatformCredentialChain };
