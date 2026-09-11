# kaigo-shift-saas

介護施設向けシフト作成・勤務表管理アプリの **SaaS版プロトタイプ**。

法人内で将来的に複数施設へ横展開することを見据え、
Firebase（Firestore + Authentication + Hosting）を使ったサーバー型構成で再構築中。

- 既存の単一HTML版（localStorage 保存）は本プロジェクトとは別に運用継続する。
  本プロジェクトはその置き換えではなく、横展開に向けたプロトタイプ。

## 技術構成

| 項目 | 採用 |
|---|---|
| ビルド / 言語 | Vite + React + TypeScript |
| バックエンド | Firebase Firestore / Authentication（メール・パスワード）/ Hosting |
| プラン | Spark（無料枠） |
| バージョン管理 | Git + GitHub（Jabberwock-8/kaigo-shift-saas, private） |

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/firestore-design.md](docs/firestore-design.md) | データ構造・権限設計・生成ロジックの設計（設計の source of truth） |
| [docs/legacy-html-analysis.md](docs/legacy-html-analysis.md) | 旧HTML版の機能・データ構造・生成アルゴリズムの分析 |
| [docs/environment-strategy.md](docs/environment-strategy.md) | dev / prod 環境分離の方針 |
| [docs/feature-parity.md](docs/feature-parity.md) | 旧HTML版との機能対応表。各フェーズ完了時に更新し、実装漏れが無いかを確認する |

## 開発の進め方（フェーズ）

- **Phase 0**: プロジェクト骨格（Vite + Firebase 接続 + Hosting 公開 + 初回 push） ✅
- **Phase 1**: ログイン → 施設選択 → 職員一覧表示 ✅
- **Phase 2**: 職員・勤務パターン・職種・雇用区分のマスタ管理 ✅
- **Phase 3**: 月間シフトの表示・手修正(3a ✅) / 希望休(3b ✅) / 印刷(3c ✅)
- **Phase 4 以降**: 相性・条件ルール、自動シフト生成、Excel入出力・TimePro-VG連携の移植

進捗の詳細は [docs/feature-parity.md](docs/feature-parity.md) を参照。
