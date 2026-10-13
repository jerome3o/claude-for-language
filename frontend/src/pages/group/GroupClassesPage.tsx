/**
 * 🧪 Group classes (EXPERIMENTAL web-only prototype, docs/GROUP_CLASSES.md) —
 * `/group-classes`. A tutor makes a group from 2–6 of her active students,
 * starts a class and sends each student the link through their usual 1:1
 * chat. A student sees the groups they are in, with Join while a class is live.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_GROUP_STUDENTS, MIN_GROUP_STUDENTS } from '@shared/group';
import {
  createGroup,
  deleteGroup,
  listGroupCandidates,
  listGroups,
  notifyGroupSession,
  startGroupSession,
  updateGroup,
  type GroupMember,
  type GroupSummary,
} from '../../api/groupClasses';
import { track } from '../../services/analytics';
import './group.css';

function Avatar({ name, picture }: { name: string; picture: string | null }) {
  return picture ? <img className="gc-avatar" src={picture} alt="" /> : <span className="gc-avatar gc-avatar-letter">{Array.from(name)[0] ?? '?'}</span>;
}

function GroupSheet({ group, onClose, onSaved }: { group: GroupSummary | null; onClose: () => void; onSaved: (g: GroupSummary) => void }) {
  const [students, setStudents] = useState<GroupMember[] | null>(null);
  const [name, setName] = useState(group?.name ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set(group?.members.map((m) => m.user_id) ?? []));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    listGroupCandidates()
      .then((r) => setStudents(r.students))
      .catch((e) => setProblem(e instanceof Error ? e.message : 'Could not load your students'));
  }, []);

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const ids = [...picked];
      const r = group ? await updateGroup(group.id, { name, student_ids: ids }) : await createGroup(name, ids);
      if (!group) track('group.create', { students: ids.length });
      onSaved(r.group);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not save the group');
    } finally {
      setBusy(false);
    }
  };

  const count = picked.size;
  const countOk = count >= MIN_GROUP_STUDENTS && count <= MAX_GROUP_STUDENTS;

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal gc-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="gc-sheet-title" data-testid="group-sheet">
        <div className="modal-header">
          <h2 className="modal-title" id="gc-sheet-title">{group ? 'Edit group' : 'New group'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <label className="gc-label" htmlFor="gc-name">Name</label>
        <input id="gc-name" className="form-input" value={name} maxLength={60} placeholder="e.g. Tuesday evening HSK 3" onChange={(e) => setName(e.target.value)} data-testid="group-name" />
        <div className="gc-label">
          Students <span className="gc-muted">· {count} picked ({MIN_GROUP_STUDENTS}–{MAX_GROUP_STUDENTS})</span>
        </div>
        {!students ? (
          <p className="gc-muted">Loading your students…</p>
        ) : students.length === 0 ? (
          <p className="gc-muted">You have no active students yet. Invite students first — a group is made from the students you already teach.</p>
        ) : (
          <ul className="gc-pick-list">
            {students.map((s) => (
              <li key={s.user_id}>
                <label className="gc-pick">
                  <input type="checkbox" checked={picked.has(s.user_id)} onChange={() => toggle(s.user_id)} data-testid={`pick-${s.user_id}`} />
                  <Avatar name={s.name} picture={s.picture_url} />
                  <span>{s.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {problem && <p className="gc-error">{problem}</p>}
        <div className="modal-actions sheet-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !name.trim() || !countOk} data-testid="group-save">
            {busy ? 'Saving…' : group ? 'Save' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroupClassesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ teaching: GroupSummary[]; member_of: GroupSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GroupSummary | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    listGroups()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load groups'));
  }, []);
  useEffect(load, [load]);

  const start = async (g: GroupSummary, notify: boolean) => {
    setBusy(g.id);
    setNotice(null);
    try {
      const { session, reused } = await startGroupSession(g.id);
      track('group.class_start', { students: g.members.length, reused });
      if (notify) {
        const r = await notifyGroupSession(session.id);
        track('group.notify', { sent: r.sent });
      }
      navigate(`/group-class/${session.id}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start the class');
      setBusy(null);
    }
  };

  const remove = async (g: GroupSummary) => {
    if (!window.confirm(`Delete the group "${g.name}"? The students and your 1:1 chats with them are not affected.`)) return;
    await deleteGroup(g.id).catch(() => {});
    load();
  };

  return (
    <div className="page">
      <div className="container gc-page">
        <h1>
          Group classes <span className="gc-beta">🧪 Prototype</span>
        </h1>
        <p className="gc-intro">
          An experiment: teach 2–{MAX_GROUP_STUDENTS} of your students together on one video call, with a shared board, chat and a quick quiz. Nothing is
          recorded and homework still goes to each student separately. Works best on a computer; every browser sends its video to every other one, so
          keep it to a few people.
        </p>
        {error && <p className="gc-error">{error}</p>}
        {!data && !error && <p className="gc-muted">Loading…</p>}

        {data && (
          <section className="gc-section">
            <div className="gc-section-head">
              <h2>Your groups</h2>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')} data-testid="new-group">＋ New group</button>
            </div>
            {data.teaching.length === 0 ? (
              <p className="gc-muted">No groups yet. A group is a few of the students you already teach.</p>
            ) : (
              <ul className="gc-list" data-testid="group-list">
                {data.teaching.map((g) => (
                  <li key={g.id} className="gc-card">
                    <div className="gc-card-head">
                      <div>
                        <div className="gc-card-title">{g.name} {g.live_session && <span className="gc-live">LIVE</span>}</div>
                        <div className="gc-faces">
                          {g.members.map((m) => (
                            <span key={m.user_id} className="gc-face" title={m.name}>
                              <Avatar name={m.name} picture={m.picture_url} />
                              <span className="gc-face-name">{m.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="gc-card-menu">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(g)}>Edit</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void remove(g)} aria-label={`Delete ${g.name}`}>🗑</button>
                      </div>
                    </div>
                    <div className="gc-card-actions">
                      {g.live_session ? (
                        <button type="button" className="btn btn-primary" onClick={() => navigate(`/group-class/${g.live_session!.id}`)} data-testid="rejoin-class">Rejoin the class</button>
                      ) : (
                        <>
                          <button type="button" className="btn btn-primary" disabled={busy === g.id} onClick={() => void start(g, true)} data-testid="start-class">
                            {busy === g.id ? 'Starting…' : '📹 Start class & send the link'}
                          </button>
                          <button type="button" className="btn btn-secondary" disabled={busy === g.id} onClick={() => void start(g, false)} data-testid="start-class-quiet">
                            Start without sending
                          </button>
                        </>
                      )}
                    </div>
                    <p className="gc-muted gc-small">“Send the link” posts it to each student in your usual 1:1 chat with them.</p>
                  </li>
                ))}
              </ul>
            )}
            {notice && <p className="gc-error">{notice}</p>}
          </section>
        )}

        {data && data.member_of.length > 0 && (
          <section className="gc-section">
            <h2>Groups you're in</h2>
            <ul className="gc-list">
              {data.member_of.map((g) => (
                <li key={g.id} className="gc-card">
                  <div className="gc-card-title">{g.name} {g.live_session && <span className="gc-live">LIVE</span>}</div>
                  <div className="gc-muted">With {g.tutor_name} · {g.members.length} students</div>
                  {g.live_session && (
                    <div className="gc-card-actions">
                      <button type="button" className="btn btn-primary" onClick={() => navigate(`/group-class/${g.live_session!.id}`)}>Join the class</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {editing && (
        <GroupSheet
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
