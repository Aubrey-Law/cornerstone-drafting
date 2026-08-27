import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * A render crash below here used to leave the pane frozen on whatever it had
 * last painted — indistinguishable from "still loading". Word gives no other
 * signal, and the pane has no visible console, so an uncaught error was
 * effectively silent.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[cornerstone] pane crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid h-full place-items-center p-4 text-sm">
        <div className="space-y-3 text-center">
          <p className="font-medium">The pane hit an error.</p>
          <p className="text-[color:var(--color-ink-muted)]">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded border border-[color:var(--color-line)] px-3 py-1"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
}
