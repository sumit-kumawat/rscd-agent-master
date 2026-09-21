/**
 * Fixed operations credential for power/WMI/remote actions.
 * NOT exposed to the frontend — UI may prompt for confirmation only.
 */
module.exports = {
  username: (process.env.RDSROOT_OPERATIONS_USER || 'rdsroot').toLowerCase(),
  password: process.env.RDSROOT_OPERATIONS_PASSWORD || '1Rs50U$D',
  domain: (process.env.RDSROOT_OPERATIONS_DOMAIN || '').trim(),
  label: 'RDSROOT',
};
