import './App.css'
import { firebaseStatus } from './lib/firebase'

function App() {
  return (
    <main className="app-shell">
      <h1>介護シフト作成</h1>
      <p className="tagline">SaaS版プロトタイプ — Phase 0（骨格）</p>

      <section className="card">
        <h2>Firebase 接続設定</h2>
        {firebaseStatus.configured ? (
          <p className="ok">
            設定を読み込みました（projectId: <code>{firebaseStatus.projectId}</code>）
          </p>
        ) : (
          <p className="warn">
            未設定です。<code>.env.local</code> に Firebase の接続情報を記入してください
            （<code>.env.example</code> がひな形です）。
          </p>
        )}
      </section>

      <section className="card">
        <h2>次のステップ</h2>
        <ul>
          <li>Firebase プロジェクト作成 → <code>.env.local</code> 記入</li>
          <li>Hosting へ初回デプロイ</li>
          <li>GitHub へ初回 push</li>
          <li>Phase 1: ログイン → 施設選択 → 職員一覧</li>
        </ul>
      </section>
    </main>
  )
}

export default App
