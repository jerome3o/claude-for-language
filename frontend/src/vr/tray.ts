/** The tray (the window menu at hand height): open a window, 🎤, 💬 feedback, bring windows here. */
import type { UiNode } from './ui/layout';

export function trayNodes(opts: { presenting: boolean; listening: boolean; busy: boolean; online: boolean }): UiNode[] {
  const b = (label: string, action: string, tone: 'chip' | 'primary' | 'danger' = 'chip', disabled = false) => ({ t: 'button' as const, label, action, tone, size: 30, disabled });
  return [{
    t: 'row',
    mode: 'wrap',
    align: 'center',
    gap: 12,
    children: [
      b('📚 Study', 'open:study'),
      b('📖 Reader', 'open:reader'),
      b('✅ Homework', 'open:homework'),
      b('🔍 Explore', 'open:explorer'),
      opts.listening ? b('■ Stop', 'speak', 'primary') : b(opts.busy ? '… Listening' : '🎤 Speak', 'speak', 'chip', !opts.online || opts.busy),
      b('💬 Feedback', 'feedback'),
      b('↺ Bring here', 'recall'),
      ...(opts.presenting ? [b('Exit VR', 'exit', 'danger')] : []),
    ],
  }];
}
