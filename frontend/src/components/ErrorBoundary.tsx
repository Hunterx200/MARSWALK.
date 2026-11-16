import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('MARSWALK Component Tree Error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen w-screen bg-space-950 text-slate-100 p-6 text-center font-mono">
          <div className="max-w-md w-full bg-space-900 border border-space-700/80 rounded-2xl p-6 shadow-2xl flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-mars-500/10 border border-mars-500/30 flex items-center justify-center mb-4 text-mars-400">
              <AlertTriangle className="w-6 h-6 text-mars-400" />
            </div>
            <h2 className="text-base font-bold text-white mb-2 tracking-wide uppercase">
              Visual Subsystem Interruption
            </h2>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              An unexpected rendering exception was caught. The application prevented a full viewport crash.
            </p>
            {this.state.error?.message && (
              <div className="w-full mb-5 p-3 rounded-lg bg-space-950/80 border border-space-800 text-[11px] text-rose-300 break-words text-left font-mono">
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-mars-600 hover:bg-mars-500 text-white rounded-lg text-xs font-semibold tracking-wide transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
