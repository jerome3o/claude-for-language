/**
 * One tile of the call failing (an activity, a material, the board…) must not
 * take the whole call down: its error stays inside the tile, which shows a
 * short note with "Try again", while the cameras, the sound and every other
 * tile carry on. (The route's own boundary used to catch it and replace the
 * whole call with "Couldn't open the call".)
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What the tile is ("Board", "Activity") — for the note and the console. */
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class TileErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[call] the ${this.props.name} tile failed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="call-tile-body call-tile-error" role="alert" data-testid="tile-error">
        <p className="call-tile-error-title">This part of the call hit a problem.</p>
        <p className="call-muted">The call itself is fine — you can keep talking.</p>
        <button type="button" className="btn btn-secondary" onClick={() => this.setState({ error: null })} data-testid="tile-error-retry">
          Try again
        </button>
        <details className="call-tile-error-details">
          <summary>Details</summary>
          <pre>{`${error.name}: ${error.message}`}</pre>
        </details>
      </div>
    );
  }
}
