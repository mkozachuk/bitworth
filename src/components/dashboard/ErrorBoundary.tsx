import type { ReactNode } from "react";
import { Component, type ReactErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: ReactErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Dashboard error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/10 p-8 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-red-400"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          </div>
          <h3 className="mb-1 text-lg font-semibold text-white">Something went wrong</h3>
          <p className="mb-4 text-sm text-white/50">An unexpected error occurred in the dashboard.</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
            }}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/10"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
