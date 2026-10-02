/** Reaction emojis for the chat's ⋯ sheet: quick row (recents first) and the full grid. */

const DEFAULT_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🔥'];
export const FULL_EMOJI_LIST = [
  // Smileys
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊',
  '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛', '😜', '🤪',
  '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏',
  '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴',
  '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯',
  '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮',
  '😯', '😲', '😳', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
  // Gestures & People
  '👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
  '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊',
  '👊', '🤛', '🤜', '👏', '🙌', '🤲', '🤝', '🙏', '💪', '🦾',
  // Hearts & Symbols
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️',
  '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '💭',
  // Objects & Nature
  '🔥', '⭐', '🌟', '✨', '⚡', '🎉', '🎊', '🎈', '🎁', '🏆',
  '🥇', '🥈', '🥉', '🏅', '🎯', '🎵', '🎶', '🔔', '📣', '📢',
  '🌈', '☀️', '🌤️', '⛅', '🌙', '🌸', '🌺', '🌻', '🌹', '🍀',
  // Food & Animals
  '🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🍎', '🍕', '🍔', '🍣', '🍜', '🍦', '🍰', '🧁', '☕', '🍵',
];

const RECENT_EMOJIS_KEY = 'chat-recent-emojis';
const MAX_RECENT = 5;

export function getRecentEmojis(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_EMOJIS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveRecentEmoji(emoji: string) {
  try {
    const recent = getRecentEmojis().filter((e) => e !== emoji);
    recent.unshift(emoji);
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // localStorage unavailable — recents are a convenience only
  }
}

export function getQuickEmojis(): string[] {
  const recent = getRecentEmojis();
  if (recent.length === 0) return DEFAULT_EMOJIS;
  // Merge: recent first, then fill with defaults that aren't in recent
  const merged = [...recent];
  for (const e of DEFAULT_EMOJIS) {
    if (!merged.includes(e) && merged.length < 6) merged.push(e);
  }
  return merged.slice(0, 6);
}
