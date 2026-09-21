import { Component } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <AlertCircle size={32} strokeWidth={1.5} />
        <h2>Something went wrong</h2>
        <p className="error-boundary-msg">{error.message || String(error)}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => { this.setState({ error: null }); window.location.reload(); }}
        >
          <RefreshCw size={14} strokeWidth={1.5} /> Reload page
        </button>
      </div>
    );
  }
}

export function TabErrorBoundary({ error, onRetry, children }) {
  if (!error) return children;
  return (
    <div className="lb-tab-error">
      <AlertCircle size={24} strokeWidth={1.5} />
      <p>{error}</p>
      {onRetry && (
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
          <RefreshCw size={14} strokeWidth={1.5} /> Retry
        </button>
      )}
    </div>
  );
}
