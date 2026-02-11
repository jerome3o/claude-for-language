import { useNetwork } from '../contexts/NetworkContext';

export function OfflineWarning({ message = 'You are offline. This feature requires an internet connection.' }: { message?: string }) {
  const { isOnline } = useNetwork();

  if (isOnline) return null;

  return (
    <div style={{
      backgroundColor: '#fef3c7',
      color: '#92400e',
      padding: '0.5rem 0.75rem',
      borderRadius: 'var(--radius-md)',
      fontSize: '0.8125rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.375rem',
    }}>
      <span>&#9888;</span>
      <span>{message}</span>
    </div>
  );
}
