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
          <div className="flex flex-col items-center px-10 py-8 rounded-2xl bg-card border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_40px_rgba(0,0,0,0.5)]">
            <AlertTriangle size={28} className="mb-3 text-destructive" />
            <p className="text-sm uppercase tracking-[0.14em] text-destructive font-semibold data-readout">
              SYSTEM FAULT
            </p>
            <p className="text-xs mt-1.5 text-muted-foreground">
              Console encountered an unrecoverable error
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground shadow-[0_0_16px_hsla(68,96%,58%,0.25)] hover:brightness-110 data-readout transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
