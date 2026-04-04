import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
            {this.state.error}
          </div>
          <button
            onClick={this.handleReset}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
