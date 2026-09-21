export default function CardShell({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`dash-card ${className}`}>
      {(title || action) && (
        <div className="dash-card-head">
          <div>
            {title && <h3 className="dash-card-title">{title}</h3>}
            {subtitle && <p className="dash-card-sub">{subtitle}</p>}
          </div>
          {action && <div className="dash-card-action">{action}</div>}
        </div>
      )}
      <div className="dash-card-body">{children}</div>
    </div>
  );
}

export function CardEmpty({ message = 'No data available' }) {
  return <div className="dash-empty">{message}</div>;
}

export function CardLoading() {
  return <div className="dash-loading"><span className="dash-skeleton" /></div>;
}
