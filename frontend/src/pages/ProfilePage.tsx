import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PROFILE_LIMITS, charCount, pickProfileUpdate, timeZoneCity, type Profile } from '@shared/profile';
import { VOICE_GENDER_HINT, VOICE_GENDER_OPTIONS, VOICE_GENDER_TITLE } from '@shared/chats/voice';
import { useAuth } from '../contexts/AuthContext';
import { useNavRole } from '../components/nav/useNavRole';
import { getProfile, updateProfile, uploadProfilePicture, removeProfilePicture, ProfileError } from '../api/profile';
import { draftFrom, deviceTimeZone, hasChanges, profileChanges, timeZoneOptions, type ProfileDraft } from '../services/profileForm';
import { loadImage, renderCrop, type SourceRect } from '../services/profilePicture';
import { PictureCropSheet } from '../components/profile/PictureCropSheet';
import { PersonAbout } from '../components/profile/PersonAbout';
import { Loading } from '../components/Loading';
import { Toast, useToast } from '../components/Toast';
import '../components/profile/profile.css';

function initialOf(name: string | null | undefined, email: string | null | undefined): string {
  return (name?.trim()?.[0] || email?.[0] || '?').toUpperCase();
}

function ProfileAvatar({ profile, size }: { profile: Pick<Profile, 'name' | 'email' | 'picture_url'>; size: 'xl' | 'lg' }) {
  const cls = `pf-avatar pf-avatar-${size}`;
  return profile.picture_url
    ? <img src={profile.picture_url} alt="" className={cls} />
    : <span className={`${cls} pf-avatar-placeholder`} aria-hidden="true">{initialOf(profile.name, profile.email)}</span>;
}

