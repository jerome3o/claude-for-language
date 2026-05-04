import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDailyStatus } from '../api/client';
import './RoleplayPage.css';

export function DailyReaderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['daily-status'],
    queryFn: getDailyStatus,
    refetchInterval: (q) => {
      const status = q.state.data?.today_reader?.status;
      return status === 'ready' || status === 'failed' ? false : 3000;
    },
  });

  const reader = data?.today_reader;
  const sit = data?.today_situation;
  const isFailed = reader?.status === 'failed';

  useEffect(() => {
    if (reader?.status === 'ready') navigate(`/readers/${reader.reader_id}`);
  }, [reader, navigate]);

  function handleRetry() {
    // Invalidate triggers a refetch; backend will re-queue generation for failed readers
    queryClient.invalidateQueries({ queryKey: ['daily-status'] });
  }

  return (
    <div className="roleplay-page center" style={{ textAlign: 'center', paddingTop: '3rem' }}>
      {!isFailed && <div className="spinner" />}
      <h2 style={{ marginTop: '1rem' }}>
        {isFailed ? "Today's reader failed to generate" : "Preparing today's reader…"}
      </h2>
      {sit && !isFailed && (
        <>
          <p className="rp-sub">{sit.title}</p>
          <p className="rp-sub" style={{ maxWidth: '24rem', margin: '0.5rem auto' }}>
            {sit.scenario}
          </p>
        </>
      )}
      {isFailed && (
        <div className="rp-error" style={{ marginTop: '1rem' }}>
          <p style={{ margin: '0 0 0.75rem' }}>Something went wrong generating today's story.</p>
          <button
            onClick={handleRetry}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              background: '#4a90e2',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
