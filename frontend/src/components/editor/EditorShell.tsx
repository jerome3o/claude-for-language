/**
 * Generic editor layout: a main editing column with a Claude chat panel
 * beside it on wide screens, and a bottom tab bar (Edit / Preview / Claude)
 * on phones. Sticky header with back, title, dirty indicator, Save and an
 * overflow menu. Not lesson-specific — a reader editor can reuse it.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './editor.css';

export interface EditorMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Renders a divider above this item. */
  section?: boolean;
}

export type EditorView = 'edit' | 'preview' | 'chat';

export interface EditorShellProps {
  title: string;
  subtitle?: string;
  /** Where "back" goes. */
  backTo: string;
  dirty: boolean;
  saving?: boolean;
  /** False blocks Save (validation errors); the header explains why. */
  canSave: boolean;
  saveBlockedHint?: string;
  onSave: () => void;
  menu: EditorMenuItem[];
  edit: ReactNode;
  preview: ReactNode;
  chat: ReactNode;
  /** Controlled view (optional). */
  view?: EditorView;
  onViewChange?: (view: EditorView) => void;
}

const WIDE_QUERY = '(min-width: 1024px)';

export function useIsWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export function EditorShell(props: EditorShellProps) {
  const { title, subtitle, backTo, dirty, saving, canSave, saveBlockedHint, onSave, menu, edit, preview, chat } = props;
  const navigate = useNavigate();
  const wide = useIsWide();
  const [internalView, setInternalView] = useState<EditorView>('edit');
  const view = props.view ?? internalView;
  const setView = (v: EditorView) => {
    setInternalView(v);
    props.onViewChange?.(v);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Unsaved changes: warn on tab close / reload…
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // …and on our own back button.
  function goBack() {
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    navigate(backTo);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // On wide screens the chat is always visible, so the "chat" tab collapses to edit.
  const mainView: 'edit' | 'preview' = view === 'preview' ? 'preview' : 'edit';
  const showChatPane = wide || view === 'chat';
  const showMainPane = wide || view !== 'chat';

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <button className="editor-icon-btn" onClick={goBack} aria-label="Back">
          ←
        </button>
        <div className="editor-header-titles">
          <div className="editor-header-title">
            {title || 'Untitled'}
            {dirty && <span className="editor-dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
          </div>
          {subtitle && <div className="editor-header-subtitle">{subtitle}</div>}
        </div>
        {wide && (
          <div className="editor-segmented" role="tablist" aria-label="Main view">
            <button role="tab" aria-selected={mainView === 'edit'} className={mainView === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
              Edit
            </button>
            <button role="tab" aria-selected={mainView === 'preview'} className={mainView === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>
              Preview
            </button>
          </div>
        )}
        <button
          className="btn btn-primary editor-save-btn"
          onClick={onSave}
          disabled={!dirty || !canSave || saving}
          title={!canSave ? saveBlockedHint || 'Fix the problems first' : dirty ? 'Save changes' : 'No changes to save'}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <div className="editor-menu-wrap" ref={menuRef}>
          <button className="editor-icon-btn" onClick={() => setMenuOpen(o => !o)} aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen}>
            ⋯
          </button>
          {menuOpen && (
            <div className="editor-menu" role="menu">
              {!wide && view !== 'preview' && (
                <button role="menuitem" onClick={() => { setView('preview'); setMenuOpen(false); }}>
                  👁 Preview
                </button>
              )}
              {menu.map((item, i) => (
                <button
                  key={i}
                  role="menuitem"
                  className={`${item.danger ? 'danger' : ''} ${item.section ? 'section' : ''}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setMenuOpen(false);
                    item.onClick();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className={`editor-body ${wide ? 'wide' : ''}`}>
        {showMainPane && (
          <main className="editor-main">
            {mainView === 'edit' ? edit : preview}
          </main>
        )}
        {showChatPane && <aside className="editor-chat-pane">{chat}</aside>}
      </div>

      {!wide && (
        <nav className="editor-tabbar" aria-label="Editor sections">
          <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            ✏️ Edit
          </button>
          <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>
            👁 Preview
          </button>
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>
            ✨ Claude
          </button>
        </nav>
      )}
    </div>
  );
}
