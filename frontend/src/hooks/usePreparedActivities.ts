/**
 * The activities prepared for one student's next lesson (docs/VIDEO_CALLS.md
 * "Prepared activities"): the list (ordered with the shared rule), the latest
 * run (polled while it works), "Prepare" / "Make more" and Dismiss (optimistic,
 * with Undo). Used by the student page and the call's Activities menu.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orderPrepared, prepareJobActive, type PreparedActivity } from '@shared/call-activities';
import {
  dismissPreparedActivity,
  getPreparedActivities,
  prepareActivities,
  preparedActivitiesKey,
  restorePreparedActivity,
  type PreparedActivitiesResponse,
} from '../api/preparedActivities';
import { track } from '../services/analytics';

export type PreparedSource = 'student_page' | 'call';

export function usePreparedActivities(relId: string | null | undefined, opts: { enabled?: boolean; source: PreparedSource }) {
  const queryClient = useQueryClient();
  const key = preparedActivitiesKey(relId ?? '');
  const query = useQuery({
    queryKey: key,
    queryFn: () => getPreparedActivities(relId!),
    enabled: !!relId && opts.enabled !== false,
    staleTime: 30_000,
    refetchInterval: (q) => (prepareJobActive((q.state.data as PreparedActivitiesResponse | undefined)?.job) ? 3000 : false),
  });
  const data = query.data;
  const activities = orderPrepared(data?.activities ?? []);
  const ready = activities.filter((a) => a.status === 'ready');
  const preparing = prepareJobActive(data?.job);

  const prepare = useMutation({
    mutationFn: () => prepareActivities(relId!),
    onSuccess: (r) => {
      queryClient.setQueryData<PreparedActivitiesResponse>(key, (old) => (old ? { ...old, job: r.job } : old));
      void queryClient.invalidateQueries({ queryKey: key });
      track('tutor.prepared_activities_prepare', { source: opts.source, ready: ready.length });
    },
  });

  const setStatus = (id: string, status: PreparedActivity['status']) =>
    queryClient.setQueryData<PreparedActivitiesResponse>(key, (old) =>
      old ? { ...old, activities: old.activities.map((a) => (a.id === id ? { ...a, status } : a)) } : old,
    );

  const dismiss = useMutation({
    mutationFn: (a: PreparedActivity) => dismissPreparedActivity(a.id),
    onMutate: (a) => {
      setStatus(a.id, 'dismissed');
      track('tutor.prepared_activity_dismiss', { activity_kind: a.spec.kind, source: opts.source });
    },
    onError: (_e, a) => setStatus(a.id, a.status),
  });

  const restore = useMutation({
    mutationFn: (a: PreparedActivity) => restorePreparedActivity(a.id),
    onMutate: (a) => setStatus(a.id, 'ready'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  /** A prepared one was started in the call: shown as used straight away. */
  const markUsed = (id: string) =>
    queryClient.setQueryData<PreparedActivitiesResponse>(key, (old) =>
      old ? { ...old, activities: old.activities.map((a) => (a.id === id ? { ...a, status: 'used', used_at: a.used_at ?? new Date().toISOString().replace('T', ' ').slice(0, 19) } : a)) } : old,
    );

  return { query, data, activities, ready, preparing, prepare, dismiss, restore, markUsed };
}
