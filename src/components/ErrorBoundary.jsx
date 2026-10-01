import { Component } from 'react'

// Last line of defense against an uncaught render-time exception taking the whole app down
// to a blank page with nothing a teammate can do about it except guess to hard-refresh.
// Catches it, shows a recoverable screen, and reports what actually broke to the console so
// it's still debuggable from a bug report's dev console output.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center',
        background: '#0a0a0a', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Something went wrong.</div>
        <div style={{ fontSize: 13, color: '#999', maxWidth: 440 }}>
          {this.state.error?.message || 'An unexpected error occurred.'}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#d2fe5c', color: '#0a0a0a', fontWeight: 600, fontSize: 13,
          }}
        >
          Reload page
        </button>
      </div>
    )
  }
}
