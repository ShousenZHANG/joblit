import { Component, type ReactNode } from "react";
import { t } from "@ext/shared/i18n";

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
        <div className="jl-app jl-error-boundary" role="alert">
          <div className="jl-state-icon jl-state-icon--error jl-state-icon--large" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 8v4m0 4h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16A2 2 0 0 0 4.9 19Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </div>
          <h1>{t("app.crashed")}</h1>
          <p>{t("app.crashedDesc")}</p>
          {this.state.error && <code>{this.state.error.slice(0, 160)}</code>}
          <button onClick={this.handleReset} className="jl-btn jl-btn--primary">
            {t("app.tryAgain")}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
