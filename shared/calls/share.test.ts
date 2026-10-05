import { describe, expect, it } from 'vitest';
import {
  displayCaptureOptions,
  myShareTile,
  shareAudioLine,
  shareAudioNote,
  shareAudioOf,
  sharingCardSub,
  theirShareSoundLabel,
  SHARE_AUDIO_NOTE_LAB,
  SHARE_AUDIO_NOTE_WEB,
  SHARE_AUDIO_ON,
} from './share';

describe('share: asking for the sound', () => {
  it('asks for the tab / system sound, keeps it playing for the sharer, no voice processing', () => {
    const o = displayCaptureOptions();
    expect(o.audio).toEqual({ suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(o.systemAudio).toBe('include');
    expect(o.preferCurrentTab).toBe(false);
    expect(o.selfBrowserSurface).toBe('exclude');
    expect(o.video.frameRate.ideal).toBe(15);
  });

  it('the retry for a browser that refuses an audio request asks for the picture only', () => {
    const o = displayCaptureOptions(false);
    expect(o.audio).toBe(false);
    expect(o.systemAudio).toBeUndefined();
  });
});

describe('share: the sound note', () => {
  it('no audio track → a note that says how to share sound', () => {
    expect(shareAudioOf(0)).toBe('none');
    expect(shareAudioOf(1)).toBe('shared');
    expect(shareAudioNote('none', 'web')).toBe(SHARE_AUDIO_NOTE_WEB);
    expect(shareAudioNote('none', 'web')).toContain('Also share tab audio');
    expect(shareAudioNote('none', 'lab')).toBe(SHARE_AUDIO_NOTE_LAB);
    expect(shareAudioNote('shared', 'web')).toBeNull();
    expect(shareAudioNote('shared', 'lab')).toBeNull();
    expect(shareAudioLine('shared', 'web')).toBe(SHARE_AUDIO_ON);
    expect(shareAudioLine('none', 'lab')).toBe(SHARE_AUDIO_NOTE_LAB);
  });
});

describe('share: what the sharer sees', () => {
  it('a compact card, not a mirror of my own screen', () => {
    expect(myShareTile({ annotating: false, peek: false })).toBe('card');
  });
  it('my screen itself only while I draw on it or asked to see it', () => {
    expect(myShareTile({ annotating: true, peek: false })).toBe('full');
    expect(myShareTile({ annotating: false, peek: true })).toBe('full');
    expect(myShareTile({ annotating: true, peek: true })).toBe('full');
  });
  it('words', () => {
    expect(sharingCardSub('Jerome Swannack')).toBe('Jerome sees it on their screen.');
    expect(sharingCardSub('  ')).toBe('The other person sees it on their screen.');
    expect(sharingCardSub(null)).toBe('The other person sees it on their screen.');
    expect(theirShareSoundLabel('Minghui Li', true)).toBe('🔊 Sound from Minghui’s screen');
    expect(theirShareSoundLabel('', true)).toBe('🔊 Sound from the shared screen');
    expect(theirShareSoundLabel('Minghui', false)).toBeNull();
  });
});
