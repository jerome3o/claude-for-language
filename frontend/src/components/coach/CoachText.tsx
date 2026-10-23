/**
 * The Sentence Coach's Chinese, tappable into the language explorer (docs/LANGUAGE_EXPLORER.md):
 * every word of a coach answer — the big sentence, the alternatives, the notes and Claude's chat
 * replies — opens the Word view (+ Add as card / ⚡ Study it today / Open card there). Words come
 * from the device segmenter (shared/chinese/segment.ts, `useSegmentedWords`); until its lists
 * have loaded the text is tappable character by character. Lab: `CoachZh` / `CoachMarkdown` in
 * ui/coach/CoachText.kt.
 */
import { Children, isValidElement, cloneElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hasHan } from '@shared/coach';
import { ExplorableText } from '../explorer/ExplorableText';
import { preloadSegmenter, useSegmentedWords } from '../../services/chineseSegmenter';

preloadSegmenter();

/** Text with its Chinese tappable by word (plain when there is none). */
export function CoachZh({ text, className }: { text: string; className?: string }) {
  const zh = hasHan(text);
  const words = useSegmentedWords(text, zh);
  if (!zh) return className ? <span className={className}>{text}</span> : <>{text}</>;
  return <ExplorableText text={text} segments={words} source="coach" className={className} />;
}

/** Every string child with Chinese in it → `CoachZh` (Markdown's text nodes). */
function explorable(children: ReactNode): ReactNode {
  return Children.map(children, (c) => {
    if (typeof c === 'string') return hasHan(c) ? <CoachZh text={c} /> : c;
    // `code` / links keep their own children untouched.
    if (isValidElement(c) && (c.type === 'code' || c.type === 'a' || c.type === 'pre')) return c;
    if (isValidElement<{ children?: ReactNode }>(c) && c.props.children !== undefined) {
      return cloneElement(c, undefined, explorable(c.props.children));
    }
    return c;
  });
}

const wrap = (Tag: 'p' | 'li' | 'td' | 'th' | 'h1' | 'h2' | 'h3' | 'h4' | 'blockquote') =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ({ node: _node, children, ...rest }: { node?: unknown; children?: ReactNode }) => <Tag {...rest}>{explorable(children)}</Tag>;

const COMPONENTS: Components = {
  p: wrap('p'),
  li: wrap('li'),
  td: wrap('td'),
  th: wrap('th'),
  h1: wrap('h1'),
  h2: wrap('h2'),
  h3: wrap('h3'),
  h4: wrap('h4'),
  blockquote: wrap('blockquote'),
};

/** Claude's chat reply (Markdown), its Chinese tappable by word. */
export function CoachMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
