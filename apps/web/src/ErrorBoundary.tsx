import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Lỗi hiển thị bất ngờ → thông báo và nút tải lại thay vì trang trắng. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lỗi giao diện', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main>
        <section className="card">
          <p className="error">Đã có lỗi khi hiển thị trang này.</p>
          <p className="hint">{this.state.error.message}</p>
          <button className="button" onClick={() => window.location.reload()}>
            Tải lại
          </button>
        </section>
      </main>
    );
  }
}
