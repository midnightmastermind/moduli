// ui/ErrorBoundary.jsx
// React error boundary — wraps Panels to catch render errors gracefully
import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", this.props.label || "Module", "crashed:", error, info.componentStack);
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      const label = this.props.label || "Module";
      return (
        <div
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 8, padding: 16, height: "100%", opacity: 0.8,
            background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 6,
          }}
        >
          <AlertTriangle style={{ width: 20, height: 20, color: "var(--danger)" }} />
          <div style={{ fontSize: 12, color: "var(--danger)", textAlign: "center" }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{label} crashed</div>
            <div style={{ opacity: 0.7, maxWidth: 200, wordBreak: "break-word" }}>
              {this.state.error?.message || "Unknown error"}
            </div>
          </div>
          <button
            onClick={this.reset}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "var(--danger)", opacity: 0.8, background: "none",
              border: "1px solid rgba(220,38,38,0.4)", borderRadius: 4, padding: "3px 8px", cursor: "pointer",
            }}
          >
            <RefreshCw style={{ width: 10, height: 10 }} />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
