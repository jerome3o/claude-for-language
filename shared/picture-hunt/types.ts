/**
 * Picture hunt (看图找词): a picture — uploaded or generated — with the
 * nameable objects in it found and named in Chinese. The learner types what
 * they see; each right answer lights up that object's outline.
 *
 * Geometry is normalised to the image: x / y in 0..1 from the top-left, so the
 * web (SVG) and the Lab app (Compose Canvas) draw it the same way at any size.
 */

export const PICTURE_HUNT_SCHEMA_VERSION = 1;
/** Detection asks for up to this many objects; naming may drop some. */
export const PICTURE_HUNT_MAX_OBJECTS = 25;
/** Soft timer: when it runs out the hunt goes to reveal mode. */
export const PICTURE_HUNT_DEFAULT_SECONDS = 300;

export type PictureHuntSource = 'upload' | 'generated';
export type PictureHuntStatus = 'generating' | 'ready' | 'error';
export type PictureHuntDifficulty = 'easy' | 'medium' | 'hard';

/** A box in normalised image coordinates (0..1). */
export interface HuntBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One place the object appears: its box and, when segmentation worked, its outline. */
export interface HuntRegion {
  box: HuntBox;
  /** Closed outline as [x, y] pairs in normalised image coordinates. Absent = draw the box. */
  polygon?: Array<[number, number]>;
}

export interface HuntObject {
  /** Short stable id within the hunt ("o1", "o2"…). */
  id: string;
  /** ONE clean simplified form (card standard). */
  hanzi: string;
  /** Tone marks, spaces between words. */
  pinyin: string;
  english: string;
  /** Other accepted typed answers (synonyms, measure-word-free forms). */
  alternatives: string[];
  difficulty?: PictureHuntDifficulty;
  /** Card-standard explanation, used when the learner adds it as a card. */
  fun_facts?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
  /** Every place it appears (two cups = one object, two regions). */
  regions: HuntRegion[];
}

export interface PictureHuntSummary {
  id: string;
  title: string;
  source: PictureHuntSource;
  prompt: string | null;
  status: PictureHuntStatus;
  progress: string | null;
  error: string | null;
  object_count: number;
  image_width: number | null;
  image_height: number | null;
  best_found: number | null;
  play_count: number;
  last_played_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PictureHunt extends PictureHuntSummary {
  objects: HuntObject[];
}

/** One play-through, recorded on the device (offline) and uploaded idempotently by id. */
export interface PictureHuntPlay {
  id: string;
  hunt_id: string;
  found_ids: string[];
  total: number;
  hints_used: number;
  gave_up: boolean;
  duration_ms: number;
  played_at: string;
}
