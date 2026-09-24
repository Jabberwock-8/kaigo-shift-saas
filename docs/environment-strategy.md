# dev / prod 環境分離方針

作成日: 2026-09-11 / 対象: Phase 0 / ステータス: 確定（ユーザー承認済み）

---

## 1. 結論

- **リポジトリ／ソースコードは1つ**のまま。**Firebase プロジェクトのみ**を dev と prod で分ける。
- **分離のタイミング: 今（Phase 0 の終盤、Phase 1 着手前）。**
  理由: この時点では Firestore にドキュメントが1件もなく、Authentication にもユーザーが1件もない。
  分離コストが最小のタイミングであり、Phase 1 でテストデータ・テストアカウントを投入し始めると
  「どれが開発用でどれが本番用か」の仕分けが発生し、後回しにするほど分離コストが上がるため。
- **プロジェクトの作り方**: 既存の `kaigo-shift-saas` を **そのまま dev として続投**。
  新規に **`kaigo-shift-saas-prod`** を1つだけ作成する。
  （Firebase のプロジェクトIDは作成後にリネームできないため、`kaigo-shift-saas-dev` /
  `kaigo-shift-saas-prod` という完全対称の命名にはしない。既存プロジェクトの
  Auth有効化・Firestore作成・Rules配布・Hosting公開の作業を無駄にしないための判断。）

| 環境 | Firebase プロジェクトID | Hosting URL |
|---|---|---|
| dev | `kaigo-shift-saas`（既存） | https://kaigo-shift-saas.web.app |
| prod | `kaigo-shift-saas-prod`（新規） | https://kaigo-shift-saas-prod.web.app |

---

## 2. 比較検討した3案（記録として残す）

| 案 | 内容 | 採否 |
|---|---|---|
| A | 既存プロジェクトを dev として使う | **採用** |
| B | 既存プロジェクトを prod として使う | 不採用。Phase 1以降の試行錯誤（テストユーザー登録・ルールの試し撃ち・ダミーデータ投入）を本番でやることになり、分離の目的と矛盾する |
| C | いったん共通のまま進め、後で分離 | 不採用。データ・ユーザーが増えるほど分離時の仕分けコストが上がる。実質「後でBの状態から切り出す」のと同じで、今やるより高くつく |

---

## 3. 環境切替の仕組み

### ファイル構成

```
.env.development   … dev用 firebaseConfig。コミットする（Firebase Web の接続情報は秘密情報ではないため）
.env.production    … prod用 firebaseConfig。コミットする
.env.local         … 個人用の一時上書き（.gitignore 対象のまま）。通常は空/未使用
```

Vite は実行モードに応じて読むファイルを自動選択する（`vite` = development モード、
`vite build` の既定 = production モード）。

### `.firebaserc`（プロジェクトエイリアス）

```json
{
  "projects": {
    "default": "kaigo-shift-saas",
    "dev": "kaigo-shift-saas",
    "prod": "kaigo-shift-saas-prod"
  }
}
```

### npm scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "build:dev": "tsc -b && vite build --mode development",
  "preview": "vite preview",
  "deploy:dev": "npm run build:dev && firebase.cmd deploy --project dev",
  "deploy:prod": "npm run build && firebase.cmd deploy --project prod"
}
```

- デプロイ先は **常に `--project dev` / `--project prod` を明示**し、`firebase.cmd use` で
  「現在選択中のプロジェクト」に依存するやり方は使わない（誤って別環境へ deploy する事故を防ぐため）。
- Firebase CLI は本PCの PowerShell 実行ポリシーの制約により、常に `firebase.cmd`（`firebase` ではない）を使う。

---

## 4. dev / prod で分けるもの・共通にするもの

| 項目 | 分離 | 内容 |
|---|---|---|
| Firebase プロジェクト | ✅ | 唯一分離する単位 |
| `firestore.rules` / `firestore.indexes.json` の内容 | ❌（共通） | 同一ファイルを両方の環境へデプロイする |
| Authentication のユーザー | ✅（自動） | プロジェクトごとに独立 |
| Firestore のデータ | ✅（自動） | dev はダミー、prod は実データのみ |
| Hosting URL | ✅ | 環境ごとに異なる |
| Firestore リージョン | ❌（方針統一） | 両方とも `asia-northeast1`（東京）。作成後変更不可のため prod 作成時に要注意 |
| Google Analytics | ❌（方針統一） | 両方とも無効 |
| App Check | 導入しない（現段階） | 過剰設計。実施設への本格展開が近づいた時点で再検討（TODO） |
| 初期データ | ✅ | dev は自由に投入。prod は実データを載せると決めた時点で初めて投入（現時点はスコープ外） |

---

## 5. 誤って prod へデプロイしないための運用

CI/CD・複雑なブランチ戦略は導入しない（1人開発の現段階では過剰）。

- ブランチは当面 `main` のみ。`develop` ブランチ等は作らない。複数人開発になった時点で再検討。
- `npm run deploy:dev` / `npm run deploy:prod` とコマンド自体を分け、`--project` を毎回明示する。
- **Claude Code（本アシスタント）が `--project prod` を伴う操作（デプロイ等）を行う際は、実行前に毎回ユーザーへ確認する**
  （`git push` と同じ扱い）。dev への操作は都度の確認なしで進める。

---

## 6. 今後の変更履歴

| 日付 | 変更 |
|---|---|
| 2026-09-11 | 方針策定・確定 |
| 2026-09-24 | 本番（prod）への初回デプロイを実施（ユーザー承認済み）。開発環境で作り込んだ実データは「施設データの引っ越し」機能（remaining-work-design.md §12）で施設ごとに移す方針に決定。§4 の「prod は実データを載せると決めた時点で初めて投入」の時点に到達 |
