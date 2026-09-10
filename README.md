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

## 開発の進め方（フェーズ）

- **Phase 0**: プロジェクト骨格（Vite + Firebase 接続 + Hosting 公開 + 初回 push） ← 現在
- **Phase 1**: ログイン → 施設選択 → 職員一覧表示
- **Phase 2**: 職員・勤務パターン・条件・相性のマスタ管理
- **Phase 3**: 月間シフトの表示・手修正・希望休・印刷
- **Phase 4 以降**: Excel 入出力・TimePro-VG 連携・自動シフト生成の移植
