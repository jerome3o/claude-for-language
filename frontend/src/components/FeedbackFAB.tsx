import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createFeatureRequest } from '../api/client';

export function FeedbackFAB() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await createFeatureRequest(content.trim(), location.pathname);
      setSubmitted(true);
      setContent('');
      setTimeout(() => {
        setSubmitted(false);
        setIsOpen(false);
      }, 1500);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [content, isSubmitting, location.pathname]);

  if (!isAuthenticated) return null;

  // Hide during fullscreen study (when study-started class is on body or URL is /study)
  const isStudying = location.pathname === '/study';

  return (
    <>
      {!isOpen && (
        <button
          className={`feedback-fab ${isStudying ? 'feedback-fab-subtle' : ''}`}
          onClick={() => setIsOpen(true)}
          aria-label="Send feedback"
        >
          <span className="feedback-fab-icon">💬</span>
        </button>
      )}

      {isOpen && (
        <div className="feedback-modal-overlay" onClick={() => { if (!isSubmitting) setIsOpen(false); }}>
          <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
            <div className="feedback-modal-header">
              <h3>Feedback / Feature Request</h3>
              <button className="modal-close" onClick={() => setIsOpen(false)}>&times;</button>
            </div>

            {submitted ? (
              <div className="feedback-success">
                <p>Thanks! Your feedback has been submitted.</p>
              </div>
            ) : (
              <>
                <textarea
                  className="feedback-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe a feature you'd like or give feedback..."
                  rows={4}
                  autoFocus
                  disabled={isSubmitting}
                />
                <div className="feedback-context">
                  Page: {location.pathname}
                </div>
                <div className="feedback-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setIsOpen(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={!content.trim() || isSubmitting}
                  >
                    {isSubmitting ? 'Sending...' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
