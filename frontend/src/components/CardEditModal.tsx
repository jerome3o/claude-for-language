import { useState, useEffect, useCallback } from 'react';
import { CardWithNote, NoteAudioRecording, MINIMAX_VOICES } from '../types';
import {
  getNoteAudioRecordings,
  addNoteAudioRecording,
  generateNoteAudioRecording,
  setAudioRecordingPrimary,
  deleteAudioRecording,
  updateNote,
  deleteNote,
  API_BASE,
} from '../api/client';
import { useAudioRecorder, useNoteAudio } from '../hooks/useAudio';

interface CardEditModalProps {
  card: CardWithNote;
  onClose: () => void;
  onSave: (updatedNote: { hanzi: string; pinyin: string; english: string; fun_facts: string | null; audio_url: string | null }) => void;
  onDeleteCard?: () => void;
}

export default function CardEditModal({ card, onClose, onSave, onDeleteCard }: CardEditModalProps) {
  const [hanzi, setHanzi] = useState(card.note.hanzi);
  const [pinyin, setPinyin] = useState(card.note.pinyin);
  const [english, setEnglish] = useState(card.note.english);
  const [funFacts, setFunFacts] = useState(card.note.fun_facts || '');

  const [recordings, setRecordings] = useState<NoteAudioRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Audio playback tracking
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);

  // MiniMax generation options
  const [showMiniMaxOptions, setShowMiniMaxOptions] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>('__random__');
  const [audioSpeed, setAudioSpeed] = useState(0.8);

  const { isPlaying, play: playAudio, stop: stopAudio } = useNoteAudio();
  const {
    isRecording,
    audioBlob: recorderBlob,
    startRecording,
    stopRecording,
    clearRecording,
  } = useAudioRecorder();

  const loadRecordings = useCallback(async () => {
    try {
      setLoadingRecordings(true);
      const recs = await getNoteAudioRecordings(card.note.id);
      setRecordings(recs);
    } catch (err) {
      console.error('Failed to load audio recordings:', err);
    } finally {
      setLoadingRecordings(false);
    }
  }, [card.note.id]);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  // Upload recorded audio when recording stops
  useEffect(() => {
    if (recorderBlob) {
      const upload = async () => {
        try {
          await addNoteAudioRecording(card.note.id, recorderBlob, 'My Recording');
          clearRecording();
          await loadRecordings();
        } catch (err) {
          console.error('Failed to upload recording:', err);
        }
      };
      upload();
    }
  }, [recorderBlob, card.note.id, clearRecording, loadRecordings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateNote(card.note.id, {
        hanzi,
        pinyin,
        english,
        fun_facts: funFacts || undefined,
      });
      const primary = recordings.find(r => r.is_primary);
      onSave({
        hanzi,
        pinyin,
        english,
        fun_facts: funFacts || null,
        audio_url: primary?.audio_url || card.note.audio_url,
      });
      onClose();
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!onDeleteCard) return;
    setDeleting(true);
    try {
      await deleteNote(card.note.id);
      onDeleteCard();
      onClose();
    } catch (err) {
      console.error('Failed to delete note:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleGenerateAudio = async (provider: 'minimax' | 'gtts') => {
    setGenerating(true);
    try {
      const voiceId = selectedVoice === '__random__'
        ? MINIMAX_VOICES[Math.floor(Math.random() * MINIMAX_VOICES.length)].id
        : selectedVoice;
      const options = provider === 'minimax'
        ? { speed: audioSpeed, voiceId }
        : undefined;
      await generateNoteAudioRecording(card.note.id, provider, options);
      await loadRecordings();
    } catch (err) {
      console.error('Failed to generate audio:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleSetPrimary = async (recordingId: string) => {
    try {
      await setAudioRecordingPrimary(card.note.id, recordingId);
      await loadRecordings();
    } catch (err) {
      console.error('Failed to set primary:', err);
    }
  };

  const handleDeleteRecording = async (recordingId: string) => {
    try {
      await deleteAudioRecording(card.note.id, recordingId);
      setConfirmDeleteId(null);
      await loadRecordings();
    } catch (err) {
      console.error('Failed to delete recording:', err);
    }
  };

  // Clear playingRecordingId when audio finishes
  useEffect(() => {
    if (!isPlaying) setPlayingRecordingId(null);
  }, [isPlaying]);

  const handlePlayRecording = (recordingId: string, audioUrl: string) => {
    if (isPlaying && playingRecordingId === recordingId) {
      stopAudio();
      setPlayingRecordingId(null);
    } else {
      stopAudio();
      setPlayingRecordingId(recordingId);
      playAudio(audioUrl, card.note.hanzi, API_BASE);
    }
  };

  return (
    <div className="modal-overlay card-edit-modal-overlay" onClick={onClose}>
      <div className="modal card-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Edit Card</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="card-edit-content">
          {/* Text fields */}
          <div className="card-edit-fields">
            <div className="card-edit-field">
              <label>Hanzi</label>
              <input
                type="text"
                value={hanzi}
                onChange={e => setHanzi(e.target.value)}
                className="form-input"
              />
            </div>
            <div className="card-edit-field">
              <label>Pinyin</label>
              <input
                type="text"
                value={pinyin}
                onChange={e => setPinyin(e.target.value)}
                className="form-input"
              />
            </div>
            <div className="card-edit-field">
              <label>English</label>
              <input
                type="text"
                value={english}
                onChange={e => setEnglish(e.target.value)}
                className="form-input"
              />
            </div>
            <div className="card-edit-field">
              <label>Fun Facts</label>
              <textarea
                value={funFacts}
                onChange={e => setFunFacts(e.target.value)}
                className="form-input"
                rows={2}
              />
            </div>
          </div>

          {/* Audio recordings */}
          <div className="card-edit-audio-section">
            <h3>Audio Recordings</h3>

            {loadingRecordings ? (
              <p className="text-sm text-light">Loading recordings...</p>
            ) : recordings.length === 0 ? (
              <p className="text-sm text-light">No audio recordings yet.</p>
            ) : (
              <div className="card-edit-recordings-list">
                {recordings.map(rec => (
                  <div key={rec.id} className="card-edit-recording-item">
                    <button
                      className="btn btn-secondary btn-sm card-edit-play-btn"
                      onClick={() => handlePlayRecording(rec.id, rec.audio_url)}
                    >
                      {isPlaying && playingRecordingId === rec.id ? '...' : '\u25B6'}
                    </button>
                    <div className="card-edit-recording-info">
                      <span className="card-edit-speaker-name">
                        {rec.speaker_name || rec.provider}
                      </span>
                      {rec.is_primary && (
                        <span className="card-edit-primary-badge">Primary</span>
                      )}
                    </div>
                    <div className="card-edit-recording-actions">
                      {!rec.is_primary && (
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => handleSetPrimary(rec.id)}
                          title="Set as primary"
                        >
                          Set Primary
                        </button>
                      )}
                      {confirmDeleteId === rec.id ? (
                        <span className="card-edit-confirm-delete">
                          <button
                            className="btn btn-error btn-xs"
                            onClick={() => handleDeleteRecording(rec.id)}
                          >
                            Confirm
                          </button>
                          <button
                            className="btn btn-secondary btn-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => setConfirmDeleteId(rec.id)}
                          title="Delete recording"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="card-edit-audio-actions">
              <button
                className={`btn btn-secondary btn-sm${isRecording ? ' recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
              >
                {isRecording ? 'Stop' : 'Record'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleGenerateAudio('gtts')}
                disabled={generating}
              >
                {generating ? '...' : 'Google TTS'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowMiniMaxOptions(!showMiniMaxOptions)}
              >
                MiniMax {showMiniMaxOptions ? '\u25B2' : '\u25BC'}
              </button>
            </div>

            {/* MiniMax options panel */}
            {showMiniMaxOptions && (
              <div className="card-edit-minimax-options">
                <div className="card-edit-minimax-row">
                  <label>Voice</label>
                  <select
                    value={selectedVoice}
                    onChange={e => setSelectedVoice(e.target.value)}
                    className="form-input card-edit-voice-select"
                  >
                    <option value="__random__">Random</option>
                    {MINIMAX_VOICES.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div className="card-edit-minimax-row">
                  <label>Speed: {audioSpeed.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.3"
                    max="1.5"
                    step="0.1"
                    value={audioSpeed}
                    onChange={e => setAudioSpeed(parseFloat(e.target.value))}
                    className="card-edit-speed-slider"
                  />
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleGenerateAudio('minimax')}
                  disabled={generating}
                >
                  {generating ? 'Generating...' : 'Generate MiniMax'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer: Delete / Cancel / Save */}
        <div className="card-edit-footer">
          {onDeleteCard && (
            confirmDeleteCard ? (
              <div className="card-edit-delete-confirm">
                <span className="text-sm">Delete this note?</span>
                <button
                  className="btn btn-error btn-sm"
                  onClick={handleDeleteCard}
                  disabled={deleting}
                >
                  {deleting ? '...' : 'Yes, Delete'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setConfirmDeleteCard(false)}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                className="btn btn-secondary btn-sm card-edit-delete-btn"
                onClick={() => setConfirmDeleteCard(true)}
              >
                Delete Note
              </button>
            )
          )}
          <div className="card-edit-footer-right">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
