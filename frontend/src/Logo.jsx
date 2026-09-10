const LOGO_URL = 'https://www.helixops.ai/content/dam/bmc/logos/bmc/bmc-helix-logo.svg';

export default function Logo({ height = 28 }) {
  return (
    <img
      src={LOGO_URL}
      alt="BMC Helix"
      className="brand-logo"
      height={height}
      style={{ height, width: 'auto', maxWidth: '100%' }}
    />
  );
}
