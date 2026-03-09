import React from 'react';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  private isChunkLoadError(error: Error): boolean {
    const msg = error.message || '';
    return (
      msg.includes('Unable to preload CSS') ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Loading chunk') ||
      msg.includes('Loading CSS chunk')
    );
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Auto-reload on stale asset errors (happens after deployments)
    if (this.isChunkLoadError(error)) {
      const reloadKey = 'chunk-error-reload';
      const lastReload = sessionStorage.getItem(reloadKey);
      const now = Date.now();
      // Only auto-reload once per minute to avoid infinite loops
      if (!lastReload || now - parseInt(lastReload) > 60000) {
        sessionStorage.setItem(reloadKey, String(now));
        window.location.reload();
        return;
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const isStaleAsset = this.state.error ? this.isChunkLoadError(this.state.error) : false;
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">!</div>
            <h2>{isStaleAsset ? 'App Updated' : (this.props.fallbackTitle || 'Something went wrong')}</h2>
            <p className="text-light">
              {isStaleAsset
                ? 'A new version is available. Please reload to get the latest update.'
                : 'An unexpected error occurred. Your study data is safe.'}
            </p>
            {!isStaleAsset && this.state.error && (
              <details className="error-boundary-details">
                <summary>Error details</summary>
                <pre>{this.state.error.message}</pre>
              </details>
            )}
            <div className="error-boundary-actions">
              {isStaleAsset ? (
                <button className="btn btn-primary" onClick={() => window.location.reload()}>
                  Reload
                </button>
              ) : (
                <button className="btn btn-primary" onClick={this.handleReset}>
                  Try Again
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => window.location.assign('/')}
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
