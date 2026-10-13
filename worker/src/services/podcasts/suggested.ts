/**
 * The "Suggested" Chinese podcasts on the Podcasts screen (docs/PODCASTS.md): learner podcasts
 * with public RSS feeds that were checked to fetch and parse (Oct 2026). Pure data — the feed
 * itself is fetched like any other when one is opened.
 */
export interface SuggestedPodcast {
  feed_url: string;
  title: string;
  /** One line: who it's for. */
  blurb: string;
  level: 'beginner' | 'intermediate' | 'advanced';
}

export const SUGGESTED_PODCASTS: SuggestedPodcast[] = [
  {
    feed_url: 'https://kitchenknif.github.io/SlowChinese/podcast.rss',
    title: '慢速中文 Slow Chinese',
    blurb: 'Short talks on everyday topics, read slowly and clearly (archive of 200+ episodes)',
    level: 'intermediate',
  },
  {
    feed_url: 'https://anchor.fm/s/843fa4ec/podcast/rss',
    title: 'Lazy Chinese',
    blurb: 'Slow, easy stories and chats — comprehensible input, all in Chinese',
    level: 'beginner',
  },
  {
    feed_url: 'https://feeds.libsyn.com/330782',
    title: 'TeaTime Chinese 茶歇中文',
    blurb: 'Natural conversations about life and culture between two hosts',
    level: 'intermediate',
  },
  {
    feed_url: 'https://anchor.fm/s/88ca316c/podcast/rss',
    title: 'Dashu Mandarin',
    blurb: 'Relaxed everyday Mandarin with clear explanations',
    level: 'intermediate',
  },
  {
    feed_url: 'https://anchor.fm/s/ddcc6ea0/podcast/rss',
    title: '秋月慢谈 Real Chinese Talk',
    blurb: 'Slow, natural talk for intermediate listeners',
    level: 'intermediate',
  },
  {
    feed_url: 'https://anchor.fm/s/5669fedc/podcast/rss',
    title: 'Slow Chinese with Mei',
    blurb: 'Short, slow episodes for beginners',
    level: 'beginner',
  },
  {
    feed_url: 'https://anchor.fm/s/10a2eb408/podcast/rss',
    title: 'Mandy Mandarin',
    blurb: 'From basic to intermediate: everyday topics, explained',
    level: 'beginner',
  },
  {
    feed_url: 'https://anchor.fm/s/5caa7664/podcast/rss',
    title: '還可中文 Haike Mandarin',
    blurb: 'Natural Taiwanese Mandarin conversations (traditional characters)',
    level: 'advanced',
  },
];
