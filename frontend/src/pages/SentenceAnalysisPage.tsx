import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { analyzeSentence } from '../api/client';
import { SentenceBreakdown } from '../components/SentenceBreakdown';
import { SentenceBreakdown as SentenceBreakdownType } from '../types';

export function SentenceAnalysisPage() {
  const [sentence, setSentence] = useState('');
  const [breakdown, setBreakdown] = useState<SentenceBreakdownType | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeSentence(sentence),
    onSuccess: (result) => {
      setBreakdown(result);
    },
  });

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (sentence.trim()) {
      analyzeMutation.mutate();
    }
  };

  const handleClear = () => {
    setBreakdown(null);
    setSentence('');
    analyzeMutation.reset();
  };

  const handleNewSentence = () => {
    setBreakdown(null);
    analyzeMutation.reset();
  };

  // Show breakdown result
  if (breakdown) {
    return (
      <div className="page">
        <div className="container sentence-analysis-page">
          <div className="mb-3">
            <button className="btn btn-secondary" onClick={handleNewSentence}>
              Analyze Another Sentence
            </button>
          </div>
          <SentenceBreakdown breakdown={breakdown} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container sentence-analysis-page">
        <h1 className="mb-2">Sentence Breakdown</h1>
        <p className="text-light mb-4">
          Enter a Chinese or English sentence to see how it breaks down into individual words and phrases,
          with aligned translations.
        </p>

        <div className="card">
          <form onSubmit={handleAnalyze} className="sentence-input-form">
            <div className="form-group">
              <label className="form-label">Enter a sentence</label>
              <textarea
                className="form-textarea"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                placeholder="e.g., 我想去北京旅游 or I want to travel to Beijing"
                required
                rows={3}
              />
            </div>

            {analyzeMutation.error && (
              <div className="sentence-error mb-3">
                Failed to analyze sentence. Please try again.
              </div>
            )}

            <div className="sentence-input-actions">
              <button
                type="submit"
                className="btn btn-primary flex-1"
                disabled={!sentence.trim() || analyzeMutation.isPending}
              >
                {analyzeMutation.isPending ? (
                  <>
                    <span className="spinner" style={{ width: '20px', height: '20px' }} />
                    Analyzing...
                  </>
                ) : (
                  'Analyze Sentence'
                )}
              </button>
              {sentence && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleClear}
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Loading state */}
        {analyzeMutation.isPending && (
          <div className="card mt-4">
            <div className="sentence-loading">
              <div className="sentence-loading-spinner" />
              <p>Analyzing sentence structure...</p>
            </div>
          </div>
        )}

        {/* Example sentences */}
        <div className="card mt-4">
          <h3 className="mb-2">Example Sentences</h3>
          <div className="flex flex-col gap-2">
            {[
              '我想买这个',
              '你好，请问洗手间在哪里？',
              '今天天气很好',
              '我每天早上喝咖啡',
              '这本书很有意思',
              'I want to learn Chinese',
            ].map((example) => (
              <button
                key={example}
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => setSentence(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {/* Feature description */}
        <div className="card mt-4">
          <h3 className="mb-2">How it works</h3>
          <ul style={{ paddingLeft: '1.25rem', color: 'var(--color-text-light)' }}>
            <li>Enter any Chinese sentence to see its breakdown</li>
            <li>Step through each word/phrase to understand the structure</li>
            <li>See how hanzi, pinyin, and English align</li>
            <li>Learn grammar notes for particles and constructions</li>
            <li>You can also enter English to see the Chinese translation breakdown</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default SentenceAnalysisPage;
