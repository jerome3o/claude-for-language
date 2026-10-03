/**
 * R2 storage clean-up (admin only): find and — only when asked — delete
 * objects in the AUDIO_BUCKET that nothing points at any more.
 *
 * The bucket is shared by EVERYTHING the app stores (it is called the audio
 * bucket for historical reasons): TTS clips, sentence-set clips, recordings,
 * reader and lesson pictures, call recordings, debug reports, profile photos,
 * lesson-note files, screenshots, voice samples. The first version of this
 * clean-up built its "in use" set from `notes.audio_url` + review recordings
 * (+ avatars) and deleted every other key in the bucket — which would have
 * wiped reader images, sentence audio, lesson images, call recordings… So:
 *
 *   1. STORAGE_PREFIXES below is the ONE registry of key prefixes → who writes
 *      them → which table / column refers to them. A key is only ever a
 *      candidate when its prefix is registered AND marked `collectable`.
 *      Unknown prefixes (legacy, or a feature added without registering here)
 *      are counted and sampled but NEVER deleted. `storage-cleanup.test.ts`
 *      scans the worker for key prefixes and fails if one is missing here.
 *   2. The "in use" set is built from EVERY column that stores a key
 *      (REFERENCE_SOURCES), plus every key-shaped string inside the JSON specs
 *      that embed picture keys (lessons, the library, editor-chat snapshots).
 *      A failed reference query aborts the run: never delete on a partial set.
 *   3. Only objects older than `minAgeDays` (default 7) are candidates, so an
 *      upload or a generation whose row has not been written yet survives.
 *   4. Dry run is the default. Deleting needs `apply: true`, and is refused when
 *      it would remove more than half of a prefix (a sign the reference set is
 *      wrong) unless `force: true`.
 *
 * Only content the app generates itself (TTS clips, generated pictures) is
 * collectable. What a person made — recordings, photos, files, calls, debug
 * reports — is never collected here; the delete path that owns each of those
 * (account deletion, note deletion, debug-report retention…) removes it.
 */
import type { Env } from '../../types';

export interface StoragePrefix {
  /** Key prefix, with its trailing slash. The longest matching prefix wins. */
  prefix: string;
  /** What lives there. */
  what: string;
  /** The code that writes it. */
  writtenBy: string;
  /** The `table.column` sources (see REFERENCE_SOURCES) that point at these keys. */
  referencedBy: string[];
  /** May unreferenced, old-enough objects under this prefix be deleted? */
  collectable: boolean;
  /** Why a prefix is protected (for the report). */
  protectedReason?: string;
}

const PERSON_MADE = 'made by a person — irreplaceable; removed only by the delete path that owns it';

