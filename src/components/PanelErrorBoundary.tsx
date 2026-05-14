import * as React from "react";

interface Props {
  name: string;
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export class PanelErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Full diagnostic log
    // eslint-disable-next-line no-console
    console.error(
      `[Outcomes Panel Error] Panel "${this.props.name}" crashed:`,
      "\nmessage:", error.message,
      "\nstack:", error.stack,
      "\ncomponentStack:", info.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <section className="glass rounded-2xl p-3">
          <header className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-primary">
              Panel {this.props.name} encountered an error
            </h2>
            <button
              onClick={this.reset}
              className="rounded-xl bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider hover:bg-white/90"
            >
              Retry
            </button>
          </header>
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-white/50 p-2 font-mono text-[10px] text-foreground/80">
            {this.state.error.message || "Unknown error"}
          </pre>
          <p className="mt-1.5 text-[9px] text-muted-foreground">
            Full stack trace logged to console.
          </p>
        </section>
      );
    }
    return this.props.children as React.ReactElement;
  }
}

export function PanelPlaceholder({ name, message }: { name: string; message?: string }) {
  return (
    <section className="glass rounded-2xl p-3">
      <h2 className="font-display text-base font-semibold">{name}</h2>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {message ?? "Run a simulation to see this panel."}
      </p>
    </section>
  );
}