function FieldProblem({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="pf-field-problem" role="alert">{text}</p>;
}

function errorMessage(err: unknown): { message: string; problems: string[] } {
  if (err instanceof ProfileError) return { message: err.message, problems: err.problems };
  return { message: err instanceof Error ? err.message : 'Something went wrong', problems: [] };
}

/**
 * Profile (/profile): display name, photo (cropped + resized on the device,
 * stored in R2), About me (public: the other side of a tutor relationship and
 * invite links), time zone (they see your local time) and — for learners — the
 * private bio Claude uses for example sentences. Name and photo edits show
 * everywhere the app shows people, and survive the next Google sign-in.
 */
export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const role = useNavRole();
  const queryClient = useQueryClient();
  const teaches = role.isTutorAccount || role.hasStudents;
  const learns = !role.isTutorOnly && !role.isTutorAccount;
  const audience = teaches ? 'your students' : 'your tutor';
  const seeYou = teaches ? 'your students see you' : 'your tutor sees you';

  const query = useQuery({ queryKey: ['profile'], queryFn: getProfile, retry: 1 });
  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.data && !saved) {
      setSaved(query.data);
      setDraft(draftFrom(query.data));
    }
  }, [query.data, saved]);

  // A server problem is about what was sent; editing again clears it.
  useEffect(() => { setProblems([]); }, [draft]);

  const changes = useMemo(() => (saved && draft ? profileChanges(saved, draft) : {}), [saved, draft]);
  const dirty = hasChanges(changes);
  // The same checks the server runs, live — each shown under its own field.
  const liveProblems = useMemo(() => pickProfileUpdate(changes as Record<string, unknown>).problems, [changes]);
  const allProblems = [...new Set([...liveProblems, ...problems])];
  const fieldProblem = (prefix: string) => allProblems.find((p) => p.startsWith(prefix)) ?? null;
  const otherProblems = allProblems.filter((p) => !/^(Name|About me|Bio)\b/.test(p));
  const deviceTz = deviceTimeZone();
  const zones = useMemo(() => timeZoneOptions([saved?.time_zone, deviceTz]), [saved?.time_zone, deviceTz]);

  // Everything that shows people (relationships, dashboard, chat) re-reads after a change.
  const afterChange = async (p: Profile) => {
    setSaved(p);
    queryClient.setQueryData(['profile'], p);
    queryClient.invalidateQueries({ queryKey: ['nav-relationships'] });
    queryClient.invalidateQueries({ queryKey: ['relationships'] });
    await refreshUser().catch(() => {});
  };

  const save = async () => {
    if (!saved || !draft || !dirty || liveProblems.length) return;
    setSaving(true);
    setProblems([]);
    setFormError(null);
    try {
      const p = await updateProfile(changes);
      await afterChange(p);
      setDraft(draftFrom(p));
      showToast('Profile saved');
    } catch (err) {
      const { message, problems: list } = errorMessage(err);
      if (list.length) setProblems(list);
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const revertToGoogleName = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const p = await updateProfile({ name: null });
      await afterChange(p);
      setDraft((d) => (d ? { ...d, name: p.name ?? '' } : d));
      showToast('Using your Google name');
    } catch (err) {
      setFormError(errorMessage(err).message);
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPictureError(null);
    try {
      setCropImage(await loadImage(file));
    } catch (err) {
      setPictureError(errorMessage(err).message);
    }
  };

  const closeCrop = () => {
    if (cropImage) URL.revokeObjectURL(cropImage.src);
    setCropImage(null);
    setPictureError(null);
  };

  const uploadCrop = async (rect: SourceRect) => {
    if (!cropImage) return;
    setPictureBusy(true);
    setPictureError(null);
    try {
      const blob = await renderCrop(cropImage, rect);
      const p = await uploadProfilePicture(blob);
      await afterChange(p);
      closeCrop();
      showToast('Photo updated');
    } catch (err) {
      setPictureError(errorMessage(err).message);
    } finally {
      setPictureBusy(false);
    }
  };

  const resetPicture = async (use: 'google' | 'none') => {
    if (use === 'none' && !confirm('Remove your photo? People will see your initial instead.')) return;
    setPictureBusy(true);
    setPictureError(null);
    try {
      const p = await removeProfilePicture(use);
      await afterChange(p);
      showToast(use === 'google' ? 'Using your Google photo' : 'Photo removed');
    } catch (err) {
      setPictureError(errorMessage(err).message);
    } finally {
      setPictureBusy(false);
    }
  };

  if (query.isLoading || (query.data && !saved)) return <Loading message="Loading your profile…" />;
  if (query.isError || !saved || !draft) {
    return (
      <div className="page">
        <div className="container pf-page">
          <Link to="/more" className="back-link">‹ More</Link>
          <h1>Profile</h1>
          <div className="inline-error" role="alert">
            <span className="inline-error-text">{errorMessage(query.error).message || 'Could not load your profile'}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => query.refetch()}>Try again</button>
        </div>
      </div>
    );
  }

  const preview = {
    name: (draft.name.trim() || saved.google_name || user?.email) ?? null,
    email: saved.email,
    picture_url: saved.picture_url,
  };
  const nameLeft = PROFILE_LIMITS.name - charCount(draft.name.trim());
  const aboutLeft = PROFILE_LIMITS.about - charCount(draft.about);
  const bioLeft = PROFILE_LIMITS.bio - charCount(draft.bio);
  const googlePhotoAvailable = !!saved.google_picture_url && saved.picture_source !== 'google';

  return (
    <div className="page">
      <div className="container pf-page">
        <Link to="/more" className="back-link">‹ More</Link>
        <h1>Profile</h1>
        <p className="pf-lead">
          This is how you appear to {audience} — on your page, in chat{teaches ? ', and on your invite links' : ''}.
        </p>

        <div className="pf-layout">
          <div className="pf-form">
            {/* ---------- Photo ---------- */}
            <section className="pf-card pf-photo-card" aria-labelledby="pf-photo-h">
              <h2 id="pf-photo-h" className="pf-visually-hidden">Photo</h2>
              <button
                type="button"
                className="pf-photo-button"
                onClick={() => fileRef.current?.click()}
                disabled={pictureBusy}
                aria-label="Change your photo"
                data-testid="change-photo"
              >
                <ProfileAvatar profile={saved} size="xl" />
                <span className="pf-photo-badge" aria-hidden="true">📷</span>
              </button>
              <div className="pf-photo-actions">
                <button type="button" className="btn btn-secondary pf-btn" onClick={() => fileRef.current?.click()} disabled={pictureBusy}>
                  {saved.picture_url ? 'Change photo' : 'Add a photo'}
                </button>
                {googlePhotoAvailable && (
                  <button type="button" className="pf-link" onClick={() => resetPicture('google')} disabled={pictureBusy}>
                    Use my Google photo
                  </button>
                )}
                {saved.picture_url && (
                  <button type="button" className="pf-link pf-link-danger" onClick={() => resetPicture('none')} disabled={pictureBusy}>
                    Remove photo
                  </button>
                )}
                <span className="pf-help">
                  {saved.picture_source === 'upload' ? 'Your own photo' : saved.picture_source === 'google' ? 'From your Google account' : 'No photo — people see your initial'}
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="pf-visually-hidden"
                onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }}
                data-testid="photo-input"
              />
              {pictureError && !cropImage && (
                <div className="inline-error pf-card-error" role="alert"><span className="inline-error-text">{pictureError}</span></div>
              )}
            </section>

            {/* ---------- Name ---------- */}
            <section className="pf-card">
              <label className="pf-label" htmlFor="pf-name">Display name</label>
              <input
                id="pf-name"
                className="pf-input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                maxLength={PROFILE_LIMITS.name + 10}
                autoComplete="name"
                placeholder={saved.google_name ?? 'Your name'}
              />
              <div className="pf-field-foot">
                <span className="pf-help">
                  {saved.name_custom && saved.google_name ? (
                    <>
                      Google says “{saved.google_name}”.{' '}
                      <button type="button" className="pf-link pf-inline" onClick={revertToGoogleName} disabled={saving}>Use that instead</button>
                    </>
                  ) : (
                    'From your Google account — change it to what ' + audience + ' call you.'
                  )}
                </span>
                {nameLeft < 15 && <span className={`pf-count ${nameLeft < 0 ? 'pf-count-over' : ''}`}>{nameLeft}</span>}
              </div>
              <FieldProblem text={fieldProblem('Name')} />
            </section>

            {/* ---------- About ---------- */}
            <section className="pf-card">
              <label className="pf-label" htmlFor="pf-about">{teaches ? 'About me for students' : 'About me for my tutor'}</label>
              <p className="pf-desc">
                {teaches
                  ? 'Shown on your page in your students’ app and on your invite links. A line or two: who you are, how you teach, when to reach you.'
                  : 'Shown to your tutor on your page. Why you’re learning, your level, what you’d like help with.'}
              </p>
              <textarea
                id="pf-about"
                className="pf-input pf-textarea"
                value={draft.about}
                onChange={(e) => setDraft({ ...draft, about: e.target.value })}
                rows={4}
                placeholder={teaches
                  ? 'e.g. 你好! I’m Minghui, a Mandarin teacher from Shanghai. Lessons are relaxed and full of real conversation. Message me here any time.'
                  : 'e.g. I’m learning Chinese to talk with my partner’s family. HSK 2-ish; I’d love help with listening.'}
              />
              <div className="pf-field-foot">
                <span />
                <span className={`pf-count ${aboutLeft < 0 ? 'pf-count-over' : ''}`}>{aboutLeft}</span>
              </div>
              <FieldProblem text={fieldProblem('About me')} />
            </section>

            {/* ---------- Time zone ---------- */}
            <section className="pf-card">
              <label className="pf-label" htmlFor="pf-tz">Time zone</label>
              <p className="pf-desc">So {audience} can see what time it is for you before they message.</p>
              <select
                id="pf-tz"
                className="pf-input pf-select"
                value={draft.time_zone}
                onChange={(e) => setDraft({ ...draft, time_zone: e.target.value })}
              >
                <option value="">Not shown</option>
                {zones.map((z) => (
                  <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
                ))}
              </select>
              {deviceTz && draft.time_zone !== deviceTz && (
                <button type="button" className="pf-link pf-tz-device" onClick={() => setDraft({ ...draft, time_zone: deviceTz })}>
                  Use this device’s: {timeZoneCity(deviceTz)}
                </button>
              )}
            </section>

            {/* ---------- Read-aloud voice (shared/chats/voice.ts) ---------- */}
            <section className="pf-card" data-testid="voice-gender">
              <span className="pf-label" id="pf-voice-label">{VOICE_GENDER_TITLE}</span>
              <p className="pf-desc">{VOICE_GENDER_HINT}</p>
              <div className="pf-seg" role="radiogroup" aria-labelledby="pf-voice-label">
                {VOICE_GENDER_OPTIONS.map((o) => {
                  const value = o.value ?? '';
                  const on = draft.voice_gender === value;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`pf-seg-btn${on ? ' pf-seg-on' : ''}`}
                      onClick={() => setDraft({ ...draft, voice_gender: value })}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ---------- Bio (private) ---------- */}
            {learns && (
              <section className="pf-card" data-testid="personal-bio">
                <label className="pf-label" htmlFor="pf-bio">
                  Bio for Claude <span className="pf-private">🔒 private</span>
                </label>
                <p className="pf-desc">
                  Only used to personalise example sentences — mention you like coffee and you might get sentences about ordering coffee. Nobody else sees it.
                </p>
                <textarea
                  id="pf-bio"
                  className="pf-input pf-textarea"
                  value={draft.bio}
                  onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
                  rows={3}
                  placeholder="e.g. I'm a software developer living in New Zealand. I like hiking, coffee, and cooking."
                />
                <div className="pf-field-foot">
                  <span />
                  <span className={`pf-count ${bioLeft < 0 ? 'pf-count-over' : ''}`}>{bioLeft}</span>
                </div>
                <FieldProblem text={fieldProblem('Bio')} />
              </section>
            )}

            {(otherProblems.length > 0 || formError) && (
              <div className="inline-error" role="alert">
                <span className="inline-error-text">
                  {formError}
                  {otherProblems.length > 0 && (
                    <ul className="pf-problems">{otherProblems.map((p) => <li key={p}>{p}</li>)}</ul>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* ---------- Preview ---------- */}
          <aside className="pf-preview" aria-label={`How ${seeYou}`}>
            <div className="pf-preview-label">How {seeYou}</div>
            <div className="pf-preview-card">
              <div className="pf-preview-head">
                <ProfileAvatar profile={preview} size="lg" />
                <div className="pf-preview-title">
                  <div className="pf-preview-name">{preview.name || 'You'}</div>
                  <div className="pf-help">{teaches ? 'Your tutor' : 'Your student'}</div>
                </div>
              </div>
              <PersonAbout about={draft.about.trim() || null} timeZone={draft.time_zone || null} />
              {!draft.about.trim() && !draft.time_zone && (
                <p className="pf-help pf-preview-empty">Add a line about yourself and your time zone — they show up here.</p>
              )}
            </div>
          </aside>
        </div>

        <div className={`pf-savebar ${dirty ? 'pf-savebar-on' : ''}`} aria-hidden={!dirty}>
          <button type="button" className="btn btn-secondary" onClick={() => { setDraft(draftFrom(saved)); setProblems([]); setFormError(null); }} disabled={!dirty || saving} tabIndex={dirty ? 0 : -1}>
            Discard
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving || liveProblems.length > 0} tabIndex={dirty ? 0 : -1} data-testid="profile-save">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {cropImage && (
        <PictureCropSheet image={cropImage} busy={pictureBusy} error={pictureError} onCancel={closeCrop} onConfirm={uploadCrop} />
      )}
      <div className={dirty ? 'pf-toast-lift' : undefined}><Toast message={toast} /></div>
    </div>
  );
}
