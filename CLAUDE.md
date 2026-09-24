# kaigo-shift-saas 開発規約

介護施設向けシフト作成アプリのSaaS版。旧HTML版（localStorage）と同等機能を Firebase 上で再構築し、
法人内の複数施設へ横展開するプロジェクト。

## 必読ドキュメント（この順で）

1. `docs/remaining-work-design.md` — **残作業の実装設計。実装はこの設計に従う（source of truth）**
2. `docs/feature-parity.md` — 旧版との機能対応表。各フェーズ完了時に必ず更新
3. `docs/firestore-design.md` (rev.3) — データ構造・権限・設計判断の根拠
4. `docs/legacy-html-analysis.md` — 旧版のロジック詳細（生成アルゴリズム等）
5. `docs/environment-strategy.md` — dev/prod 分離の方針

## 絶対ルール

- **完成済み機能を変更しない。** 変更してよい統合ポイントは remaining-work-design.md に明記されている。
- Firebase CLI は必ず `firebase.cmd`（PowerShell の ExecutionPolicy 制約。ポリシー自体は変更禁止）。
- dev = `kaigo-shift-saas` / prod = `kaigo-shift-saas-prod`。デプロイは `npm run deploy:dev` / `deploy:prod`
  （常に `--project` 明示）。**prod への操作は毎回ユーザーに確認。dev は確認不要。**
- `git push` と `firebase.cmd login` はアシスタントから実行できない。ユーザーに依頼する。
- パスワードのフォーム入力はしない。ログインが必要な動作確認はユーザーに依頼する
  （dev管理者: takuro.ai.dev@gmail.com）。
- 新規 npm 依存は設計書で許可されたもののみ（現時点: P7 の `xlsx`、テスト用の `vitest`（devDependency、2026-09-24 許可））。
- 秘密鍵・サービスアカウントキーをコミットしない。`.env.local` は使わない
  （dev/prod の firebaseConfig は `.env.development` / `.env.production` にコミット済み。秘密情報ではない）。

## 作業サイクル（1フェーズごと）

1. 実装 → `npm run build:dev` と `npm run lint` を通す
2. ユーザーに手動確認を依頼（確認項目リストを提示。URL: http://localhost:5173）
3. `docs/feature-parity.md` を更新
4. コミット（日本語・フェーズ名先頭、例: `feat: Phase 4d-1 — …`）
5. `npm run deploy:dev`
6. ユーザーに `git push` を依頼

## 技術メモ

- Vite 8 / React 19 / TS 6 / oxlint / firebase v12。状態管理は React 標準のみ。
- Firestore: 施設サブコレクション方式。`assignments` は `Record<staffId, Record<day文字列, patternId>>`。
- **orderBy は対象フィールド未設定のドキュメントを除外する**。equality where + JS側ソートを基本にする。
- `settings/*` は「未作成 = 全null = 制約なし」。null 既定を返すフェッチヘルパーに寄せる。
- `src/domain/scheduler/` は React/Firestore を import しない純ロジック層。
- oxlint の `set-state-in-effect` / `only-export-components` 警告は既知・許容（エラーのみ対処）。
- ユーザーは開発初心者。専門用語・コマンドは1〜2文で説明してから提示し、1工程ずつ確認しながら進める。

## 作業ルール
- 返答は簡潔に。変更の説明は要点だけでよい
- コードの変更は差分（変えた部分）だけ示し、ファイル全体を貼り直さない
- node_modules、dist、build、.firebase フォルダは読まない
- どこを直すか不明なときは、フォルダ全体を探す前に質問する
- 決めたことは docs/決定事項.md に追記する（必要なときだけ参照する）
