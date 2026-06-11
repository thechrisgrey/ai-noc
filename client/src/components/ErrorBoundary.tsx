import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center scanlines grid-bg">
          <div className="flex flex-col items-center px-10 py-8 rounded border border-red-500/25 bg-red-950/15 border-l-[3px] border-l-red-500">
            <AlertTriangle size={28} className="mb-3 text-red-400/60" />
            <p className="text-sm uppercase tracking-wider text-red-400/80 font-semibold data-readout">
              SYSTEM FAULT
            </p>
            <p className="text-xs mt-1 text-muted-foreground/60">
              Console encountered an unrecoverable error
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded border border-primary/20 text-primary hover:bg-primary/10 data-readout transition-colors"
            >
              RELOAD CONSOLE
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
