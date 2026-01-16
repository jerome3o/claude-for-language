export function Loading({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2" style={{ padding: '3rem' }}>
      <div className="spinner" />
      <p className="text-light">{message}</p>
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="card text-center" style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca' }}>
      <p className="text-error">{message}</p>
    </div>
  );
}

export function EmptyState({
  icon = '📚',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p className="text-light mt-1">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
