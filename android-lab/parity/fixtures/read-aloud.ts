/**
 * 🎤 Read it aloud on a reader page (shared/reader/readAloud.ts): the per-character marks, extras,
 * score, the line / tone / bucket and the screen-reader labels. Writes read-aloud.json; core
 * ReadAloudParityTest asserts ReadAloud.kt matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  judgeReadAloud, readAloudHeardAnything, readAloudLine, readAloudTone, readAloudBucket, readAloudCharLabel, readAloudNeedsLook,
  READ_ALOUD_LABEL, READ_ALOUD_AGAIN, READ_ALOUD_STOP, READ_ALOUD_LISTENING, READ_ALOUD_CHECKING, READ_ALOUD_OFFLINE,
  READ_ALOUD_EMPTY, READ_ALOUD_YOU_SAID,
} from '../../../shared/reader/readAloud';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: read-aloud <out-dir>');
mkdirSync(OUT, { recursive: true });

const PAGES = [
  '小明在巴黎。',
  '他在游泳。',
  '我想买书。',
  '他说：“你好！”',
  '我有两本书。',
  '现在12点。',
  '他长得很高。',
  '我们说汉语。',
  '小明今天早上七点起床。他吃了早饭，然后去学校。',
  '“你去哪儿？”妈妈问。“我去银行。”小明说。',
  '一天，他不想去上班，就在家看一看书。',
  '早上好。我叫小徐。',
  '这是3.5元，不是50%。',
  'OK，我们走吧！',
  '',
];
const FIXED: [string, string][] = [
  ['小明在巴黎。', '小明在巴黎'],
  ['小明在巴黎。', '小明在吧离'],
  ['他在游泳。', '她在游泳'],
  ['我想买书。', '我想卖书'],
  ['我想买书。', '我想买书呀'],
  ['我想买书。', '我真的想买书'],
  ['他说：“你好！”', '他 说, 你好.'],
  ['我有两本书。', '我有2本书'],
  ['我有两本书。', '我有二本书'],
  ['现在12点。', '现在十二点'],
  ['现在12点。', '现在十点'],
  ['现在12点。', '现在12点'],
  ['他长得很高。', '他长德很高'],
  ['我们说汉语。', '我們說漢語'],
  ['小明今天早上七点起床。他吃了早饭，然后去学校。', '小明今天早上7点起床他吃了早饭然后去学校'],
  ['小明今天早上七点起床。他吃了早饭，然后去学校。', '小明今天早上起床'],
  ['小明今天早上七点起床。他吃了早饭，然后去学校。', ''],
  ['“你去哪儿？”妈妈问。“我去银行。”小明说。', '你去哪儿妈妈问我去银行小明说'],
  ['“你去哪儿？”妈妈问。“我去银行。”小明说。', '你去哪妈妈问我去音行小明说'],
  ['一天，他不想去上班，就在家看一看书。', '一天他不想去上班就在家看一看书'],
  ['一天，他不想去上班，就在家看一看书。', '一天他不像去上班就在家看看书'],
  ['早上好。我叫小徐。', '我叫小许。'],
  ['这是3.5元，不是50%。', '这是三点五元不是百分之五十'],
  ['OK，我们走吧！', 'ok 我们走吧'],
  ['', '你好'],
  ['我想买书。', '。。 '],
];

// Seeded mutations (insert / delete / substitute from a pool of look-alike and sound-alike characters).
let seed = 20261029;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const POOL = [...'他她它在再买卖书树是事十时银音行很恨了啦呀么吗妈马早找点店家加一衣不布三3两二七起去'];
const mutated: [string, string][] = [];
for (const page of PAGES.filter(Boolean)) {
  for (let k = 0; k < 8; k++) {
    const cps = [...page];
    const edits = 1 + Math.floor(rand() * 4);
    for (let e = 0; e < edits; e++) {
      const op = Math.floor(rand() * 3);
      const at = Math.floor(rand() * (cps.length + 1));
      const ch = POOL[Math.floor(rand() * POOL.length)];
      if (op === 0) cps.splice(at, 0, ch);
      else if (op === 1 && cps.length > 0) cps.splice(Math.min(at, cps.length - 1), 1);
      else if (cps.length > 0) cps[Math.min(at, cps.length - 1)] = ch;
    }
    mutated.push([page, cps.join('')]);
  }
}

const cases = [...FIXED, ...mutated].map(([page, transcript]) => {
  const r = judgeReadAloud(page, transcript);
  return {
    page, transcript,
    heard: readAloudHeardAnything(transcript),
    result: r,
    line: readAloudLine(r),
    tone: readAloudTone(r),
    bucket: readAloudBucket(r.pct),
    labels: r.chars.map(readAloudCharLabel),
    needsLook: readAloudNeedsLook(r.chars),
  };
});

writeFileSync(join(OUT, 'read-aloud.json'), JSON.stringify({
  cases,
  buckets: [0, 49, 50, 74, 75, 89, 90, 99, 100].map((pct) => ({ pct, bucket: readAloudBucket(pct) })),
  copy: {
    label: READ_ALOUD_LABEL, again: READ_ALOUD_AGAIN, stop: READ_ALOUD_STOP, listening: READ_ALOUD_LISTENING,
    checking: READ_ALOUD_CHECKING, offline: READ_ALOUD_OFFLINE, empty: READ_ALOUD_EMPTY, youSaid: READ_ALOUD_YOU_SAID,
  },
}, null, 1));
