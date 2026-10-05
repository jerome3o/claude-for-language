/**
 * Video calls, the sharer's side (shared/calls/share.ts): the sound note, the compact card instead of a
 * mirror of my own screen, and the words. Writes calls-share.json; checked by
 * core/…/calls/CallsShareParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  myShareTile,
  shareAudioLine,
  shareAudioNote,
  shareAudioOf,
  sharingCardSub,
  theirShareSoundLabel,
  HIDE_MY_SHARE_LABEL,
  SHARE_AUDIO_NOTE_LAB,
  SHARE_AUDIO_NOTE_WEB,
  SHARE_AUDIO_ON,
  SHARING_CARD_TITLE,
  SHOW_MY_SHARE_LABEL,
  STOP_SHARING_LABEL,
  type ShareAudio,
  type SharePlatform,
} from '../../../shared/calls/share';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const audios: ShareAudio[] = ['shared', 'none'];
const platforms: SharePlatform[] = ['web', 'lab'];
const names: (string | null)[] = ['Minghui', 'Jerome Swannack', '  Minghui  Li ', '', '   ', null, '明慧', 'a\tb'];

writeFileSync(
  join(OUT, 'calls-share.json'),
  JSON.stringify({
    labels: {
      SHARE_AUDIO_NOTE_WEB,
      SHARE_AUDIO_NOTE_LAB,
      SHARE_AUDIO_ON,
      SHARING_CARD_TITLE,
      STOP_SHARING_LABEL,
      SHOW_MY_SHARE_LABEL,
      HIDE_MY_SHARE_LABEL,
    },
    audioOf: [0, 1, 2, -1].map((n) => ({ n, audio: shareAudioOf(n) })),
    notes: audios.flatMap((audio) => platforms.map((platform) => ({ audio, platform, note: shareAudioNote(audio, platform), line: shareAudioLine(audio, platform) }))),
    tiles: [false, true].flatMap((annotating) => [false, true].map((peek) => ({ annotating, peek, tile: myShareTile({ annotating, peek }) }))),
    subs: names.map((name) => ({ name, sub: sharingCardSub(name) })),
    sound: names.flatMap((name) => [true, false].map((audio) => ({ name: name ?? '', audio, label: theirShareSoundLabel(name ?? '', audio) }))),
  }, null, 1),
);
