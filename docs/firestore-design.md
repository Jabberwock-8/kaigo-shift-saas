# 介護シフト作成アプリ（SaaS版プロトタイプ）Firestore 設計書

作成日: 2026-09-10 / 更新日: 2026-09-10（**rev.3**）/ 対象: Phase 0（設計確認）
関連資料: `docs/legacy-html-analysis.md`（旧HTML版の機能・ロジック分析）

---

## 0. 前提

- 用途: 介護施設向けの**シフト作成・勤務表管理**アプリ。
- 扱わないもの: 利用者管理、介護記録、医療情報、利用者個人情報。
- 扱うもの: ログインユーザー / 法人・施設 / 職員 / 職種 / 雇用区分 / 勤務パターン /
  職員ごとの勤務可能条件 / 希望休・勤務希望 / 月間シフト / 制約条件 / 必要人数・必要職種 /
  相性 / 行事予定 / 勤怠連携（TimePro-VG）。
- 将来: 自動シフト作成機能を追加予定。後から拡張しやすい構造にする。
- いまは 1法人・1施設。ただし施設を増やしたら自然に分離される形にする。
- 旧HTML版（動作実績あり）の業務ロジックを継承する。詳細は `legacy-html-analysis.md`。

### ⚠️ サンプルデータについて（重要・rev.2 から継続）

本書の **法人名・施設名・職員名・氏名カナ・勤務時間・勤務パターンの内容・各種の上限値や
必要人数・スコア係数の数値は、すべて構造を説明するためのサンプル（架空データ／初期基準値）** です。

- 実データとして固定しません。実際の値は運用開始時に管理者が画面から登録します。
- 以下は **法令・施設規則として確定した値ではなく、仮のサンプル／初期基準値** です:
  `maxConsecutiveWorkdays` / `minRestHours` / `maxNightShiftsPerMonth` / `nightShiftTarget` /
  `targetWorkdaysPerMonth` / `maxWorkdaysPerMonth` / `staffing 系の必要人数` /
  `generationConfig` のプロファイル重み・スコア係数。
- これらは **初期状態では未設定（null／空）**、または **調整可能な設定値／定数** として扱います。

### rev.3 の主な変更点

1. `settings/shiftRules` に旧 `meta` 由来の項目を正式追加。
2. `compatibilities`（相性）を正式コレクション化（rev.2 では「将来」扱い）。
3. `rules`（条件ビルダー）の `days/target/cond` 語彙を確定（`legacy-html-analysis.md` §4）。
4. `schedules/{ym}` に `events`（行事）・`monthlyMaxDaysOverride` を追加。
5. `settings/timeproExport`（TimePro-VG 変換表）を追加。
6. `staff.workConditions` に `traits[]` を追加。
7. **`maxDaysPerMonth` を「必要勤務日数」と「最大勤務日数」に分離** →
   `targetWorkdaysPerMonth` / `maxWorkdaysPerMonth`。
8. **`nightShiftTarget`（夜勤回数の目標値）と `maxNightShiftsPerMonth`（上限）を別フィールドに分離**。
9. 固定休み曜日・許可勤務などの職員条件は、**生成エンジン内部で「内部ルール集合」に正規化**して扱う
   （Firestore には職員条件として保存。ルール化は実行時のみ、原則永続化しない）。
10. Excel 取込を **1施設スコープ ＋ バッチ書き込み ＋ 差分プレビュー** に再設計
    （旧版の「全データ丸ごと置換」を廃止）。
11. シフト生成ロジックを **UI 非依存の純関数モジュール**（`src/domain/scheduler/`）として分離。
12. 生成の **プロファイル重み・スコア係数・エンジンパラメータ**を `settings/generationConfig` ＋
    バージョン管理された既定値（`src/domain/scheduler/defaults.ts`）で **調整可能** にする。
    旧版の数値は「初期基準」であって業務ルールではない。

---

## 1. コレクション構成

```
organizations/{organizationId}          … 法人
facilities/{facilityId}                  … 施設（organizationId フィールドで法人に紐づく）
users/{uid}                              … ログインユーザー（Firebase Auth の uid がドキュメントID）

facilities/{facilityId}/
    jobTypes/{jobTypeId}                 … 職種マスタ
    employmentTypes/{employmentTypeId}   … 雇用区分マスタ
    shiftPatterns/{patternId}            … 勤務パターン（旧「勤務記号」）
    staff/{staffId}                      … 職員（シフト作成に必要な範囲のみ）
    compatibilities/{pairId}             … 職員相性（普通=保存しない）
    rules/{ruleId}                       … 条件（必須/推奨ルール。ビルダーで作成）
    leaveRequests/{requestId}            … 希望休・勤務希望
    schedules/{yearMonth}                … 月間シフト（ドキュメントID = "2026-04"）
        candidates/{candidateId}         … 自動生成の複数案（採択前の比較用）
    settings/shiftRules                  … 全体制約（夜勤運用・連続上限・休息時間 等）1件固定
    settings/timeproExport               … TimePro-VG 変換表 1件固定
    settings/generationConfig            … 生成の重み・係数・エンジン設定 1件固定（任意）
```

