import { useCallback, useEffect, useState } from 'react';
import { effectiveAskLanguage, type AskLanguage } from '@shared/study/askClaude';
import { useAuth } from '../contexts/AuthContext';
import { setAskClaudeLanguage } from '../api/client';
import { track } from './analytics';

/**
 * "Ask Claude answers in: 中文 / English" (shared/study/askClaude.ts). The account's choice
 * rides on `/api/auth/me` (`ask_claude_language`, cached with the signed-in user, so it is
 * known offline); a change shows at once and is saved with `PUT /api/profile/ask-claude-language`.
 * Every ask also sends the language on screen, so a change that could not be saved yet still
 * applies to the next answer.
 */
export function useAskLanguage(): [AskLanguage, (language: AskLanguage, source: 'settings' | 'sheet') => Promise<void>] {
  const { user, refreshUser } = useAuth();
  const stored = user?.ask_claude_language ?? null;
  const [override, setOverride] = useState<AskLanguage | null>(null);
  // A fresh value from the server replaces the local one.
  useEffect(() => {
    setOverride(null);
  }, [stored]);

  const set = useCallback(
    async (language: AskLanguage, source: 'settings' | 'sheet') => {
      setOverride(language);
      track('study.ask_claude_language', { language, source });
      try {
        await setAskClaudeLanguage(language);
        await refreshUser();
      } catch (err) {
        // Kept on this device for now; the next ask carries it anyway.
        console.warn('[ask] saving the answer language failed:', err);
      }
    },
    [refreshUser],
  );

  return [override ?? effectiveAskLanguage(stored), set];
}
