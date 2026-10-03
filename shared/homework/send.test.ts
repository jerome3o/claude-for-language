import { describe, it, expect } from 'vitest';
import { sendAllLabel, sendConfirmText, sendToLabel, sentToast, unsentJobItems } from './send';

describe('unsentJobItems', () => {
  it('lists what is still only in the tutor account', () => {
    expect(unsentJobItems({
      deck: { id: 'd', name: '饭馆', note_count: 12 },
      lessons: [{ library_item_id: 'l1', title: '把', lesson_id: 'x' }, { library_item_id: 'l2', title: '了' }],
      reader: { id: 'r', title_english: 'At the restaurant' },
    }).map((i) => i.key)).toEqual(['deck', 'lesson:l2', 'reader']);
  });

  it('skips sent, removed and empty items', () => {
    expect(unsentJobItems({ deck: { id: 'd', name: 'x', note_count: 0 } })).toEqual([]);
    expect(unsentJobItems({ deck: { id: 'd', name: 'x', note_count: 3, removed_at: 't' } })).toEqual([]);
    expect(unsentJobItems({ reader: { id: 'r', title_english: 'x', target_reader_id: 'y' } })).toEqual([]);
    expect(unsentJobItems(null)).toEqual([]);
  });
});

describe('send copy', () => {
  it('names the student by first name', () => {
    expect(sendToLabel('Jerome Swannack')).toBe('Send to Jerome');
    expect(sendAllLabel(3, 'Jerome Swannack')).toBe('Send all 3 to Jerome');
    expect(sendConfirmText(['饭馆'], 'Jerome')).toBe('Send "饭馆" to Jerome as homework? It shows up in their app on their next sync.');
    expect(sendConfirmText(['a', 'b'], 'Jerome')).toBe('Send 2 items ("a", "b") to Jerome as homework? It shows up in their app on their next sync.');
    expect(sentToast(['饭馆'], 'Jerome')).toBe('Sent "饭馆" to Jerome');
    expect(sentToast(['a', 'b'], null)).toBe('Sent 2 items to your student');
  });
});