- **rev.2 の `settings/staffingRequirements` は廃止**。必要人数は `rules`（`target:shift` ＋
  `cond:atLeast/exact`）で表現する（旧版 `demandFor` と同じ考え方）。曜日別マトリクスの入力 UI は、
  保存時に複数の `rules` ドキュメントへ展開する。
- トップレベル（`organizations` / `facilities` / `users`）はログイン直後の参照用。
- 施設サブコレクション方式により Security Rules で「その施設の所属者だけ」を一括で守れる。

---

## 2. 各コレクションの役割

| コレクション | 役割 | 1件の単位 |
|---|---|---|
| organizations | 法人。将来の法人横断管理の起点 | 1法人 |
| facilities | 施設（棟・ユニット単位でも可） | 1施設 |
| users | ログインアカウントと権限・所属 | 1ユーザー |
| jobTypes | 職種の選択肢 | 1職種 |
| employmentTypes | 雇用区分の選択肢（必要勤務日数の下限を持つか等の属性） | 1区分 |
| shiftPatterns | 勤務区分の定義（記号・時間・夜勤か・勤務日カウントか） | 1パターン |
| staff | 職員。シフト作成に必要な条件を保持 | 1職員 |
| compatibilities | 職員ペアの相性（◎/△/×） | 1ペア |
| rules | 必須/推奨の条件（対象日 × 対象 × 条件） | 1ルール |
| leaveRequests | 職員が出す希望休・勤務希望 | 1職員1日1件 |
| schedules | ある月の全職員×全日の割り当て・ロック・行事・月別上限上書き | 1施設1ヶ月 |
| schedules/*/candidates | 自動生成された案（スコア・違反付き） | 1案 |
| settings/shiftRules | シフト全体の制約 | 施設に1件 |
| settings/timeproExport | 勤務パターン → TimePro-VG 表記の対応表 | 施設に1件 |
| settings/generationConfig | 生成のプロファイル重み・スコア係数・エンジン設定 | 施設に1件（任意） |

### 設計メモ
- schedules は「1施設1ヶ月＝1ドキュメント」（当面）。同時編集リスクは §7。
- マスタ（職種・雇用区分・勤務パターン・ルール）のドキュメントIDは Firestore 自動ID または英字スラッグ。
  **`schedules.assignments` の値は必ず `patternId`**（旧版の記号文字列ではなく）。
- 生成の候補（`candidates`）は旧版では永続化していなかったが、新版では比較・監査のため保存する。

---

## 3. users/{uid} データ例

> ★ 値（メール・氏名・ID文字列）はすべてサンプル。

```json
// users/AbC123xyz...  管理者
{
  "email": "admin@example.com",
  "displayName": "サンプル 管理者",
  "organizationId": "org_sample",
  "facilityIds": ["fac_sample_a"],
  "primaryFacilityId": "fac_sample_a",
  "role": "admin",
  "linkedStaffId": null,
  "createdAt": "2026-09-10T00:00:00Z"
}
```
```json
// users/DeF456uvw...  一般職員
{
  "email": "staff01@example.com",
  "displayName": "サンプル 職員01",
  "organizationId": "org_sample",
  "facilityIds": ["fac_sample_a"],
  "primaryFacilityId": "fac_sample_a",
  "role": "staff",
  "linkedStaffId": "staff_sample_01",
  "createdAt": "2026-09-10T00:00:00Z"
}
```

| フィールド | 意味 |
|---|---|
| organizationId | 所属法人（1つ） |
| facilityIds | 所属施設の一覧（配列）。当面1個。将来「複数施設の管理者」に対応 |
| primaryFacilityId | ログイン後に最初に開く施設 |
| role | "admin" または "staff"（§6 で採否比較。案A採用） |
| linkedStaffId | このアカウントが職員でもある場合 staff ドキュメントID。管理者専任なら null |

---

## 4. 主要コレクションのデータ例

> ★ 施設名・職員名・時刻・パターン内容・数値はすべてサンプル（架空／初期基準）。

### facilities
```json
// facilities/fac_sample_a
{
  "organizationId": "org_sample",
  "name": "サンプル介護施設A",
  "shortName": "施設A",
  "timezone": "Asia/Tokyo",
  "createdAt": "2026-09-10T00:00:00Z"
}
```

### jobTypes / employmentTypes
```json
// facilities/fac_sample_a/jobTypes/care
{ "label": "介護", "shortLabel": "介", "order": 1, "color": "#4C6EF5" }

// facilities/fac_sample_a/employmentTypes/fulltime
{ "label": "常勤", "order": 1, "hasTargetWorkdays": true }
// .../employmentTypes/parttime
{ "label": "非常勤", "order": 2, "hasTargetWorkdays": false }
// .../employmentTypes/nightonly
{ "label": "夜勤専従", "order": 3, "hasTargetWorkdays": false }
```
- `hasTargetWorkdays: true` の区分は「必要勤務日数（下限）」を持つ（旧版の「常勤は要出勤」を一般化）。

### shiftPatterns（旧「勤務記号」）
```json
// facilities/fac_sample_a/shiftPatterns/day  — 値はすべてサンプル
{
  "code": "日",                  // 旧 symbol（表示用の短い記号）
  "label": "日勤",                // 旧 name
  "startTime": "09:00",
  "endTime": "18:00",
  "breakMinutes": 60,
  "workMinutes": 480,
  "category": "day",             // day | early | late | night | afterNight | off | paidLeave | individual
  "isWork": true,                // 旧 isWork（勤務としてカウント）
  "isNight": false,              // 旧 isNight
  "isSystem": false,             // 旧 fixed（「明」「公休」「有給」等のシステム固定）
  "order": 1,
  "color": "#E7F5FF",
  "textColor": "#0C4A3B"
}
```
```json
// shiftPatterns/night
{ "code":"夜","label":"夜勤","startTime":"21:00","endTime":"07:00","category":"night",
  "isWork":true,"isNight":true,"isSystem":false,"order":4,"color":"#E6F1FB","textColor":"#0C447C" }

// shiftPatterns/afterNight（システム固定）
{ "code":"明","label":"夜勤明け","category":"afterNight",
  "isWork":false,"isNight":false,"isSystem":true,"order":5,"color":"#EDF2FF" }

// shiftPatterns/off（システム固定）
{ "code":"公","label":"公休","category":"off",
  "isWork":false,"isNight":false,"isSystem":true,"order":9,"color":"#F1F3F5" }

// shiftPatterns/paidLeave（システム固定）
{ "code":"有","label":"有給","category":"paidLeave",
  "isWork":false,"isNight":false,"isSystem":true,"order":10,"color":"#FBF6DE" }
```

### staff（シフト作成に必要な範囲のみ）
```json
// facilities/fac_sample_a/staff/staff_sample_01 — 値はすべてサンプル
{
  "name": "サンプル 職員01",
  "nameKana": "サンプル ショクイン01",
  "jobTypeId": "care",
  "employmentTypeId": "fulltime",
  "facilityId": "fac_sample_a",
  "active": true,
  "order": 1,

  "qualifications": ["介福"],       // ルールが参照（資格ターゲット）
  "traits": [],                     // ルールが参照（特性タグ／タグのペア）※rev.3で追加

  "workConditions": {
    "workablePatternIds": ["day", "early", "late", "night"],
    "ngPatternIds": [],

    "nightShiftAllowed": true,
    "nightShiftTarget": null,         // ★夜勤回数の「目標値」。未設定=目標なし。上限ではない
    "maxNightShiftsPerMonth": null,   // ★夜勤回数の「上限」。nightShiftTarget とは別物

    "targetWorkdaysPerMonth": null,   // ★必要勤務日数（下限）。未設定=区分/施設既定に従う
    "maxWorkdaysPerMonth": null,      // ★最大勤務日数（上限）。未設定=区分/施設既定/上限なし

    "maxConsecutiveWorkdays": null,   // 未設定=施設既定に従う

    "fixedOffWeekdays": [],           // 固定休み曜日 0=日..6=土（生成時にルールへ正規化）
    "workableTimeRange": { "start": null, "end": null },
    "notes": ""
  },

  "createdAt": "2026-09-10T00:00:00Z",
  "updatedAt": "2026-09-10T00:00:00Z"
}
```

**保存しないもの**: 住所・電話番号・マイナンバー・給与・医療/健康情報・利用者に関する情報。

#### 4-1. 「必要勤務日数」と「最大勤務日数」の分離（rev.3 整理事項 1）

旧版の `maxDaysPerMonth` は、常勤では **「この日数を働く必要がある（下限）」と「これ以上は働かせない（上限）」の
両方**を兼ねていた。新版では明確に2つに分ける。

| 新フィールド | 意味 | 生成エンジンでの扱い |
|---|---|---|
| `targetWorkdaysPerMonth` | その月に**入るべき**勤務日数（下限） | 未達なら hard 違反「要出勤」。`fillMinimumWorkdays` の目標値 |
| `maxWorkdaysPerMonth` | その月に**入ってよい**勤務日数（上限） | 超過なら hard 違反。`canWork` の打ち切り条件 |

- 値の解決順（未設定なら次へフォールバック）:
  1. `schedules/{ym}.monthlyMaxDaysOverride[staffId]`（その月だけの上書き）
  2. `staff.workConditions.targetWorkdaysPerMonth` / `maxWorkdaysPerMonth`
  3. `settings/shiftRules.monthlyLimitsDefault.targetWorkdays` / `maxWorkdays`
  4. `target` は「下限なし」、`max` は「上限なし」
- `employmentTypes.hasTargetWorkdays === false` の区分は `target` を評価しない（下限チェックをスキップ）。
- 通常、常勤は `target === max` になることが多いが、月の公休数の違いや調整で
  `target < max`（多少の融通を許容）にもできる。

#### 4-2. `nightShiftTarget` と `maxNightShiftsPerMonth`（rev.3 整理事項 2）

| フィールド | 意味 | 生成エンジンでの扱い |
|---|---|---|
| `nightShiftTarget` | 夜勤回数の**目標値**（多くも少なくもこの回数に近づけたい） | スコア `fair` の「目標との乖離（二乗）」で評価。夜勤割当の優先度計算にも使用。**違反にはしない** |
| `maxNightShiftsPerMonth` | 夜勤回数の**上限** | 超過は hard 違反。`canWork` の打ち切り条件 |

- 旧版は `nightShiftTarget` のみを持ち、超過を「danger 表示」していたが hard 違反ではなかった。
  新版でも target は目標のまま。上限を課したい施設は `maxNightShiftsPerMonth` を別途設定する。
- 夜勤目標対比パネル（実績 n / 目標 m）は旧版どおり継承。

### compatibilities（相性）
```json
// facilities/fac_sample_a/compatibilities/{pairId}
// pairId = 2つの staffId を昇順で連結（例 "staff_sample_01__staff_sample_07"）
{
  "staffIdA": "staff_sample_01",
  "staffIdB": "staff_sample_07",
  "level": "x",                 // "double"（◎良）| "caution"（△注意）| "x"（同一シフト不可）
  "weight": null,               // 任意の数値上書き。null なら generationConfig の係数から導出
  "note": ""
}
```
- 「普通（○ / good）」は**保存しない**（存在しない＝普通）。旧版と同じ。
- `settings/shiftRules.treatCompatibilityXAsHard === true` のとき、`x` ペアの同一シフト同席を hard 違反にする。

### rules（条件ビルダー）
```json
// facilities/fac_sample_a/rules/{ruleId} — 値はサンプル
{
  "enabled": true,
  "kind": "hard",               // "hard"（必須）| "soft"（推奨）
  "days":   { "type": "dow", "values": [0, 3] },   // all|weekdays|weekend|dow|dates
  "target": { "type": "shift", "value": "night" }, // shift|qualification|trait|staff|traitPair|shiftGroup
  "cond":   { "type": "exact", "count": 1 },       // 下表参照
  "order": 1,
  "createdAt": "2026-09-10T00:00:00Z",
  "updatedAt": "2026-09-10T00:00:00Z"
}
```

| 区分 | `type` の値 | 補足フィールド |
|---|---|---|
| `days.type` | `all` / `weekdays` / `weekend` / `dow` / `dates` | `dow`→`values:[0..6]` / `dates`→`values:["YYYY-MM-DD"]` |
| `target.type` | `shift` / `qualification` / `trait` / `staff` / `traitPair` / `shiftGroup` | `value`（対象ID/名称）、`traitPair`→`value`+`value2`、`shiftGroup`→`value:[patternId,...]` |
| `cond.type` | `exact` / `atLeast` / `atMost` / `none` / `work` / `off` / `together` / `notTogether` / `atLeastGroup` / `notTogetherGroup` / `preferShift` | 人数系→`count`、`preferShift`→`value:patternId` |

- **必要人数**は `target:shift` ＋ `cond:exact|atLeast` の hard ルールから導出（旧版 `demandFor` と同じ）。
- ルール文面の日本語化（旧版 `ruleText`）はフロント側で行う。

### leaveRequests（希望休・勤務希望）
```json
// facilities/fac_sample_a/leaveRequests/{requestId}
{
  "staffId": "staff_sample_01",
  "yearMonth": "2026-04",
  "date": "2026-04-12",
  "type": "希望休",              // 希望休 | 有給希望 | 勤務希望
  "desiredPatternId": null,      // type=勤務希望 のとき patternId
  "priority": "must",            // must（絶対）| want（できれば）
  "status": "pending",           // pending | approved | rejected
  "createdByUid": "DeF456uvw...",
  "createdAt": "2026-03-20T10:00:00Z"
}
```
- `staffId` / `createdByUid` / `yearMonth` / `date` は作成後に変更不可（§8 ルール）。
- `status` を approved / rejected にできるのは admin のみ。
- 生成エンジンは「`status==approved` または `priority==must`」を、指定月（`yearMonth` 一致）で
  一括取得して入力にする。

### schedules（月間シフト）
```json
// facilities/fac_sample_a/schedules/2026-04 — 内容はサンプル
{
  "yearMonth": "2026-04",
  "daysInMonth": 30,
  "status": "draft",             // draft | confirmed | archived

  "assignments": {               // 旧 schedules[ym].adopted
    "staff_sample_01": { "1": "day", "2": "off", "3": "night", "4": "afterNight", "5": "off" },
    "staff_sample_02": { "1": "night", "2": "afterNight", "3": "off" }
  },
  "locks": {                     // 旧 schedules[ym].locks（再生成・修復で固定）
    "staff_sample_01": { "4": true }
  },
  "events": {                    // ★rev.3追加。旧 S.events（日→行事名）を月内に格納
    "15": "サンプル行事"
  },
  "monthlyMaxDaysOverride": {    // ★rev.3追加。旧 S.monthlyMaxDays[ym]
    "staff_sample_01": { "targetWorkdays": 20, "maxWorkdays": 20 }
  },

  "generationMeta": {
    "source": "manual",          // manual | auto
    "candidateId": null,         // auto のとき採択した candidates ドキュメントID
    "generationConfigSnapshot": null,  // 生成時に使った重み・係数のスナップショット
    "generatedAt": null
  },
  "revision": 1,                 // 楽観ロック用（§7）
  "createdByUid": "AbC123xyz...",
  "updatedByUid": "AbC123xyz...",
  "updatedAt": "2026-09-10T00:00:00Z",
  "confirmedAt": null
}
```

### schedules/{ym}/candidates（自動生成の案）
```json
// facilities/fac_sample_a/schedules/2026-04/candidates/{candidateId}
{
  "profileKey": "fairness",
  "label": "案A 公平性重視",
  "weights": { "fair": 40, "comp": 20, "wish": 25, "soft": 15, "interval": 15, "spread": 15 },
  "assignments": { "staff_sample_01": { "1": "day" } },
  "scores": { "fair": 82, "comp": 61, "wish": 100, "soft": 90, "interval": 95, "spread": 88, "total": 84 },
  "hardCount": 0,
  "softCount": 3,
  "hardViolations": [],
  "softViolations": ["4/12〜13 サンプル 職員01: 休息時間が9時間"],
  "fulfillmentRate": 98,
  "generatedAt": "2026-09-10T00:00:00Z"
}
```

### settings/shiftRules（施設ごとに設定・初期は未作成）
```json
// facilities/fac_sample_a/settings/shiftRules
//
// ★ 初期状態ではこのドキュメントを作らない（＝すべて未設定＝制約なし）。
//   数値はサンプル／初期基準であり、法令・施設規則として確定したものではない。
{
  "nightMode": null,                       // "ake"（夜→明→休）| "direct"（夜→公休）
  "nightAvoidPatternIdsAfter2": [],        // direct時、夜勤の2日後に避ける patternId。例(サンプル):["early"]
  "shiftConsecutiveCaps": {},              // { patternId: number } 例(サンプル): { "late": 2 }
  "minRestHours": null,                    // 例(サンプル): 11。勤務間インターバル（推奨＝ソフト）
  "preferredFillTimeRange": { "start": null, "end": null },  // 不足補充で優先する時間帯。例:"08:30"-"17:30"
  "treatCompatibilityXAsHard": null,       // 旧 meta.compHard。例(サンプル): true

  "maxConsecutiveWorkdaysDefault": null,   // 例(サンプル): 5
  "monthlyLimitsDefault": {
    "targetWorkdays": null,                // 例(サンプル): 21（hasTargetWorkdays 区分にのみ適用）
    "maxWorkdays": null,                   // 例(サンプル): 21
    "maxNightShifts": null                 // 例(サンプル): 4（上限。目標ではない）
  },
  "weekend": { "saturdayIsHoliday": null, "sundayIsHoliday": null }
}
```

### settings/timeproExport（TimePro-VG 変換表・初期は未作成）
```json
// facilities/fac_sample_a/settings/timeproExport
{
  "patternMap": {
    "day":   { "kotai": "",   "shift": "日:0900-1800" },
    "night": { "kotai": "",   "shift": "夜:2100-0700" },
    "off":   { "kotai": "公休", "shift": "" },
    "paidLeave": { "kotai": "有給", "shift": "" }
  }
}
```
- 旧版どおり、職員別に「勤怠区分」列・「シフト区分」列を1ヶ月分クリップボードへコピーする機能の対応表。

### settings/generationConfig（生成の調整値・初期は未作成 → 既定値を使用）
```json
// facilities/fac_sample_a/settings/generationConfig
//
// ★ 初期状態では未作成。未作成なら src/domain/scheduler/defaults.ts の既定値（＝旧版由来の初期基準）を使う。
//   ここにある数値は「調整可能なパラメータ」であって業務ルールではない。
{
  "profiles": [
    { "key": "fairness", "label": "案A 公平性重視", "weights": { "fair": 40, "comp": 20, "wish": 25, "soft": 15, "interval": 15, "spread": 15 } },
    { "key": "compat",   "label": "案B 相性重視",   "weights": { "fair": 20, "comp": 40, "wish": 25, "soft": 15, "interval": 15, "spread": 15 } },
    { "key": "leave",    "label": "案C 希望休優先", "weights": { "fair": 20, "comp": 15, "wish": 50, "soft": 15, "interval": 15, "spread": 15 } }
  ],
  "scoreCoefficients": {
    "fair":     { "workdaySd": 10, "nightTargetDev": 12, "weekendSd": 8, "typeFairDev": 7 },
    "compat":   { "double": 2, "caution": -2, "x": -6 },
    "interval": { "penaltyPerHour": 18 },
    "spread":   { "overallWeight": 0.5, "typeWeight": 0.5, "overallK": 60, "typeK": 35 }
  },
  "engine": { "hillClimbMs": 800, "repairMaxIter": 400 }
}
```

#### 4-3. 生成の数値を固定しない（rev.3 整理事項 3）

- **継承するもの（考え方）**: 6指標（`fair` 公平 / `comp` 相性 / `wish` 希望休 / `soft` 推奨 /
  `interval` 休息 / `spread` 偏り）、3案比較 → プレビュー → 採択、生成パイプライン
  （seed → 夜勤 → 日中 → 必要出勤補充 → repair → hillClimb → 再repair → 採点）。
- **固定しないもの（数値）**: プロファイル重み、スコア係数、エンジンの試行時間・反復回数。
- 既定値は `src/domain/scheduler/defaults.ts` に **バージョン付きの定数**として置く
  （旧版の値を `v1` として記録）。施設は `settings/generationConfig` で上書きできる。
- 採用時は `schedules.generationMeta.generationConfigSnapshot` に「そのとき使った値」を保存して
  再現性を確保する。

---

## 5. 権限設計（admin / staff）

| 対象データ | admin | staff |
|---|---|---|
| 自施設の facility 情報 | 読み取り／編集 | 読み取り |
| jobTypes / employmentTypes / shiftPatterns / rules / compatibilities | 読み取り／編集 | 読み取り |
| staff（職員一覧） | 読み取り／編集 | 読み取り |
| settings/*（shiftRules / timeproExport / generationConfig） | 読み取り／編集 | 読み取り |
| schedules（月間シフト・candidates） | 読み取り／編集 | 読み取り |
| leaveRequests（希望休） | 全件 読み取り／編集／**承認・却下** | **自分の分のみ** 作成／読み取り／pending の間だけ内容編集・取消。**承認・却下は不可** |
| users（アカウント） | 同一法人内を読み取り | 自分の1件のみ |
| 他施設の一切のデータ | 不可 | 不可 |

- 所属外の施設は admin でも不可（`facilityIds` に入っている施設のみ）。
- Phase 0〜1 は users / organizations / facilities の新規作成をコンソール手作業にし、アプリからの書き込みは禁止。

---

## 6. 権限モデルの比較 — `role + facilityIds` vs `facilityRoles`（rev.2 から継続・結論変更なし）

### 結論：**案A（`role` + `facilityIds`）を採用**（過剰設計を避ける）

- いま必要なのは「1ユーザー＝1施設＝1役割」だけ。`facilityRoles` マップの柔軟性は当面 100% 未使用。
- 各 Security Rules の match ブロックを **ヘルパー関数（`inFacility(fid)` / `isAdmin(fid)`）の呼び出しだけ**に
  統一しておき、将来の移行はヘルパーの中身の差し替えで完結させる。
- 「施設Aは管理者・施設Bは一般職員」が必要になった時点で案B（または中間案 `facilityRoleOverrides`）へ移行。

（メリット・デメリット詳細は rev.2 の同節を参照。判断は変更なし。）

---

## 7. 月間シフト「1施設1ヶ月＝1ドキュメント」— 同時編集の注意事項（rev.2 から継続）

### リスク
- Firestore の書き込みはドキュメント単位で上書き。管理者Xと管理者Yが同じ月をほぼ同時に保存すると、
  後勝ちでドキュメント全体が上書きされ、先の変更が消える（ロストアップデート）。

### 当面の緩和策（Phase 3 実装時）
1. **編集は原則1人**の運用ルール（プロトタイプ段階はこれで十分）。
2. `schedules.revision`（整数）＋ `updatedByUid` / `updatedAt`。保存時にトランザクションで
   「読み込んだ revision と一致する場合のみ +1」。不一致なら「他の人が更新しました。再読み込みを」と表示（楽観的ロック）。
3. 保存を `assignments.<staffId>.<day>` の部分更新（ドット記法）にして衝突面積を減らす。

### 本格的な同時編集が必要になった場合（設計変更を伴う）
- `schedules/{ym}/assignments/{staffId}` をサブコレクション化し職員単位で書き込みを分離。
- さらに細かくするなら日単位。読み取りコストとのトレードオフ。移行はデータ移行スクリプト＋読み書き層の差し替え。

---

## 8. Security Rules の考え方（rev.2 から継続・対象コレクション追加）

基本: 明示的に許可したものだけ通す。デフォルト拒否。各 match はヘルパー関数呼び出しだけにする。

```
function signedIn()       { return request.auth != null; }
function me()             { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
function inFacility(fid)  { return signedIn() && (fid in me().facilityIds); }
function isAdmin(fid)     { return inFacility(fid) && me().role == 'admin'; }
function myStaffId()      { return me().linkedStaffId; }
function leaveImmutableKept() {
  return request.resource.data.staffId      == resource.data.staffId
      && request.resource.data.createdByUid == resource.data.createdByUid
      && request.resource.data.yearMonth    == resource.data.yearMonth
      && request.resource.data.date         == resource.data.date;
}
```

```
match /organizations/{orgId} {
  allow read:  if signedIn() && me().organizationId == orgId;
  allow write: if false;                         // 当面コンソール管理
}

match /facilities/{fid} {
  allow read:   if inFacility(fid);
  allow update: if isAdmin(fid);
  allow create, delete: if false;

  match /jobTypes/{id}        { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  match /employmentTypes/{id} { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  match /shiftPatterns/{id}   { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  match /rules/{id}           { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  match /compatibilities/{id} { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  match /settings/{id}        { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  match /staff/{staffId}      { allow read: if inFacility(fid); allow write: if isAdmin(fid); }

  match /schedules/{ym} {
    allow read:  if inFacility(fid);
    allow write: if isAdmin(fid);
    match /candidates/{cid} { allow read: if inFacility(fid); allow write: if isAdmin(fid); }
  }

  match /leaveRequests/{reqId} {
    allow read: if isAdmin(fid)
                || (inFacility(fid) && resource.data.staffId == myStaffId());
    allow create: if inFacility(fid)
                && request.resource.data.staffId      == myStaffId()
                && request.resource.data.createdByUid == request.auth.uid
                && request.resource.data.status       == 'pending';
    allow update: if isAdmin(fid) && leaveImmutableKept();
    allow update: if inFacility(fid)
                && resource.data.staffId       == myStaffId()
                && resource.data.status        == 'pending'
                && request.resource.data.status == 'pending'
                && leaveImmutableKept();
    allow delete: if isAdmin(fid)
                || (inFacility(fid) && resource.data.staffId == myStaffId()
                    && resource.data.status == 'pending');
  }
}

match /users/{uid} {
  allow read:  if signedIn() && (request.auth.uid == uid
               || (me().role == 'admin' && me().organizationId == resource.data.organizationId));
  allow write: if false;                          // 当面コンソール管理
}
```

### ポイント
- 「ログインしただけ」では何も見えない。`users/{uid}.facilityIds` に一致した施設だけ。
- 管理者/職員の差は `isAdmin(fid)` で判定。画面の出し分けだけでなくここで実データを守る。
- leaveRequests: 一般職員は `staffId` / `createdByUid` / `yearMonth` / `date` 変更不可、
  `status` の approved / rejected 変更不可。承認・却下は admin のみ。
- `get()` は1回1読み取り。この規模なら問題なし。将来は Auth カスタムクレームへ（変えるのはヘルパーの中身だけ）。

---

## 9. シフト生成ロジックのモジュール分離（rev.3・整理事項 3 と関連）

**方針**: 生成ロジックは React / Firestore に依存しない**純関数モジュール**として実装する。
入力は「プレーンなオブジェクト」、出力は「候補の配列」。UI もサーバー（将来の Cloud Functions）も
同じモジュールを呼ぶ。

```
src/domain/scheduler/
  index.ts          // generate(input: GenerateInput): Candidate[]
  types.ts          // GenerateInput / Candidate / InternalRule など
  defaults.ts       // 旧版由来の初期係数（v1 として凍結。generationConfig 未設定時に使用）
  normalizeRules.ts // staff条件 + settings + rules → 内部ルール集合（固定休/許可勤務/連続/上限 を統一表現）
  demand.ts         // 内部ルールから日次の必要人数を算出（旧 demandFor）
  check.ts          // 月全体の違反抽出（旧 checkMonth）→ hard/soft, セル単位
  score.ts          // 6指標の採点（旧 scoreGrid）。係数は引数で受ける
  generateOne.ts    // seed→夜勤→日中→必要出勤補充→repair→hillClimb→再repair
  repair.ts         // 必要数不足の解消（1〜3手）＋ グループルール修復
  hillClimb.ts      // 時間制限つき局所改善
```

```ts
interface GenerateInput {
  yearMonth: string;
  daysInMonth: number;
  shiftPatterns: ShiftPattern[];
  staff: Staff[];                 // workConditions 含む
  rules: Rule[];                  // ユーザー作成ルールのみ
  compatibilities: Compatibility[];
  shiftRules: ShiftRulesSettings; // settings/shiftRules（未設定は null 埋め）
  leaveRequests: LeaveRequest[];  // 当月の approved / must
  lockedCells: Record<string, Record<number, string>>;
  baseAssignments: Record<string, Record<number, string>>; // ロック引き継ぎ元
  config: GenerationConfig;       // settings/generationConfig or defaults
}
```

- **固定休み曜日・許可勤務・連続上限・月間上限・夜勤ブロック**などの職員条件は、
  `normalizeRules.ts` が**実行時に内部ルール集合へ変換**する。Firestore には職員条件のまま保存し、
  正規化結果は原則永続化しない（監査したい場合のみ candidate に添付）。
- 生成は当面ブラウザ内で実行（全データがメモリに載る規模）。将来 Cloud Functions（Blaze 必須）へ
  移す場合も、この `src/domain/scheduler/` をそのまま Functions 側から呼べるようにする。

---

## 10. Excel 取込の再設計（rev.3）

旧版は「テンプレートを読む → 確認 → `S` を丸ごと差し替え」。単一 localStorage 前提の実装。
新版は**施設スコープ ＋ 差分適用 ＋ バッチ書き込み**にする。

### 流れ
1. **対象施設を選択**（ログイン中の施設に固定）。他施設には一切書き込まない。
2. `.xlsx` をブラウザで読む（SheetJS はバンドルに同梱。外部CDN不可）。
3. `parseTemplate.ts` がシート（施設情報 / 勤務記号 / 職員 / 条件 / 勤務実績（任意））を解釈し、
   `draft`（正規化済みオブジェクト）＋ `warnings[]` を返す。認識できない行はスキップして警告に積む（旧版踏襲）。
4. `diff.ts` が **現在の Firestore データと突き合わせ**、
   `新規 / 変更 / 削除 / 据え置き` に分類（勤務パターン・職員・ルールごと）。
5. **差分プレビュー画面**（`ReviewDialog.tsx`）で管理者が確認。
   - 「削除」は既定でオフ（明示的にチェックしたものだけ削除）。
   - 使用中の勤務パターン（`assignments` / `staff.workablePatternIds` / `rules` で参照）は削除不可警告。
6. 確定で `writeBatch` によるバッチ書き込み。1バッチ最大 500 操作の制限に合わせて分割し、
   途中失敗時のリカバリ方針（再実行で冪等になるよう doc ID を安定させる）を用意。
7. 取込結果（件数・警告・スキップ）を表示。

### テンプレート仕様
- シート構成は旧版を踏襲（`docs/excel-template-spec.md` に別紙化予定）。
- 職員シートの「月間勤務上限」列は、rev.3 の分離に合わせ **「必要勤務日数」「最大勤務日数」の2列**に変更
  （1列だけ入力された場合は両方に同値を入れる後方互換）。
- 「固定休み曜日」列は継続。取込時は `staff.workConditions.fixedOffWeekdays` に格納（旧版のようにルール化はしない）。

---

## 11. Phase 0 のファイル・フォルダ構成

Phase 0 のゴール: React+TS の空アプリ起動 → Firebase 接続 → GitHub push → Hosting 公開。UI はプレースホルダのみ。

```
kaigo-shift-saas/
├─ .gitignore
├─ .env.local                  … Firebase接続情報（Git対象外）
├─ .env.example                … 空テンプレ（Gitに入れる）
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ index.html
├─ firebase.json               … Hosting と Firestore の設定
├─ .firebaserc                 … 対象Firebaseプロジェクト名
├─ firestore.rules             … §8 のセキュリティルール
├─ firestore.indexes.json      … 複合インデックス（leaveRequests: yearMonth+status 等。最初は最小）
├─ README.md
├─ docs/
│   ├─ firestore-design.md         … この設計書
│   ├─ legacy-html-analysis.md     … 旧HTML版の分析
│   └─ excel-template-spec.md      … （後日）Excelテンプレート仕様
└─ src/
    ├─ main.tsx
    ├─ App.tsx                 … 仮画面（接続OK表示程度）
    ├─ index.css
    ├─ lib/
    │   └─ firebase.ts         … Firebase初期化（auth と db）
    ├─ types/
    │   └─ models.ts           … 全コレクションのTypeScript型（数値上限は number | null）
    └─ domain/
        └─ scheduler/          … §9。Phase 0 では空の骨組み（型と defaults のみ）
```

使うライブラリ（Phase 0）: vite / react / react-dom / typescript / firebase、CLI として firebase-tools（グローバル）。
Phase 1 で追加: react-router-dom。Phase 3〜4 で追加: xlsx（SheetJS、バンドル同梱）。
状態管理は当面 React 標準機能のみ。

---

## 12. Phase 1 の準備（設計確定後）

初期データはコンソールから手作業で用意（アプリにまだ作成画面がないため）。すべてサンプル値でよい。

1. Authentication で管理者のメール／パスワードを1件作成 → uid を控える
2. Firestore に organizations/{任意ID} を作成
3. facilities/{任意ID} を作成
4. users/{uid} を作成（role: "admin", facilityIds: ["その施設ID"]）
5. shiftPatterns を数件、staff を2〜3件入れて表示テスト
6. settings/* は作らない（未設定で動くことを確認）

---

## 13. 確認事項（rev.3）

- [x] コレクション構成・階層（施設サブコレクション方式）
- [x] role は当面 admin / staff の2つ（§6 案A）
- [x] 勤務パターンのドキュメントIDは英字、日本語は label
- [x] 月間シフトは「1施設1ヶ月＝1ドキュメント」当面採用（§7 に同時編集注意事項）
- [x] 旧HTML版の要素反映（shiftRules / compatibilities / rules / events / monthlyMaxDaysOverride /
      timeproExport / traits / nightShiftTarget / ルール正規化 / Excel差分取込 / scheduler モジュール分離）
- [x] `targetWorkdaysPerMonth` と `maxWorkdaysPerMonth` の分離（§4-1）
- [x] `nightShiftTarget`（目標）と `maxNightShiftsPerMonth`（上限）の分離（§4-2）
- [x] 生成の重み・係数を調整可能に（§4-3 / §9）
- [ ] リポジトリ名 `kaigo-shift-saas` / GitHub のユーザー名・組織名（Phase 0 の push に必要）

→ rev.3 で問題なければ設計確定。Phase 0（プロジェクトフォルダの場所決めから）へ進みます。
```
