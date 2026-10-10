import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Coverage crashed:', error, info);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error" role="alert">
          <div className="app-error-card">
            <p className="app-error-eyebrow">Coverage encountered an error</p>
            <h1>Your locally saved work is still available.</h1>
            <p>Reload the app to recover and continue from the latest saved version.</p>
            <button type="button" onClick={this.reload}>Reload Coverage</button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
