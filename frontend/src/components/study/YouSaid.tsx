/**
 * "You said: pīnyīn (汉字) ✅" — ONE box for what was said aloud, on the read card's back (the
 * pronunciation take) and under a spoken answer on a typing card, so both look the same:
 * green = it matched, orange + "Answer found in your sentence" = the answer was said inside a
 * longer sentence (the read card's rule, `spokenAnswerWithin` in shared/cards/answer.ts),
 * red ❌ = not. Lab: `YouSaidBox` in ui/study/CardStage.kt.
 */
import { compareTranscription } from '@shared/recordings/transcript';
import { isAcceptedVerdict, type AnswerVerdict } from '@shared/cards/answer';

export interface YouSaidProps {
  hanzi: string;
  pinyin: string;
  isMatch: boolean;
  containsExpected: boolean;
}

export function YouSaid({ hanzi, pinyin, isMatch, containsExpected }: YouSaidProps) {
  const state = isMatch ? 'match' : containsExpected ? 'contains' : 'miss';
  const boxColor = isMatch
    ? { bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)' }
    : containsExpected
      ? { bg: 'rgba(249, 115, 22, 0.12)', border: 'rgba(249, 115, 22, 0.4)' }
      : { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)' };

  return (
    <div className="transcription-result" data-testid="you-said" data-state={state} style={{
      padding: '0.5rem 0.75rem',
      borderRadius: '6px',
      backgroundColor: boxColor.bg,
      border: `1px solid ${boxColor.border}`,
      fontSize: '0.875rem',
      marginBottom: '0.5rem',
    }}>
      <div style={{ fontWeight: 500 }}>
        You said: {pinyin} ({hanzi}) {isMatch || containsExpected ? '✅' : '❌'}
      </div>
      {containsExpected && !isMatch && (
        <div style={{ fontSize: '0.75rem', color: '#c2650a', marginTop: '0.125rem' }}>
          Answer found in your sentence
        </div>
      )}
    </div>
  );
}

/** The box's props for a spoken answer on a typing card: the read card's comparison, the match flags from the spoken verdict. */
export function spokenYouSaid(transcript: string, correct: string, verdict: AnswerVerdict): YouSaidProps {
  const c = compareTranscription(transcript, correct, '');
  const contains = verdict === 'contains';
  return {
    hanzi: c.transcribedHanzi,
    pinyin: c.transcribedPinyin,
    isMatch: isAcceptedVerdict(verdict) && !contains,
    containsExpected: contains,
  };
}
