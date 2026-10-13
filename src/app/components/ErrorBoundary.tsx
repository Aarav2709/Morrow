import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { commitEditors } from '../editor/commits';

interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  error: Error | null;
  key: string;
}

// a rendering fault replaces one view with a message instead of blanking the app
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Morrow view error', error, info.componentStack);
    try {
      commitEditors();
    } catch {
      // nothing more can be saved from a broken editor
    }
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state" role="alert">
        <h1>Something went wrong showing this view</h1>
        <p>Your saved pages are safe. Reloading usually fixes this.</p>
        <p className="muted small">{this.state.error.message}</p>
        <button type="button" className="button primary" onClick={() => window.location.reload()}>
          Reload Morrow
        </button>
      </div>
    );
  }
}
