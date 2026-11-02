'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** What to draw instead of the children once they throw; `reset` mounts them again. */
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
  /** A change here (say, the widget's params) clears a caught error on its own. */
  resetKey?: unknown;
  children: ReactNode;
}

interface ErrorBoundaryState { error: Error | null; resetKey: unknown }

/**
 * Keeps one part's render exception inside that part. Without it, a single
 * throwing widget unmounts the whole React tree and the app goes blank.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback({ error: this.state.error, reset: this.reset }) : this.props.children;
  }
}
