-- Grammar practice feature: daily exercises for learning grammatical structures
-- See docs/GRAMMAR_LEARNING_RESEARCH.md for the design rationale

-- Global catalogue of grammar points (not per-user)
CREATE TABLE IF NOT EXISTS grammar_points (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,              -- A1, A2, B1, B2
  title TEXT NOT NULL,
  pattern TEXT NOT NULL,            -- e.g. "Subj + 把 + Obj + Verb + 了"
  explanation TEXT NOT NULL,
  cgw_url TEXT,                     -- Chinese Grammar Wiki reference
  seed_examples TEXT NOT NULL,      -- JSON array of {hanzi, pinyin, english}
  order_index INTEGER NOT NULL,     -- default progression order within level
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-user progress on each grammar point
CREATE TABLE IF NOT EXISTS grammar_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  grammar_point_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',   -- new, learning, known
  correct_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  introduced_at TEXT,
  last_practiced_at TEXT,
  UNIQUE(user_id, grammar_point_id),
  FOREIGN KEY (grammar_point_id) REFERENCES grammar_points(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_grammar_progress_user ON grammar_progress(user_id);

-- A practice session = one sitting on one grammar point
CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  grammar_point_id TEXT NOT NULL,
  exercises_json TEXT NOT NULL,         -- generated exercises cached for the session
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (grammar_point_id) REFERENCES grammar_points(id)
);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user ON practice_sessions(user_id, started_at);

-- Individual exercise attempts within a session
CREATE TABLE IF NOT EXISTS practice_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  grammar_point_id TEXT NOT NULL,
  exercise_type TEXT NOT NULL,          -- flood, scramble, contrast, translate
  exercise_index INTEGER NOT NULL,
  prompt_json TEXT NOT NULL,
  user_answer TEXT,
  is_correct INTEGER,
  feedback_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_practice_attempts_session ON practice_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_practice_attempts_user_point ON practice_attempts(user_id, grammar_point_id);

-- Seed A2 grammar points (Chinese Grammar Wiki, ordered roughly by utility)

INSERT OR IGNORE INTO grammar_points (id, level, title, pattern, explanation, cgw_url, seed_examples, order_index) VALUES
('a2-le-completion', 'A2', '了 for completed actions', 'Subj + Verb + 了 + Obj',
 'Placed after the verb, 了 indicates the action is completed. It is about completion, not past tense — it can apply to future completed actions too.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_completion_with_%22le%22',
 '[{"hanzi":"我吃了饭","pinyin":"wǒ chī le fàn","english":"I ate (have eaten)"},{"hanzi":"他买了三本书","pinyin":"tā mǎi le sān běn shū","english":"He bought three books"}]',
 1),

('a2-le-change', 'A2', '了 for change of state', 'Statement + 了',
 'At the end of a sentence, 了 marks a change of state or a new situation — "now (something is the case)."',
 'https://resources.allsetlearning.com/chinese/grammar/Change_of_state_with_%22le%22',
 '[{"hanzi":"下雨了","pinyin":"xià yǔ le","english":"It''s raining now"},{"hanzi":"我会说中文了","pinyin":"wǒ huì shuō zhōngwén le","english":"I can speak Chinese now"}]',
 2),

('a2-guo-experience', 'A2', '过 for past experience', 'Subj + Verb + 过 + Obj',
 '过 after a verb means you have had the experience of doing something at some point — "have ever done."',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_experiences_with_%22guo%22',
 '[{"hanzi":"我去过中国","pinyin":"wǒ qù guo zhōngguó","english":"I have been to China"},{"hanzi":"你吃过北京烤鸭吗？","pinyin":"nǐ chī guo běijīng kǎoyā ma","english":"Have you ever eaten Peking duck?"}]',
 3),

('a2-zai-progressive', 'A2', '在 / 正在 for actions in progress', 'Subj + 在/正在 + Verb',
 '在 or 正在 before a verb means the action is happening right now — equivalent to English "-ing."',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_actions_in_progress_with_%22zai%22',
 '[{"hanzi":"我在吃饭","pinyin":"wǒ zài chī fàn","english":"I am eating"},{"hanzi":"他正在打电话","pinyin":"tā zhèngzài dǎ diànhuà","english":"He is on the phone right now"}]',
 4),

('a2-bi-comparison', 'A2', '比 for comparisons', 'A + 比 + B + Adj',
 '比 compares two things. The adjective comes after, with no 很. "A 比 B 高" = A is taller than B.',
 'https://resources.allsetlearning.com/chinese/grammar/Basic_comparisons_with_%22bi%22',
 '[{"hanzi":"我比他高","pinyin":"wǒ bǐ tā gāo","english":"I am taller than him"},{"hanzi":"今天比昨天冷","pinyin":"jīntiān bǐ zuótiān lěng","english":"Today is colder than yesterday"}]',
 5),

('a2-cong-dao', 'A2', '从…到… (from…to…)', '从 + A + 到 + B',
 'Expresses a range — of time, place, or anything with a start and end point.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22from%E2%80%A6_to%E2%80%A6%22_with_%22cong%E2%80%A6_dao%E2%80%A6%22',
 '[{"hanzi":"我从九点到五点工作","pinyin":"wǒ cóng jiǔ diǎn dào wǔ diǎn gōngzuò","english":"I work from 9 to 5"},{"hanzi":"从这里到那里很远","pinyin":"cóng zhèlǐ dào nàlǐ hěn yuǎn","english":"It''s far from here to there"}]',
 6),

('a2-yao-le', 'A2', '要…了 (about to happen)', '要 + Verb + 了',
 'Indicates something is about to happen soon. Often with 快 (快要…了).',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22about_to_happen%22_with_%22le%22',
 '[{"hanzi":"我要走了","pinyin":"wǒ yào zǒu le","english":"I''m about to leave"},{"hanzi":"快要下雨了","pinyin":"kuài yào xià yǔ le","english":"It''s about to rain"}]',
 7),

('a2-yinwei-suoyi', 'A2', '因为…所以… (because…so…)', '因为 + Reason，所以 + Result',
 'Links a cause and its result. Unlike English, Chinese commonly uses both connectors together.',
 'https://resources.allsetlearning.com/chinese/grammar/Cause_and_effect_with_%22yinwei%22_and_%22suoyi%22',
 '[{"hanzi":"因为下雨，所以我没去","pinyin":"yīnwèi xià yǔ, suǒyǐ wǒ méi qù","english":"Because it rained, I didn''t go"}]',
 8),

('a2-suiran-danshi', 'A2', '虽然…但是… (although…but…)', '虽然 + A，但是 + B',
 'Expresses contrast. Both words are normally used together, unlike English.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22although%22_with_%22suiran%22_and_%22danshi%22',
 '[{"hanzi":"虽然很累，但是我很高兴","pinyin":"suīrán hěn lèi, dànshì wǒ hěn gāoxìng","english":"Although I''m tired, I''m happy"}]',
 9),

('a2-ruguo-jiu', 'A2', '如果…就… (if…then…)', '如果 + Condition，就 + Result',
 'Basic conditional. 就 introduces the consequence.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22if%E2%80%A6_then%E2%80%A6%22_with_%22ruguo%E2%80%A6_jiu%E2%80%A6%22',
 '[{"hanzi":"如果你来，我就告诉你","pinyin":"rúguǒ nǐ lái, wǒ jiù gàosu nǐ","english":"If you come, I''ll tell you"}]',
 10),

('a2-yi-jiu', 'A2', '一…就… (as soon as)', '一 + Action 1，就 + Action 2',
 'As soon as the first action happens, the second follows immediately.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22as_soon_as%22_with_%22yi..._jiu...%22',
 '[{"hanzi":"我一到家就睡觉","pinyin":"wǒ yī dào jiā jiù shuìjiào","english":"As soon as I get home I go to sleep"}]',
 11),

('a2-you-you', 'A2', '又…又… (both…and…)', '又 + Adj1 + 又 + Adj2',
 'Links two qualities or actions that both apply. Usually both positive or both negative.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22both_A_and_B%22_with_%22you%22',
 '[{"hanzi":"她又聪明又漂亮","pinyin":"tā yòu cōngming yòu piàoliang","english":"She is both smart and pretty"}]',
 12),

('a2-yuelaiyue', 'A2', '越来越 (more and more)', 'Subj + 越来越 + Adj',
 'Indicates a quality is increasing over time.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22more_and_more%22_with_%22yuelaiyue%22',
 '[{"hanzi":"天气越来越冷","pinyin":"tiānqì yuè lái yuè lěng","english":"The weather is getting colder and colder"}]',
 13),

('a2-haishi-huozhe', 'A2', '还是 vs 或者 (or)', 'Question: A 还是 B？ / Statement: A 或者 B',
 '还是 is "or" in questions; 或者 is "or" in statements. They are not interchangeable.',
 'https://resources.allsetlearning.com/chinese/grammar/Comparing_%22haishi%22_and_%22huozhe%22',
 '[{"hanzi":"你喝茶还是咖啡？","pinyin":"nǐ hē chá háishi kāfēi","english":"Do you want tea or coffee?"},{"hanzi":"我们可以坐公共汽车或者地铁","pinyin":"wǒmen kěyǐ zuò gōnggòng qìchē huòzhě dìtiě","english":"We can take the bus or the subway"}]',
 14),

('a2-li-distance', 'A2', '离 for distance', 'A + 离 + B + 远/近',
 '离 expresses the distance of A from B. The adjective (far/near) comes after.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_distance_with_%22li%22',
 '[{"hanzi":"我家离学校很近","pinyin":"wǒ jiā lí xuéxiào hěn jìn","english":"My home is close to the school"}]',
 15),

('a2-gei-preposition', 'A2', '给 as a preposition (for/to)', 'Subj + 给 + Person + Verb',
 'Before the verb, 给 marks the recipient or beneficiary — "do something for/to someone."',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_%22for%22_with_%22gei%22',
 '[{"hanzi":"我给你打电话","pinyin":"wǒ gěi nǐ dǎ diànhuà","english":"I''ll call you"},{"hanzi":"他给我买了一本书","pinyin":"tā gěi wǒ mǎi le yī běn shū","english":"He bought a book for me"}]',
 16),

('a2-verb-wan', 'A2', 'Verb + 完 (finish doing)', 'Verb + 完 (+ 了)',
 '完 after a verb is a result complement meaning the action is finished.',
 'https://resources.allsetlearning.com/chinese/grammar/Result_complement_%22-wan%22_for_finishing',
 '[{"hanzi":"我吃完了","pinyin":"wǒ chī wán le","english":"I''ve finished eating"},{"hanzi":"你做完作业了吗？","pinyin":"nǐ zuò wán zuòyè le ma","english":"Have you finished your homework?"}]',
 17),

('a2-verb-dao', 'A2', 'Verb + 到 (achieve a result)', 'Verb + 到 + Obj',
 '到 as a result complement means the action successfully reached its goal — saw it, found it, heard it.',
 'https://resources.allsetlearning.com/chinese/grammar/Result_complements_%22dao%22_and_%22jian%22',
 '[{"hanzi":"我找到了","pinyin":"wǒ zhǎo dào le","english":"I found it"},{"hanzi":"你听到了吗？","pinyin":"nǐ tīng dào le ma","english":"Did you hear it?"}]',
 18),

('a2-de-degree', 'A2', 'Verb + 得 + degree', 'Verb + 得 + Adj',
 '得 links a verb to a description of how well/fast/etc. it is done. "He runs fast" = 他跑得很快.',
 'https://resources.allsetlearning.com/chinese/grammar/Degree_complement',
 '[{"hanzi":"他说得很好","pinyin":"tā shuō de hěn hǎo","english":"He speaks very well"},{"hanzi":"你跑得太快了","pinyin":"nǐ pǎo de tài kuài le","english":"You run too fast"}]',
 19),

('a2-time-duration', 'A2', 'Duration after the verb', 'Verb + (了) + Duration',
 'To say how long an action lasted, put the time duration AFTER the verb, not before.',
 'https://resources.allsetlearning.com/chinese/grammar/Expressing_duration_with_%22le%22',
 '[{"hanzi":"我学了三年中文","pinyin":"wǒ xué le sān nián zhōngwén","english":"I studied Chinese for three years"},{"hanzi":"他睡了八个小时","pinyin":"tā shuì le bā ge xiǎoshí","english":"He slept for eight hours"}]',
 20),

('a2-youdianr', 'A2', '有点儿 vs 一点儿', '有点儿 + Adj / Adj + 一点儿',
 '有点儿 goes BEFORE an adjective (slight complaint: "a bit cold"). 一点儿 goes AFTER (comparison/request: "a bit cheaper").',
 'https://resources.allsetlearning.com/chinese/grammar/Comparing_%22youdian%22_and_%22yidian%22',
 '[{"hanzi":"今天有点儿冷","pinyin":"jīntiān yǒudiǎnr lěng","english":"It''s a bit cold today"},{"hanzi":"便宜一点儿吧","pinyin":"piányi yīdiǎnr ba","english":"Make it a bit cheaper"}]',
 21),

('a2-hui-neng-keyi', 'A2', '会 / 能 / 可以 (can)', 'Subj + 会/能/可以 + Verb',
 '会 = learned ability; 能 = physical ability or circumstances; 可以 = permission. All translate to "can" but are not interchangeable.',
 'https://resources.allsetlearning.com/chinese/grammar/Comparing_%22hui%22_%22neng%22_%22keyi%22',
 '[{"hanzi":"我会游泳","pinyin":"wǒ huì yóuyǒng","english":"I can swim (I know how)"},{"hanzi":"你可以进来","pinyin":"nǐ kěyǐ jìnlai","english":"You may come in"}]',
 22),

('a2-cai-jiu', 'A2', '才 vs 就 (only then / right away)', 'Time + 才/就 + Verb',
 '才 = later/slower than expected. 就 = earlier/sooner than expected. Same slot, opposite feel.',
 'https://resources.allsetlearning.com/chinese/grammar/Comparing_%22cai%22_and_%22jiu%22',
 '[{"hanzi":"他九点才起床","pinyin":"tā jiǔ diǎn cái qǐchuáng","english":"He didn''t get up until 9"},{"hanzi":"他六点就起床了","pinyin":"tā liù diǎn jiù qǐchuáng le","english":"He got up at 6 already"}]',
 23),

('a2-ba-basic', 'A2', '把 (basic disposal)', 'Subj + 把 + Obj + Verb + Complement',
 '把 moves the object before the verb to say what you DO TO it. The verb must have a result/complement — you can''t end on a bare verb.',
 'https://resources.allsetlearning.com/chinese/grammar/Using_%22ba%22_sentences',
 '[{"hanzi":"我把门关上了","pinyin":"wǒ bǎ mén guān shàng le","english":"I closed the door"},{"hanzi":"请把书放在桌子上","pinyin":"qǐng bǎ shū fàng zài zhuōzi shàng","english":"Please put the book on the table"}]',
 24),

('a2-shi-de', 'A2', '是…的 (emphasising details)', '是 + Detail + Verb + 的',
 'Used for past events to emphasise WHEN, WHERE, HOW, or WHO — not whether it happened.',
 'https://resources.allsetlearning.com/chinese/grammar/The_%22shi..._de%22_construction_for_emphasizing_details',
 '[{"hanzi":"你是什么时候来的？","pinyin":"nǐ shì shénme shíhou lái de","english":"When did you come?"},{"hanzi":"我是坐飞机来的","pinyin":"wǒ shì zuò fēijī lái de","english":"I came by plane"}]',
 25);
