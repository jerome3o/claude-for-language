/**
 * Sample lessons for the tutor catalogue: one short lesson per exercise type
 * (the conversation sample is a complete "conversation lesson" — key
 * phrases, the dialogue, then speaking in the same situation). Tutors take
 * them as a trial (nothing is recorded) or copy one into their library.
 *
 * Bundled, not generated: they must work offline and never change under a
 * tutor's feet. Every sample passes validateLessonSpec (samples.test.ts).
 */

import type { CustomLessonSpec, ExerciseType } from './types';

export interface SampleLesson {
  /** Stable id used in the catalogue route. */
  id: string;
  /** The exercise type this sample shows off. */
  type: ExerciseType;
  spec: CustomLessonSpec;
}

export const SAMPLE_LESSONS: SampleLesson[] = [
  {
    id: 'note',
    type: 'note',
    spec: {
      title: 'The 把 sentence',
      icon: '📖',
      sections: [{
        exercises: [{
          type: 'note',
          title: 'Doing something TO something',
          body: '把 moves the object in front of the verb: Subject + 把 + object + verb + result.\n\nUse it when you do something to a specific thing and something happens to it — it gets finished, moved, closed.',
          sentences: [
            { hanzi: '我把作业做完了。', pinyin: 'Wǒ bǎ zuòyè zuò wán le.', english: 'I finished my homework.' },
            { hanzi: '请把门关上。', pinyin: 'Qǐng bǎ mén guān shang.', english: 'Please close the door.' },
          ],
        }],
      }],
    },
  },
  {
    id: 'scramble',
    type: 'scramble',
    spec: {
      title: 'Word order: 把',
      icon: '🧩',
      sections: [{
        exercises: [
          { type: 'scramble', english: 'I finished my homework.', tiles: ['作业', '我', '做完了', '把'], correct_order: ['我', '把', '作业', '做完了'] },
          { type: 'scramble', english: 'Please close the door.', tiles: ['关上', '门', '请', '把'], correct_order: ['请', '把', '门', '关上'] },
        ],
      }],
    },
  },
  {
    id: 'choice',
    type: 'choice',
    spec: {
      title: 'Which one fits?',
      icon: '🔘',
      sections: [{
        exercises: [{
          type: 'choice',
          question: 'You want a friend at dinner to pass you the salt. You say:',
          options: [
            { hanzi: '请把盐递给我。', pinyin: 'Qǐng bǎ yán dì gěi wǒ.', english: 'Please pass me the salt.' },
            { hanzi: '请盐把递给我。', pinyin: 'Qǐng yán bǎ dì gěi wǒ.', english: '(wrong order)' },
            { hanzi: '我把盐。', pinyin: 'Wǒ bǎ yán.', english: '(no verb)' },
          ],
          correct: 0,
          explanation: '把 + the object comes before the verb 递给 (pass to).',
        }],
      }],
    },
  },
  {
    id: 'translate',
    type: 'translate',
    spec: {
      title: 'Say it in Chinese',
      icon: '✍️',
      sections: [{
        exercises: [
          { type: 'translate', english: 'Please put the book on the table.', reference_hanzi: '请把书放在桌子上。', reference_pinyin: 'Qǐng bǎ shū fàng zài zhuōzi shang.' },
          { type: 'translate', english: 'I have already eaten.', reference_hanzi: '我已经吃饭了。', reference_pinyin: 'Wǒ yǐjīng chīfàn le.' },
        ],
      }],
    },
  },
  {
    id: 'match',
    type: 'match',
    spec: {
      title: 'Drinks',
      icon: '🔗',
      sections: [{
        exercises: [{
          type: 'match',
          pairs: [
            { hanzi: '咖啡', pinyin: 'kāfēi', english: 'coffee' },
            { hanzi: '茶', pinyin: 'chá', english: 'tea' },
            { hanzi: '牛奶', pinyin: 'niúnǎi', english: 'milk' },
            { hanzi: '果汁', pinyin: 'guǒzhī', english: 'juice' },
            { hanzi: '水', pinyin: 'shuǐ', english: 'water' },
          ],
        }],
      }],
    },
  },
  {
    id: 'describe_image',
    type: 'describe_image',
    spec: {
      title: 'At the café',
      icon: '🖼',
      sections: [{
        exercises: [{
          type: 'describe_image',
          image_prompt: 'A small café counter: a barista hands two cups of coffee to a smiling woman, a chalkboard menu behind them, warm morning light',
          task: 'Describe what is happening.',
          reference_hanzi: '服务员给一位女士两杯咖啡。',
          reference_pinyin: 'Fúwùyuán gěi yí wèi nǚshì liǎng bēi kāfēi.',
          reference_english: 'The waiter gives a woman two cups of coffee.',
        }],
      }],
    },
  },
  {
    id: 'speak',
    type: 'speak',
    spec: {
      title: 'Ordering drinks',
      icon: '🎤',
      sections: [{
        exercises: [{
          type: 'speak',
          prompt: 'Order two coffees, one of them iced.',
          example: { hanzi: '我要两杯咖啡，一杯冰的。', pinyin: 'Wǒ yào liǎng bēi kāfēi, yì bēi bīng de.', english: 'I’d like two coffees, one iced.' },
        }],
      }],
    },
  },
  {
    id: 'listen_choice',
    type: 'listen_choice',
    spec: {
      title: 'Tones: buy or sell?',
      icon: '👂',
      sections: [{
        exercises: [
          {
            type: 'listen_choice',
            audio: { hanzi: '我想买这本书。', pinyin: 'Wǒ xiǎng mǎi zhè běn shū.', english: 'I want to buy this book.' },
            question: 'Which verb did you hear?',
            options: [{ hanzi: '买', pinyin: 'mǎi', english: 'buy' }, { hanzi: '卖', pinyin: 'mài', english: 'sell' }],
            correct: 0,
            explanation: '买 mǎi (third tone, dips) = buy; 卖 mài (fourth tone, falls) = sell.',
          },
          {
            type: 'listen_choice',
            audio: { hanzi: '他又来了。', pinyin: 'Tā yòu lái le.', english: 'He came again.' },
            question: 'Which word did you hear?',
            options: [{ hanzi: '又', pinyin: 'yòu', english: 'again' }, { hanzi: '有', pinyin: 'yǒu', english: 'to have' }],
            correct: 0,
          },
        ],
      }],
    },
  },
  {
    id: 'listen_translate',
    type: 'listen_translate',
    spec: {
      title: 'Weather',
      icon: '👂',
      sections: [{
        exercises: [{
          type: 'listen_translate',
          audio: { hanzi: '明天会下雨吗？', pinyin: 'Míngtiān huì xià yǔ ma?', english: 'Will it rain tomorrow?' },
        }],
      }],
    },
  },
  {
    id: 'sentence_making',
    type: 'sentence_making',
    spec: {
      title: 'Make your own sentences',
      icon: '🛠',
      sections: [{
        exercises: [
          {
            type: 'sentence_making',
            words: [{ hanzi: '因为', pinyin: 'yīnwèi', english: 'because' }, { hanzi: '所以', pinyin: 'suǒyǐ', english: 'so' }],
            task: 'Explain why you were late today.',
            input: 'type',
            example: { hanzi: '因为路上堵车，所以我迟到了。', pinyin: 'Yīnwèi lùshang dǔchē, suǒyǐ wǒ chídào le.', english: 'Because there was traffic, I was late.' },
          },
          {
            type: 'sentence_making',
            words: [{ hanzi: '已经', pinyin: 'yǐjīng', english: 'already' }],
            task: 'A friend invites you to lunch — tell them you have already eaten.',
            input: 'handwrite',
            example: { hanzi: '我已经吃饭了。', pinyin: 'Wǒ yǐjīng chīfàn le.', english: 'I’ve already eaten.' },
          },
        ],
      }],
    },
  },
  {
    id: 'write_typed',
    type: 'write_typed',
    spec: {
      title: 'Typing: pick the right characters',
      icon: '⌨️',
      sections: [{
        exercises: [
          { type: 'write_typed', prompt: 'Where do you borrow books?', answer: { hanzi: '图书馆', pinyin: 'túshūguǎn', english: 'library' } },
          { type: 'write_typed', answer: { hanzi: '我明天去医院。', pinyin: 'Wǒ míngtiān qù yīyuàn.', english: 'I’m going to the hospital tomorrow.' } },
          { type: 'write_typed', prompt: 'Listen, then type the word.', cues: ['audio', 'english'], answer: { hanzi: '以前', pinyin: 'yǐqián', english: 'before; in the past' } },
        ],
      }],
    },
  },
  {
    id: 'write_handwriting',
    type: 'write_handwriting',
    spec: {
      title: 'Handwriting: first characters',
      icon: '🖌',
      sections: [{
        exercises: [
          { type: 'write_handwriting', answer: { hanzi: '人', pinyin: 'rén', english: 'person' } },
          { type: 'write_handwriting', answer: { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' } },
          { type: 'write_handwriting', answer: { hanzi: '中国', pinyin: 'Zhōngguó', english: 'China' } },
        ],
      }],
    },
  },
  {
    id: 'dictation',
    type: 'dictation',
    spec: {
      title: 'Dictation: daily life',
      icon: '📝',
      sections: [{
        exercises: [
          { type: 'dictation', input: 'type', audio: { hanzi: '他每天早上七点起床。', pinyin: 'Tā měitiān zǎoshang qī diǎn qǐchuáng.', english: 'He gets up at seven every morning.' } },
          { type: 'dictation', input: 'type', audio: { hanzi: '这件衣服太贵了。', pinyin: 'Zhè jiàn yīfu tài guì le.', english: 'This piece of clothing is too expensive.' } },
          { type: 'dictation', input: 'handwrite', audio: { hanzi: '我喜欢喝茶。', pinyin: 'Wǒ xǐhuan hē chá.', english: 'I like drinking tea.' } },
        ],
      }],
    },
  },
  {
    id: 'oral_expression',
    type: 'oral_expression',
    spec: {
      title: 'Talk about your weekend',
      icon: '🗣',
      sections: [{
        exercises: [{
          type: 'oral_expression',
          prompt: 'Talk about what you did last weekend — where you went and who with.',
          question_audio: { hanzi: '你上个周末做了什么？', pinyin: 'Nǐ shàng ge zhōumò zuòle shénme?', english: 'What did you do last weekend?' },
          hints: [
            { hanzi: '周末', pinyin: 'zhōumò', english: 'weekend' },
            { hanzi: '和朋友', pinyin: 'hé péngyou', english: 'with friends' },
            { hanzi: '公园', pinyin: 'gōngyuán', english: 'park' },
          ],
          example: { hanzi: '上个周末我和朋友去了公园，我们在那儿吃了午饭。', pinyin: 'Shàng ge zhōumò wǒ hé péngyou qùle gōngyuán, wǒmen zài nàr chīle wǔfàn.', english: 'Last weekend I went to the park with friends; we had lunch there.' },
          target_seconds: 30,
        }],
      }],
    },
  },
  {
    id: 'conversation',
    type: 'conversation',
    spec: {
      title: 'Checking in at a hotel',
      icon: '🏨',
      description: 'A conversation lesson: key phrases, the dialogue in two voices, then your turn.',
      sections: [
        {
          title: 'Key phrases',
          exercises: [{
            type: 'note',
            body: 'Three phrases you will hear at any hotel front desk.',
            sentences: [
              { hanzi: '请问有预订吗？', pinyin: 'Qǐngwèn yǒu yùdìng ma?', english: 'Do you have a reservation?' },
              { hanzi: '我住三个晚上。', pinyin: 'Wǒ zhù sān ge wǎnshang.', english: 'I’m staying three nights.' },
              { hanzi: '祝您住得愉快！', pinyin: 'Zhù nín zhù de yúkuài!', english: 'Enjoy your stay!' },
            ],
          }],
        },
        {
          title: 'Listen',
          exercises: [{
            type: 'conversation',
            situation: 'Checking in at a hotel front desk',
            speakers: [
              { name: '前台 Receptionist', voice: 'female' },
              { name: '客人 Guest', voice: 'male' },
            ],
            lines: [
              { speaker: 0, hanzi: '您好！欢迎光临。请问有预订吗？', pinyin: 'Nín hǎo! Huānyíng guānglín. Qǐngwèn yǒu yùdìng ma?', english: 'Hello, welcome! Do you have a reservation?' },
              { speaker: 1, hanzi: '有，我叫王明，订了一个双人间。', pinyin: 'Yǒu, wǒ jiào Wáng Míng, dìngle yí ge shuāngrénjiān.', english: 'Yes, my name is Wang Ming. I booked a double room.' },
              { speaker: 0, hanzi: '好的，请给我看一下您的护照。', pinyin: 'Hǎo de, qǐng gěi wǒ kàn yíxià nín de hùzhào.', english: 'OK, may I see your passport, please?' },
              { speaker: 1, hanzi: '给您。我住三个晚上。', pinyin: 'Gěi nín. Wǒ zhù sān ge wǎnshang.', english: 'Here you are. I’m staying three nights.' },
              { speaker: 0, hanzi: '您的房间是八零六，在八楼。早饭七点到十点。', pinyin: 'Nín de fángjiān shì bā líng liù, zài bā lóu. Zǎofàn qī diǎn dào shí diǎn.', english: 'Your room is 806, on the eighth floor. Breakfast is from seven to ten.' },
              { speaker: 1, hanzi: '房间里有无线网吗？', pinyin: 'Fángjiān lǐ yǒu wúxiàn wǎng ma?', english: 'Is there Wi-Fi in the room?' },
              { speaker: 0, hanzi: '有，密码在房卡上。祝您住得愉快！', pinyin: 'Yǒu, mìmǎ zài fángkǎ shang. Zhù nín zhù de yúkuài!', english: 'Yes, the password is on your key card. Enjoy your stay!' },
              { speaker: 1, hanzi: '谢谢！', pinyin: 'Xièxie!', english: 'Thank you!' },
            ],
            questions: [
              { question: 'How many nights is the guest staying?', options: ['One', 'Two', 'Three', 'Four'], correct: 2 },
              { question: 'Which floor is the room on?', options: ['The 6th', 'The 8th', 'The 10th'], correct: 1, explanation: '八零六，在八楼 — room 806, on the 8th floor.' },
              { question: 'When is breakfast?', answer: 'From 7 to 10 o’clock (七点到十点).' },
              { question: 'Where is the Wi-Fi password?', options: ['On the key card', 'At the front desk', 'On the room door'], correct: 0 },
            ],
          }],
        },
        {
          title: 'Your turn',
          exercises: [{
            type: 'oral_expression',
            prompt: 'You are the guest. Check in: give your name, how many nights you are staying, and ask one question about the hotel.',
            hints: [
              { hanzi: '预订', pinyin: 'yùdìng', english: 'reservation' },
              { hanzi: '晚上', pinyin: 'wǎnshang', english: 'night' },
              { hanzi: '早饭', pinyin: 'zǎofàn', english: 'breakfast' },
            ],
            example: { hanzi: '你好，我叫王明，有预订。我住两个晚上。请问早饭几点？', pinyin: 'Nǐ hǎo, wǒ jiào Wáng Míng, yǒu yùdìng. Wǒ zhù liǎng ge wǎnshang. Qǐngwèn zǎofàn jǐ diǎn?', english: 'Hi, I’m Wang Ming, I have a reservation. I’m staying two nights. What time is breakfast?' },
          }],
        },
      ],
    },
  },
];

export function sampleLesson(id: string): SampleLesson | undefined {
  return SAMPLE_LESSONS.find(s => s.id === id);
}