export const STORAGE_PREFIXES: StoragePrefix[] = [
  // ---- Generated content: collectable ----
  {
    prefix: 'generated/',
    what: 'TTS clips: note words (`generated/<noteId>_x.mp3`), card sentences (`<noteId>-sentence_x`), sentence sets (`<sentenceId>-sentence_x`), generated alternatives',
    writtenBy: 'services/audio.ts generateTTS (getUniqueAudioKey)',
    referencedBy: ['notes.audio_url', 'notes.sentence_clue_audio_url', 'note_sentences.audio_url', 'note_audio_recordings.audio_url'],
    collectable: true,
  },
  {
    prefix: 'chat-tts/',
    what: 'Read-aloud clips of chat messages (`chat-tts/<conversationId>/<messageId>-<hash>.mp3`; listening mode, Read aloud)',
    writtenBy: 'services/chat/message-audio.ts ensureMessageClip',
    referencedBy: ['messages.audio_key'],
    collectable: true,
  },
  {
    prefix: 'reader-images/',
    what: 'Reader page illustrations; also LEGACY lesson pictures (`lesson-<id>-s0e1`) and roleplay pictures (`roleplay-<id>`) from before lesson-images/',
    writtenBy: 'services/graded-reader.ts generatePageImage (default prefix)',
    referencedBy: [
      'reader_pages.image_url', 'roleplay_messages.image_url',
      'custom_lessons.spec', 'lesson_library.spec', 'editor_chat_messages.spec_snapshot', 'editor_chat_messages.proposed_spec',
    ],
    collectable: true,
  },
  {
    prefix: 'lesson-images/',
    what: 'Lesson illustrations, one per scene description (`lesson-images/<hash>.<ext>`), shared by every lesson with that prompt',
    writtenBy: 'services/lesson-images.ts via generatePageImage(…, LESSON_IMAGE_PREFIX)',
    referencedBy: [
      'lesson_images.image_key',
      'custom_lessons.spec', 'lesson_library.spec', 'editor_chat_messages.spec_snapshot', 'editor_chat_messages.proposed_spec',
    ],
    collectable: true,
  },

  // ---- Protected: never deleted here ----
  {
    prefix: 'recordings/',
    what: 'Study-card recordings (`recordings/<reviewEventId>.webm`) and recorded note pronunciations (`recordings/<noteId>/<id>.webm`)',
    writtenBy: 'index.ts POST /api/audio/upload, POST /api/notes/:id/audio',
    referencedBy: ['review_events.recording_url', 'note_audio_recordings.audio_url', 'homework_recordings.audio_url', 'homework_feedback.audio_feedback_url'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'recordings/messages/',
    what: 'Chat voice messages',
    writtenBy: 'index.ts POST /api/…/messages (voice)',
    referencedBy: ['messages.recording_url'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'chat-media/',
    what: 'Chat photos and voice messages (`chat-media/<conversationId>/<messageId>.<ext>`; the key is kept inside messages.attachment)',
    writtenBy: 'routes/chat-messages.ts POST /api/conversations/:id/media (chatMediaKey)',
    referencedBy: ['messages.attachment'],
    collectable: false,
    protectedReason: PERSON_MADE + ' (removed when the message is deleted, and by account deletion)',
  },
  {
    prefix: 'recordings/lessons/',
    what: 'Spoken answers in mini lessons',
    writtenBy: 'routes/lesson-attempts.ts',
    referencedBy: ['custom_lesson_attempt_media.audio_key'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'calls/',
    what: 'Video-call recordings: uploaded chunks and assembled pieces',
    writtenBy: 'services/calls/recording.ts (chunkKey, pieceAudioKey)',
    referencedBy: ['call_recording_pieces.audio_key', 'call_recording_chunks.r2_key'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'materials/',
    what: 'Lesson materials: the original file (`materials/<owner>/<id>/original.<ext>`) and its pages rendered on the uploader’s device (`p<N>.jpg`)',
    writtenBy: 'services/materials (originalKey, pageKey)',
    referencedBy: ['materials.original_key', 'material_pages.image_key'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'avatars/',
    what: 'Uploaded profile pictures',
    writtenBy: 'services/profile.ts (AVATAR_PREFIX)',
    referencedBy: ['users.picture_key'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'lesson-notes/',
    what: 'Files attached to lesson notes',
    writtenBy: 'index.ts POST /api/lesson-notes/:id/files',
    referencedBy: ['lesson_note_files.r2_key'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'picture-hunts/',
    what: 'Picture-hunt pictures: uploaded photos and generated scenes (`picture-hunts/<huntId>.<ext>`)',
    writtenBy: 'routes/picture-hunts.ts (upload), services/picture-hunt.ts runPictureHuntJob (generated)',
    referencedBy: ['picture_hunts.image_key'],
    collectable: false,
    protectedReason: PERSON_MADE + ' (uploads are personal photos; the hunt delete path removes its picture)',
  },
  {
    prefix: 'screenshots/',
    what: 'Feature-request screenshots (uploaded before the request row exists)',
    writtenBy: 'index.ts POST /api/feature-requests/screenshot',
    referencedBy: ['feature_requests.screenshot_url'],
    collectable: false,
    protectedReason: PERSON_MADE,
  },
  {
    prefix: 'debug/',
    what: 'Device debug reports (JSON)',
    writtenBy: 'services/debug-reports.ts (r2KeyFor); has its own retention',
    referencedBy: ['debug_reports.r2_key'],
    collectable: false,
    protectedReason: 'has its own retention in services/debug-reports.ts',
  },
  {
    prefix: 'voice-samples/',
    what: 'One sample line per conversation voice, shared by every account',
    writtenBy: 'services/conversation-voices.ts (voiceSampleKey)',
    referencedBy: [],
    collectable: false,
    protectedReason: 'a cache no table refers to — regenerating costs TTS calls',
  },
  {
    prefix: 'tts-cache/',
    what: 'MiniMax clips for lesson lines and chat read-aloud, one per (text, voice, speed), shared by every account',
    writtenBy: 'services/tts-cache.ts (TTS_CACHE_PREFIX)',
    referencedBy: [],
    collectable: false,
    protectedReason: 'a cache no table refers to — regenerating costs TTS calls',
  },
];

export interface ReferenceSource {
  /** `table.column`, as named in STORAGE_PREFIXES.referencedBy. */
  source: string;
  sql: string;
}

/**
 * Every column that holds an R2 key (or a URL / JSON containing one). All of
 * them go into the "in use" set whatever the prefix — an extra reference can
 * only keep an object, never remove one. Legacy tables (roleplay, homework,
 * audio lessons) are still here: their rows may point at old objects.
 */
export const REFERENCE_SOURCES: ReferenceSource[] = [
  { source: 'notes.audio_url', sql: 'SELECT audio_url AS v FROM notes WHERE audio_url IS NOT NULL' },
  { source: 'notes.sentence_clue_audio_url', sql: 'SELECT sentence_clue_audio_url AS v FROM notes WHERE sentence_clue_audio_url IS NOT NULL' },
  { source: 'note_sentences.audio_url', sql: 'SELECT audio_url AS v FROM note_sentences WHERE audio_url IS NOT NULL' },
  { source: 'note_audio_recordings.audio_url', sql: 'SELECT audio_url AS v FROM note_audio_recordings WHERE audio_url IS NOT NULL' },
  { source: 'review_events.recording_url', sql: 'SELECT recording_url AS v FROM review_events WHERE recording_url IS NOT NULL' },
  { source: 'messages.recording_url', sql: 'SELECT recording_url AS v FROM messages WHERE recording_url IS NOT NULL' },
  { source: 'messages.audio_key', sql: 'SELECT audio_key AS v FROM messages WHERE audio_key IS NOT NULL' },
  { source: 'messages.attachment', sql: 'SELECT attachment AS v FROM messages WHERE attachment IS NOT NULL' },
  { source: 'reader_pages.image_url', sql: 'SELECT image_url AS v FROM reader_pages WHERE image_url IS NOT NULL' },
  { source: 'roleplay_messages.image_url', sql: 'SELECT image_url AS v FROM roleplay_messages WHERE image_url IS NOT NULL' },
  { source: 'lesson_images.image_key', sql: 'SELECT image_key AS v FROM lesson_images WHERE image_key IS NOT NULL' },
  { source: 'custom_lessons.spec', sql: 'SELECT spec AS v FROM custom_lessons WHERE spec IS NOT NULL' },
  { source: 'lesson_library.spec', sql: 'SELECT spec AS v FROM lesson_library WHERE spec IS NOT NULL' },
  { source: 'editor_chat_messages.spec_snapshot', sql: 'SELECT spec_snapshot AS v FROM editor_chat_messages WHERE spec_snapshot IS NOT NULL' },
  { source: 'editor_chat_messages.proposed_spec', sql: 'SELECT proposed_spec AS v FROM editor_chat_messages WHERE proposed_spec IS NOT NULL' },
  { source: 'custom_lesson_attempt_media.audio_key', sql: 'SELECT audio_key AS v FROM custom_lesson_attempt_media WHERE audio_key IS NOT NULL' },
  { source: 'call_recording_pieces.audio_key', sql: 'SELECT audio_key AS v FROM call_recording_pieces WHERE audio_key IS NOT NULL' },
  { source: 'call_recording_chunks.r2_key', sql: 'SELECT r2_key AS v FROM call_recording_chunks WHERE r2_key IS NOT NULL' },
  { source: 'lesson_note_files.r2_key', sql: 'SELECT r2_key AS v FROM lesson_note_files WHERE r2_key IS NOT NULL' },
  { source: 'debug_reports.r2_key', sql: 'SELECT r2_key AS v FROM debug_reports WHERE r2_key IS NOT NULL' },
  { source: 'picture_hunts.image_key', sql: 'SELECT image_key AS v FROM picture_hunts WHERE image_key IS NOT NULL' },
  { source: 'users.picture_key', sql: 'SELECT picture_key AS v FROM users WHERE picture_key IS NOT NULL' },
  { source: 'materials.original_key', sql: 'SELECT original_key AS v FROM materials WHERE original_key IS NOT NULL' },
  { source: 'material_pages.image_key', sql: 'SELECT image_key AS v FROM material_pages WHERE image_key IS NOT NULL' },
  { source: 'feature_requests.screenshot_url', sql: 'SELECT screenshot_url AS v FROM feature_requests WHERE screenshot_url IS NOT NULL' },
  { source: 'homework_recordings.audio_url', sql: 'SELECT audio_url AS v FROM homework_recordings WHERE audio_url IS NOT NULL' },
  { source: 'homework_feedback.audio_feedback_url', sql: 'SELECT audio_feedback_url AS v FROM homework_feedback WHERE audio_feedback_url IS NOT NULL' },
  { source: 'audio_lessons.audio_key', sql: 'SELECT audio_key AS v FROM audio_lessons WHERE audio_key IS NOT NULL' },
];

export const DEFAULT_MIN_AGE_DAYS = 7;
/** Deleting more than this share of one prefix is refused without `force`. */
export const MAX_DELETE_FRACTION = 0.5;
/** …but only for prefixes with at least this many objects. */
const FRACTION_GUARD_MIN_OBJECTS = 20;
const SAMPLE_SIZE = 10;

// ---------- Pure helpers ----------

/** The registry entry for a key: the longest registered prefix it starts with, or null. */
export function prefixFor(key: string, registry: StoragePrefix[] = STORAGE_PREFIXES): StoragePrefix | null {
  let best: StoragePrefix | null = null;
  for (const p of registry) {
    if (key.startsWith(p.prefix) && (!best || p.prefix.length > best.prefix.length)) best = p;
  }
  return best;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every key a stored value may refer to: the value itself as a key (URLs and
 * `/api/audio/…` paths reduced to the key), plus every registered-prefix-shaped
 * substring (for JSON specs and URLs). Over-matching only protects more.
 */
export function referencedKeys(value: string, registry: StoragePrefix[] = STORAGE_PREFIXES): string[] {
  const out = new Set<string>();
  let v = value.trim();
  if (!v) return [];
  if (!v.startsWith('{') && !v.startsWith('[')) {
    v = v.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/^\/+/, '');
    v = v.replace(/^api\/(audio|feature-requests\/screenshot)\//, '');
    if (v) out.add(v);
  }
  const alternatives = registry.map((p) => escapeRe(p.prefix)).join('|');
  const re = new RegExp(`(?:${alternatives})[^"'\\s\\\\?#)<>]+`, 'g');
  for (const m of value.matchAll(re)) out.add(m[0]);
  return [...out];
}

export interface BucketObject {
  key: string;
  size: number;
  /** Upload time; an object without one is treated as too recent. */
  uploaded?: Date | null;
}

export interface PrefixReport {
  prefix: string;
  what: string;
  collectable: boolean;
  protected_reason: string | null;
  objects: number;
  bytes: number;
  referenced: number;
  /** Unreferenced but younger than the minimum age (kept). */
  too_recent: number;
  /** Unreferenced and old enough. Deleted only when `collectable`. */
  unreferenced: number;
  unreferenced_bytes: number;
  sample_keys: string[];
}

export interface CleanupPlan {
  min_age_days: number;
  total: { objects: number; bytes: number };
  prefixes: PrefixReport[];
  /** Keys under no registered prefix: reported, never deleted. */
  unknown: { objects: number; bytes: number; top_level: Record<string, number>; sample_keys: string[] };
  deletable: { count: number; bytes: number };
  /** Why applying this plan would be refused without `force` (empty = fine). */
  warnings: string[];
  /** The keys that would be deleted (not returned by the endpoint). */
  keys: string[];
}

export function planStorageCleanup(input: {
  objects: BucketObject[];
  references: Set<string>;
  now: Date;
  minAgeDays?: number;
  registry?: StoragePrefix[];
}): CleanupPlan {
  const registry = input.registry ?? STORAGE_PREFIXES;
  const minAgeDays = input.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
  const cutoff = input.now.getTime() - minAgeDays * 24 * 60 * 60 * 1000;

  const reports = new Map<string, PrefixReport>();
  for (const p of registry) {
    reports.set(p.prefix, {
      prefix: p.prefix, what: p.what, collectable: p.collectable, protected_reason: p.protectedReason ?? null,
      objects: 0, bytes: 0, referenced: 0, too_recent: 0, unreferenced: 0, unreferenced_bytes: 0, sample_keys: [],
    });
  }
  const unknown = { objects: 0, bytes: 0, top_level: {} as Record<string, number>, sample_keys: [] as string[] };
  const keys: string[] = [];
  let deletableBytes = 0;
  let totalBytes = 0;

  for (const obj of input.objects) {
    totalBytes += obj.size;
    const entry = prefixFor(obj.key, registry);
    if (!entry) {
      unknown.objects++;
      unknown.bytes += obj.size;
      const top = obj.key.includes('/') ? obj.key.slice(0, obj.key.indexOf('/') + 1) : '(root)';
      unknown.top_level[top] = (unknown.top_level[top] ?? 0) + 1;
      if (unknown.sample_keys.length < SAMPLE_SIZE) unknown.sample_keys.push(obj.key);
      continue;
    }
    const r = reports.get(entry.prefix)!;
    r.objects++;
    r.bytes += obj.size;
    if (input.references.has(obj.key)) { r.referenced++; continue; }
    const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : NaN;
    if (!Number.isFinite(uploaded) || uploaded > cutoff) { r.too_recent++; continue; }
    r.unreferenced++;
    r.unreferenced_bytes += obj.size;
    if (r.sample_keys.length < SAMPLE_SIZE) r.sample_keys.push(obj.key);
    if (entry.collectable) {
      keys.push(obj.key);
      deletableBytes += obj.size;
    }
  }

  const prefixes = [...reports.values()];
  const warnings: string[] = [];
  for (const r of prefixes) {
    if (!r.collectable || r.objects < FRACTION_GUARD_MIN_OBJECTS) continue;
    const share = r.unreferenced / r.objects;
    if (share > MAX_DELETE_FRACTION) {
      warnings.push(`${r.prefix}: ${r.unreferenced} of ${r.objects} objects (${Math.round(share * 100)}%) are unreferenced — more than ${MAX_DELETE_FRACTION * 100}% suggests the reference set is incomplete.`);
    }
  }

  return {
    min_age_days: minAgeDays,
    total: { objects: input.objects.length, bytes: totalBytes },
    prefixes,
    unknown,
    deletable: { count: keys.length, bytes: deletableBytes },
    warnings,
    keys,
  };
}

// ---------- I/O ----------

/** The "in use" set. Throws if any source fails — never delete on a partial set. */
export async function collectReferences(db: D1Database, sources: ReferenceSource[] = REFERENCE_SOURCES): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const s of sources) {
    let res: D1Result<{ v: string | null }>;
    try {
      res = await db.prepare(s.sql).all<{ v: string | null }>();
    } catch (err) {
      throw new Error(`Reference query for ${s.source} failed (${err instanceof Error ? err.message : String(err)}); nothing was deleted.`);
    }
    for (const row of res.results || []) {
      if (typeof row.v === 'string') for (const k of referencedKeys(row.v)) refs.add(k);
    }
  }
  return refs;
}

export async function listBucket(bucket: R2Bucket): Promise<BucketObject[]> {
  const out: BucketObject[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ cursor, limit: 1000 });
    for (const o of listed.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return out;
}

export interface CleanupResult extends Omit<CleanupPlan, 'keys'> {
  mode: 'dry_run' | 'applied' | 'refused';
  deleted: { count: number; bytes: number; failed: number };
}

export async function runStorageCleanup(
  env: Pick<Env, 'DB' | 'AUDIO_BUCKET'>,
  opts: { apply?: boolean; force?: boolean; minAgeDays?: number; now?: Date } = {}
): Promise<CleanupResult> {
  // List first, then read the references: a row written while the listing ran
  // is then already in the set.
  const objects = await listBucket(env.AUDIO_BUCKET);
  const references = await collectReferences(env.DB);
  const { keys, ...plan } = planStorageCleanup({
    objects,
    references,
    now: opts.now ?? new Date(),
    minAgeDays: opts.minAgeDays,
  });

  let mode: CleanupResult['mode'] = 'dry_run';
  const deleted = { count: 0, bytes: 0, failed: 0 };
  if (opts.apply) {
    if (plan.warnings.length && !opts.force) {
      mode = 'refused';
    } else {
      mode = 'applied';
      const sizes = new Map(objects.map((o) => [o.key, o.size]));
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        try {
          await env.AUDIO_BUCKET.delete(chunk);
          deleted.count += chunk.length;
          for (const k of chunk) deleted.bytes += sizes.get(k) ?? 0;
        } catch (err) {
          deleted.failed += chunk.length;
          console.error('[storage-cleanup] delete failed for a chunk of', chunk.length, err);
        }
      }
    }
  }

  console.log('[storage-cleanup]', JSON.stringify({
    mode,
    min_age_days: plan.min_age_days,
    total: plan.total,
    deletable: plan.deletable,
    deleted,
    unknown_objects: plan.unknown.objects,
    warnings: plan.warnings,
    prefixes: plan.prefixes.map((p) => ({ prefix: p.prefix, objects: p.objects, referenced: p.referenced, too_recent: p.too_recent, unreferenced: p.unreferenced, collectable: p.collectable })),
  }));

  return { mode, ...plan, deleted };
}
