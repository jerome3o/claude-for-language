/**
 * Settings → "Ask Claude answers in" (shared/study/askClaude.ts): 中文 (the default — simple,
 * graded Chinese with every word tappable) or English. Saved on the account
 * (PUT /api/profile/ask-claude-language), so the Lab app follows; the Ask Claude sheet's header
 * has the same switch.
 */
import type { AskLanguage } from '@shared/study/askClaude';
import { useAskLanguage } from '../../services/askClaudeLanguage';

const OPTIONS: Array<{ value: AskLanguage; label: string; hint: string }> = [
  { value: 'zh', label: '中文 Chinese', hint: 'Simple Chinese explanations — tap any word to look it up, hold a message to translate it.' },
  { value: 'en', label: 'English', hint: 'Explanations in English, with the Chinese and pinyin in the examples.' },
];

export function AskClaudeLanguageSection() {
  const [language, setLanguage] = useAskLanguage();
  return (
    <div className="settings-section" data-testid="ask-claude-language">
      <h2>Ask Claude answers in</h2>
      <div className="settings-radio-group" role="radiogroup" aria-label="Ask Claude answers in">
        {OPTIONS.map((o) => (
          <label key={o.value} className="settings-toggle-row" data-testid={`ask-claude-language-${o.value}`}>
            <input type="radio" name="ask-claude-language" checked={language === o.value} onChange={() => void setLanguage(o.value, 'settings')} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        {OPTIONS.find((o) => o.value === language)?.hint} Asking “in English please” always works for one answer.
      </p>
    </div>
  );
}
