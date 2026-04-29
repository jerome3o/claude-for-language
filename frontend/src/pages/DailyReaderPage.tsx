import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDailyStatus } from '../api/client';
import './RoleplayPage.css';

export function DailyReaderPage() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['daily-status'],
    queryFn: getDailyStatus,
    refetchInterval: (q) => (q.state.data?.today_reader?.status === 'ready' ? false : 3000),
  });

  const reader = data?.today_reader;
  const sit = data?.today_situation;

  useEffect(() => {
    if (reader?.status === 'ready') navigate(`/readers/${reader.reader_id}`);
  }, [reader, navigate]);

  return (
    <div className="roleplay-page center" style={{ textAlign: 'center', paddingTop: '3rem' }}>
      <div className="spinner" />
      <h2 style={{ marginTop: '1rem' }}>Preparing today's reader…</h2>
      {sit && (
        <>
          <p className="rp-sub">{sit.title}</p>
          <p className="rp-sub" style={{ maxWidth: '24rem', margin: '0.5rem auto' }}>
            {sit.scenario}
          </p>
        </>
      )}
      {reader?.status === 'failed' && (
        <div className="rp-error">Generation failed. Try again from the Readers page.</div>
      )}
    </div>
  );
}
