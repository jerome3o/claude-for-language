/**
 * Settings → Chat: the listening-mode default for chats that haven't been
 * switched on or off themselves (docs/CHAT.md "Listening mode").
 */
import { useEffect } from 'react';
import { refreshChatListening, setListeningDefault, useChatListening } from '../../services/chatListening';

export function ChatListeningSettings() {
  const { defaultOn } = useChatListening(undefined);
  useEffect(() => {
    void refreshChatListening();
  }, []);
  return (
    <div className="settings-section" data-testid="chat-settings">
      <h2>Chat</h2>
      <label className="settings-toggle-row" data-testid="chat-listening-default">
        <input type="checkbox" checked={defaultOn} onChange={(e) => void setListeningDefault(e.target.checked)} />
        <span>🎧 Listening mode in new chats</span>
      </label>
      <p className="settings-section-desc" style={{ marginTop: '0.4rem' }}>
        New Chinese messages arrive hidden: tap one to hear it, hold it to read it. Each chat can still be switched in its ⋯ menu.
      </p>
    </div>
  );
}
