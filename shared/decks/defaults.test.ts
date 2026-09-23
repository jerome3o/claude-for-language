import { describe, it, expect } from 'vitest';
import { DEFAULT_DECK_SETTINGS, DECK_SETTING_KEYS, newDeckSettings, pickDeckSettings } from './defaults';

describe('deck defaults', () => {
  it('a new deck gets 3 new words and 6 purple cards a day', () => {
    expect(DEFAULT_DECK_SETTINGS.new_cards_per_day).toBe(3);
    expect(DEFAULT_DECK_SETTINGS.secondary_cards_per_day).toBe(6);
    expect(newDeckSettings()).toEqual(DEFAULT_DECK_SETTINGS);
  });

  it('overrides replace only the keys given, and never with null', () => {
    const s = newDeckSettings({ new_cards_per_day: 10, secondary_cards_per_day: null as unknown as number });
    expect(s.new_cards_per_day).toBe(10);
    expect(s.secondary_cards_per_day).toBe(6);
    expect(s.learning_steps).toBe('1 10');
  });

  it('pickDeckSettings keeps valid values, coerces strings, rounds integers, and reports the rest', () => {
    const { settings, problems } = pickDeckSettings({
      new_cards_per_day: '5',
      secondary_cards_per_day: 2.6,
      request_retention: 0.85,
      learning_steps: ' 1 10 ',
      relearning_steps: 'ten',
      easy_bonus: 999,
      name: 'ignored',
      maximum_interval: undefined,
    });
    expect(settings).toEqual({ new_cards_per_day: 5, secondary_cards_per_day: 3, request_retention: 0.85, learning_steps: '1 10' });
    expect(problems.map(p => p.field)).toEqual(['relearning_steps', 'easy_bonus']);
  });

  it('covers every settings column', () => {
    expect(DECK_SETTING_KEYS.sort()).toEqual([
      'easy_bonus', 'easy_interval', 'graduating_interval', 'hard_multiplier', 'interval_modifier', 'learning_steps',
      'maximum_ease', 'maximum_interval', 'minimum_ease', 'new_cards_per_day', 'relearning_steps', 'request_retention',
      'secondary_cards_per_day', 'starting_ease',
    ]);
  });
});
