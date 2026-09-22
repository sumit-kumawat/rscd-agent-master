import api from '../api';

/**
 * Launch RDP: in-app Guacamole embed when configured (no credential prompt in browser).
 */
export async function launchRemoteDesktop(vmId, toast, options = {}) {
  const { onEmbed, vmName } = options;
  try {
    const r = await api.post(`/vms/${vmId}/remote-desktop/launch`, {});
    const data = r.data ?? r;
    if (data.mode === 'guacamole' && data.embedPath) {
      const session = {
        embedPath: data.embedPath,
        host: data.host,
        vmName: vmName || data.host,
        sessionId: data.sessionId,
      };
      if (onEmbed) {
        onEmbed(session);
        return data;
      }
      window.open(data.embedPath, '_blank', 'noopener,noreferrer');
      return data;
    }
    if (data.url) {
      if (data.mode === 'native') {
        const a = document.createElement('a');
        a.href = data.url;
        a.rel = 'noopener';
        a.click();
      } else {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
      if (data.message && toast) toast(data.message, 'info');
      return data;
    }
    throw new Error(data.message || 'Remote desktop unavailable — set GUACAMOLE_PUBLIC_URL for one-click browser RDP');
  } catch (err) {
    if (toast) toast(err.message, 'error');
    throw err;
  }
}
