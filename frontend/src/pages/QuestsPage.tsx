import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createQuest, deleteQuest, listQuests, retryQuest } from '../api/client';
import type { QuestSummary } from '@shared/quest';
import './QuestPage.css';

/** Starter topics — one tap instead of thinking up a scene. */
const TOPIC_IDEAS = [
  '厨房做早饭',
  '在超市买东西',
  '打扫房间',
  '在公园遛狗',
  '收拾行李去旅行',
  '在花园浇花',
  '开一家小咖啡店',
];

const DIFFICULTY_LABELS: Record<'easy' | 'medium' | 'hard', string> = {
  easy: 'Easy — single-verb instructions',
  medium: 'Medium — some two-step chains',
  hard: 'Hard — long chains, doors, containers',
};

function StatusBadge({ status }: { status: QuestSummary['status'] }) {
  const labels: Record<QuestSummary['status'], string> = {
    generating: 'Building…',
    ready: 'Ready',
    error: 'Failed',
  };
  return <span className={`quest-status quest-status-${status}`}>{labels[status]}</span>;
}

export function QuestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [goalCount, setGoalCount] = useState(5);

  const questsQuery = useQuery({
    queryKey: ['quests'],
    queryFn: listQuests,
    // Levels are written in the background; keep the list moving while any are.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((q) => q.status === 'generating') ? 4000 : false,
  });

  const generate = useMutation({
    mutationFn: () =>
      createQuest({
        topic: topic.trim() || undefined,
        difficulty,
        goal_count: goalCount,
      }),
    onSuccess: (created) => {
      setTopic('');
      queryClient.invalidateQueries({ queryKey: ['quests'] });
      navigate(`/quests/${created.id}`);
    },
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryQuest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quests'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteQuest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quests'] }),
  });

  const quests = questsQuery.data ?? [];

  return (
    <div className="container quest-page">
      <div className="quest-list-header">
        <h1>🎮 Quests</h1>
      </div>
      <p className="quest-blurb">
        A little tile world with a character you drive around. Each quest gives you instructions in
        Chinese — 拿起, 打开, 把…放在…上 — and you carry them out by walking, picking things up and
        using the verb buttons. Claude builds the whole level: the map, the objects, the verbs they
        accept and the goals.
      </p>

      <div className="quest-new-card">
        <h2>新任务 · New quest</h2>
        <div className="form-group">
          <label className="form-label" htmlFor="quest-topic">What should it be about?</label>
          <input
            id="quest-topic"
            className="form-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. 厨房做早饭 (or leave blank for a surprise)"
            maxLength={200}
          />
          <div className="quest-chip-row">
            {TOPIC_IDEAS.map((idea) => (
              <button key={idea} type="button" className="quest-chip" onClick={() => setTopic(idea)}>
                {idea}
              </button>
            ))}
          </div>
        </div>

        <div className="quest-option-row">
          <div className="form-group">
            <label className="form-label" htmlFor="quest-difficulty">Difficulty</label>
            <select
              id="quest-difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
            >
              {(['easy', 'medium', 'hard'] as const).map((level) => (
                <option key={level} value={level}>{DIFFICULTY_LABELS[level]}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="quest-goals">Goals</label>
            <select
              id="quest-goals"
              value={goalCount}
              onChange={(e) => setGoalCount(Number(e.target.value))}
            >
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} instructions</option>
              ))}
            </select>
          </div>
        </div>

        <button
          className="btn quest-generate-btn"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
        >
          {generate.isPending ? 'Sending to Claude…' : '✨ Build the level'}
        </button>
        {generate.isError && (
          <div style={{ color: '#fca5a5', fontSize: '0.8rem', marginTop: '0.5rem' }}>
            {generate.error instanceof Error ? generate.error.message : 'Could not start generation'}
          </div>
        )}
      </div>

      {questsQuery.isLoading ? (
        <div className="quest-empty">Loading…</div>
      ) : quests.length === 0 ? (
        <div className="quest-empty">No quests yet — build your first level above.</div>
      ) : (
        quests.map((quest) => (
          <div key={quest.id} className="card quest-row">
            <div
              className="quest-row-main"
              onClick={() => navigate(`/quests/${quest.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="quest-row-title">{quest.title}</div>
              <div className="quest-row-sub">
                {new Date(quest.created_at + 'Z').toLocaleDateString()}
                {quest.status === 'generating' && ` · ${quest.progress ?? 'queued'}`}
                {quest.status === 'ready' && ` · ${quest.goal_count} instructions · ${quest.object_count} objects`}
                {quest.completed_at && ` · ✅ done in ${quest.best_moves} moves`}
              </div>
              {quest.error && <div className="quest-row-error">{quest.error}</div>}
            </div>
            <StatusBadge status={quest.status} />
            {quest.status === 'ready' && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate(`/quests/${quest.id}`)}
              >
                {quest.completed_at ? 'Replay' : 'Play'}
              </button>
            )}
            {quest.status === 'error' && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => retry.mutate(quest.id)}
                disabled={retry.isPending}
                aria-label="Retry generation"
              >
                🔄 Retry
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (confirm(`Delete "${quest.title}"?`)) remove.mutate(quest.id);
              }}
              aria-label="Delete quest"
            >
              🗑️
            </button>
          </div>
        ))
      )}
    </div>
  );
}
