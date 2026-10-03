/**
 * E2E_TEST_MODE only: a stand-in for Haiku in the word
 * check, so the end-to-end tests and screenshots exercise the whole flow. It
 * knows a handful of classic mistakes and reports them the way the model's
 * report_issues tool would; the 一 / 不 rule runs for real on top.
 */
import type Anthropic from '@anthropic-ai/sdk';

const KNOWN: Array<{ hanzi: string; field: 'pinyin' | 'english'; kind: string; bad: RegExp; proposed: string; reason: string }> = [
  { hanzi: '银行', field: 'pinyin', kind: 'reading', bad: /x[íi]ng/i, proposed: 'yínháng', reason: '行 reads háng in 银行 (bank), xíng means "to walk"' },
  { hanzi: '长大', field: 'pinyin', kind: 'reading', bad: /cháng/i, proposed: 'zhǎngdà', reason: '长 reads zhǎng (to grow) in 长大' },
  { hanzi: '苹果', field: 'english', kind: 'gloss', bad: /banana/i, proposed: 'apple', reason: '苹果 is an apple; a banana is 香蕉' },
  { hanzi: '妈妈', field: 'pinyin', kind: 'tones', bad: /mǎ/i, proposed: 'māma', reason: '妈 is first tone; the second 妈 is neutral' },
];

export function fakeCheckClient(): Pick<Anthropic, 'messages'> {
  return {
    messages: {
      create: async (params: { messages: Array<{ content: unknown }> }) => {
        const text = String(params.messages[0]?.content ?? '');
        const issues: unknown[] = [];
        for (const line of text.split('\n')) {
          const m = line.match(/^(\d+)\. (.+?) \| (.*?) \| (.*)$/);
          if (!m) continue;
          const [, idx, hanzi, pinyin, english] = m;
          for (const k of KNOWN) {
            if (k.hanzi !== hanzi.trim()) continue;
            if (!k.bad.test(k.field === 'pinyin' ? pinyin : english)) continue;
            issues.push({ index: Number(idx), field: k.field, kind: k.kind, proposed: k.proposed, reason: k.reason });
          }
        }
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 900 + text.length, output_tokens: 20 + issues.length * 40 },
          content: [{ type: 'tool_use', id: 'fake', name: 'report_issues', input: { issues } }],
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
}
