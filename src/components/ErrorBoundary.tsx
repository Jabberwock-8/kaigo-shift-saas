import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 画面の描画中にエラーが起きても真っ白にせず、案内とエラー内容を出す（remaining-work-design.md §18 A6）。
 * React のエラー境界はクラスでしか書けないため、ここだけクラスにしている。
 * 保存処理（ボタンを押した後の非同期処理）のエラーはここには来ない（各画面がそれぞれ表示する）
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('画面の表示中にエラーが起きました', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className="app-shell">
        <section className="card error-boundary">
          <h2>エラーが起きました</h2>
          <p>画面を表示できませんでした。お手数ですが、再読み込みしてください。</p>
          <p className="muted">
            入力済みの勤務は、保存が終わったものは残っています。くり返し起きるときは、下の内容を管理者に伝えてください。
          </p>
          <pre className="error-boundary-detail">{error.message || String(error)}</pre>
          <p>
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              再読み込みする
            </button>
          </p>
        </section>
      </main>
    )
  }
}
