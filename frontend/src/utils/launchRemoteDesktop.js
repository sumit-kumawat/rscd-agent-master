import api from '../api';

export async function launchRemoteDesktop(vmId, toast) {
  try {
    const r = await api.post(`/vms/${vmId}/remote-desktop/launch`, {});
    const data = r.data || r;
    if (data.mode === 'guacamole' && data.embedPath) {
      window.open(data.embedPath, '_blank', 'noopener,noreferrer');
      return data;
    }
    if (data.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
      if (data.message && toast) toast(data.message, 'info');
      return data;
    }
    throw new Error(data.message || 'Remote desktop unavailable');
  } catch (err) {
    if (toast) toast(err.message, 'error');
    throw err;
  }
}
