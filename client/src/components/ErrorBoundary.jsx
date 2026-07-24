import { Component } from 'react';

// A minimal error boundary. Without one, ANY thrown error during render unmounts
// the whole React tree to a blank screen (the app had none). Wrap a subtree in
// <ErrorBoundary> so a crash there degrades to a small inline notice instead of
// blanking everything around it.
//
// Props:
//   fallback?  — what to show when the child threw. A node, or a function
//                (error) => node. Defaults to null (render nothing — good for a
//                non-essential add-on like the capo banner, so the surrounding
//                view stays fully usable).
//   label?     — optional name used in the console warning, to locate the crash.
//   onReset?   — optional; when the `resetKey` changes the boundary clears its
//                error and re-renders the children.
//   resetKey?  — when this value changes, the boundary resets (e.g. the song id,
//                so navigating to a different song retries a failed subtree).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface it for debugging without crashing the app.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
      this.props.onReset?.();
    }
  }

  render() {
    if (this.state.error) {
      const { fallback = null } = this.props;
      return typeof fallback === 'function' ? fallback(this.state.error) : fallback;
    }
    return this.props.children;
  }
}
