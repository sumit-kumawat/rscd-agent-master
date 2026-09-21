export function GridSkeleton({ rows = 6 }) {
  return (
    <div className="lb-skeleton-grid">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="lb-skeleton-card">
          <div className="lb-skeleton-icon" />
          <div className="lb-skeleton-lines">
            <div className="lb-skeleton-line short" />
            <div className="lb-skeleton-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="lb-skeleton-table">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="lb-skeleton-row">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="lb-skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 8 }) {
  return (
    <div className="lb-skeleton-list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="lb-skeleton-log-line" />
      ))}
    </div>
  );
}
