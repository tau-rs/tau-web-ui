import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { surfaceError } from "../notify/notify";

interface Props {
  children: ReactNode;
  /** When this value changes, the boundary clears any caught error. */
  resetKey?: unknown;
}
interface State {
  error: Error | null;
}

/** Catches render-time throws, reports them, and shows a recoverable fallback. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    surfaceError("UI crashed", error);
    console.error(info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div className="text-base font-semibold">Something went wrong</div>
        <div className="max-w-md break-words font-mono text-xs text-st-error">{error.message}</div>
        <div className="flex gap-2">
          <button
            onClick={this.reset}
            className="rounded-md border border-border px-3 py-1 text-xs font-semibold"
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
