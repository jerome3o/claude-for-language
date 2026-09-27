import type { CharStrokeData, Point, StrokeMatch } from './types';
import {
  directionSimilarity,
  dist,
  meanNearestDistance,
  pathLength,
  resample,
  shapeDistance,
  stripDuplicates,
  toPoints,
} from './geometry';

/**
 * Judge one drawn stroke against a character's stroke data.
 *
 * The per-stroke test follows the criteria hanzi-writer's quiz uses (MIT,
 * github.com/chanind/hanzi-writer — proximity to the median, start/end points,
 * direction, Fréchet shape fit, length), re-implemented here so we can also
 * say WHY a stroke was wrong: drawn backwards, a later stroke drawn too early
 * (wrong order), or too short. All distances are in character-data units (the
 * 1024 box).
 */

export interface MatchOptions {
  /** > 1 is more forgiving, < 1 stricter. Default 1. */
  leniency?: number;
  /** The outline is on screen (trace mode) — position is easy, so be stricter about it. */
  outlineVisible?: boolean;
}

/** Drawings shorter than this (data units) are taps, not strokes. */
export const MIN_STROKE_LENGTH = 24;

const AVG_DIST_THRESHOLD = 175; // mean distance drawing → median
const AVG_DIST_THRESHOLD_FIRST_RECALL = 300; // nothing on screen to anchor the first stroke
const START_END_THRESHOLD = 250;
const SHAPE_THRESHOLD = 0.4; // normalised Fréchet
const MIN_LENGTH_RATIO = 0.35;
const SAMPLES = 24;
/** Another stroke must fit this much better (ratio of mean distances) to override a match… */
const CLEARLY_BETTER = 0.4;
/** …and only when the match itself is not already close. */
const CLEARLY_BETTER_MIN = 60;

export interface StrokeFit {
  isMatch: boolean;
  avgDist: number;
  startDist: number;
  endDist: number;
  direction: number;
  lengthRatio: number;
}

/** How well `points` (already cleaned) fit one stroke median. */
export function fitStroke(
  points: Point[],
  median: Point[],
  opts: { leniency: number; avgThreshold: number },
): StrokeFit {
  const drawn = resample(points, SAMPLES);
  const ref = resample(median, SAMPLES);
  const avgDist = meanNearestDistance(drawn, ref);
  const startDist = dist(points[0], median[0]);
  const endDist = dist(points[points.length - 1], median[median.length - 1]);
  const lengthRatio = (pathLength(points) + 25) / (pathLength(median) + 25);
  const L = opts.leniency;
  if (avgDist > opts.avgThreshold * L) {
    return { isMatch: false, avgDist, startDist, endDist, direction: 0, lengthRatio };
  }
  const direction = directionSimilarity(points, median);
  const isMatch =
    startDist <= START_END_THRESHOLD * L &&
    endDist <= START_END_THRESHOLD * L &&
    direction > 0 &&
    lengthRatio * L >= MIN_LENGTH_RATIO &&
    shapeDistance(points, median) <= SHAPE_THRESHOLD * L;
  return { isMatch, avgDist, startDist, endDist, direction, lengthRatio };
}

/**
 * Classify a drawing made while stroke `expected` is the next one to write.
 */
export function matchStroke(
  rawPoints: Point[],
  data: CharStrokeData,
  expected: number,
  options: MatchOptions = {},
): StrokeMatch {
  const points = stripDuplicates(rawPoints);
  if (points.length < 2 || pathLength(points) < MIN_STROKE_LENGTH) return { verdict: 'ignored' };
  if (expected < 0 || expected >= data.medians.length) return { verdict: 'ignored' };

  const leniency = options.leniency ?? 1;
  const firstInRecall = expected === 0 && !options.outlineVisible;
  const fitOpts = { leniency, avgThreshold: firstInRecall ? AVG_DIST_THRESHOLD_FIRST_RECALL : AVG_DIST_THRESHOLD };
  const laterOpts = { leniency, avgThreshold: AVG_DIST_THRESHOLD };
  const medians = data.medians.map(toPoints);

  const exp = fitStroke(points, medians[expected], fitOpts);

  // Best-fitting LATER stroke (the learner may be writing out of order).
  let later: { index: number; fit: StrokeFit } | null = null;
  for (let j = expected + 1; j < medians.length; j++) {
    const fit = fitStroke(points, medians[j], laterOpts);
    if (fit.isMatch && (!later || fit.avgDist < later.fit.avgDist)) later = { index: j, fit };
  }

  if (exp.isMatch) {
    // Parallel strokes (三, 目 …) can both "match": only call it out of order
    // when a later stroke is a clearly better fit.
    if (later && exp.avgDist > CLEARLY_BETTER_MIN && later.fit.avgDist < exp.avgDist * CLEARLY_BETTER) {
      return { verdict: 'wrong_order', matchedIndex: later.index, avgDist: exp.avgDist };
    }
    // Likewise, going over a stroke that is already written is not this one.
    if (exp.avgDist > CLEARLY_BETTER_MIN) {
      for (let j = 0; j < expected; j++) {
        const fit = fitStroke(points, medians[j], laterOpts);
        if (fit.isMatch && fit.avgDist < exp.avgDist * CLEARLY_BETTER) {
          return { verdict: 'wrong', avgDist: exp.avgDist };
        }
      }
    }
    return { verdict: 'correct', avgDist: exp.avgDist };
  }

  const reversed = [...points].reverse();
  const back = fitStroke(reversed, medians[expected], fitOpts);
  if (back.isMatch && !(later && later.fit.avgDist < back.avgDist * 0.5)) {
    return { verdict: 'backwards', avgDist: exp.avgDist };
  }

  if (later) return { verdict: 'wrong_order', matchedIndex: later.index, avgDist: exp.avgDist };

  // Right place, right way, but stopped early.
  const medLen = pathLength(medians[expected]);
  if (
    exp.avgDist <= fitOpts.avgThreshold * leniency &&
    exp.startDist <= START_END_THRESHOLD * leniency &&
    exp.direction > 0 &&
    pathLength(points) < medLen * 0.75
  ) {
    return { verdict: 'too_short', avgDist: exp.avgDist };
  }

  return { verdict: 'wrong', avgDist: exp.avgDist };
}
