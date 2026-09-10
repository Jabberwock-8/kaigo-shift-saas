# 旧HTML版プロトタイプ 分析資料

対象ファイル: `シフト自動作成_第二女性棟.html`（単一HTML / 約2,200行 / 約600KB）
作成日: 2026-09-10 / 位置づけ: 新 React+TS+Firebase 版の **機能要件・業務ロジックの参考資料**
（旧コードのそのまま移植はしない。データは localStorage → Firestore へ置換）

技術メモ:
- 依存は SheetJS（xlsx.js）をファイル内にインライン埋め込み（オフライン動作）。Excelテンプレートも base64 で内蔵。
- フレームワークなし。素の DOM 操作 + 文字列テンプレートで全画面を再描画。
- 状態はグローバル変数 `S`（`localStorage["shiftapp_v1"]` に丸ごと JSON 保存）と画面状態 `V`（非永続）。

---

## 1. 現在実装されている主要機能一覧

### 画面（左サイドバー6タブ）
| 画面 | 関数 | 主な機能 |
|---|---|---|
| シフト表 | `renderShift` / `buildTable` | 月表示・週表示切替、セルクリックで勤務変更、右クリックでセルロック、行事行の編集、勤務種別ごとの日次集計行（`◯/必要数` 不足は赤）、右端に個人別の種別回数サマリ、夜勤回数の目標対比パネル |
| 希望休 | `renderWishes` / `buildWishTable` | 職員×日のマトリクスをクリックで希望休 ON/OFF、月移動 |
| 職員 | `renderStaff` / `openStaffForm` | 職員カード一覧、追加・編集・削除。氏名/雇用形態/月間勤務上限/連続勤務上限/可能な勤務/資格/特性タグ/希望休/月間夜勤回数目標 |
| 相性 | `renderCompat` / `cycleCompat` | 職員×職員マトリクス。セルクリックで ○→◎→△→× を循環。「×ペアの同一シフト配置を禁止（必須扱い）」トグル |
| 条件 | `renderRules` / `addRule` | ルールビルダー（対象日 × 対象 × 条件 × 必須/推奨）。固定ルールの説明表示、登録済みルールの有効/無効・削除 |
| 設定 | `renderSettings` | 施設名、勤務記号マスタ編集、夜勤運用ルール、最低休息時間、不足補充の優先時間帯、シフト別連続日数上限、Excel展開、JSON入出力、全データ初期化 |

### シフト表まわりの機能詳細
- **自動生成**: 「パターン生成」で 3 案（公平性重視 / 相性重視 / 希望休優先）を生成し横並び比較。各案に充足率・総合スコア・6指標スコア・必須違反件数を表示、「おすすめ」バッジ。プレビュー（表に仮反映）→「採択」で確定。
- **手修正**: セルクリックでその職員が可能な勤務記号のポップオーバー → 選択。「クリア」「ロック切替」。
- **セルロック**: ロックしたセルは再生成・修復・山登りで固定。夜勤を手入力すると翌日（+翌々日）を自動セット（ロック尊重）。
- **違反表示**: `checkMonth` の結果でセル左上に `!`、ツールチップに理由。希望休セルは金枠（守れている）／赤枠（勤務が入った）。
- **月の上限調整**: 月ごとに公休数が違うケースに対応。「この月の公休数 → 常勤全員の上限を一括計算」。
- **TimePro貼付用**: 職員別に、勤怠区分列／シフト区分列の2列を月分まとめてクリップボードへ。記号→TimePro表記の対応表を編集可能。
- **印刷**: 月表示（A4横）／週表示（A4縦）。ヘッダに施設名・印刷日。

---

## 2. 現在のデータ構造（localStorage `shiftapp_v1` = オブジェクト `S`）

```js
S = {
  meta: {
    version: 1,
    facilityName: "（施設名）",
    compHard: true,                       // 相性×を必須条件として扱うか
    nightMode: "ake" | "direct",          // 夜勤明けの扱い：ake=夜→明→休 / direct=夜→公休
    nightAvoidShiftAfter2: ["a2", ...],   // 夜勤の2日後に避ける勤務ID（directのとき）
    shiftConsecutiveCaps: { "m1": 2 },    // 勤務記号ごとの連続日数上限
    minRestHours: 11,                     // 最低休息時間（推奨＝ソフト扱い）
    preferredFillShift: { start:"08:30", end:"17:30" }  // 不足補充時に優先する時間帯
  },

  shiftTypes: [                           // 勤務記号マスタ
    { id:"a2", symbol:"A2", name:"A2（早出）", start:"07:00", end:"16:00",
      color:"#FAEEDA", text:"#633806", isWork:true, isNight:false }
    // ... "off"（公休）/"paid"（有給）は fixed:true の固定記号
  ],

  staff: [                                // 職員
    { id:"（英字）", name:"氏名", employment:"常勤"|"非常勤"|"パート",
      maxDaysPerMonth:21, maxConsecutive:5,
      allowedShiftIds:["a2","b1","b2","m1","n1"],
      qualifications:["介福"], traits:["リーダー気質"],
      nightShiftTarget:2 }                // 任意。未設定なら夜勤目標なし
  ],

  compatibility: [                        // 相性（"good"＝普通 は保存しない）
    { a:"staffId", b:"staffId", level:"double"|"good"|"caution"|"x" }
  ],

  rules: [                                // 条件（ルールビルダー）
    { id, enabled:true, strength:"hard"|"soft",
      days:  { type:"all"|"weekdays"|"weekend"|"dow"|"dates", values?:[...] },
      target:{ type:"shift"|"qualification"|"trait"|"staff"|"traitPair"|"shiftGroup",
               value, value2? },
      cond:  { type:"exact"|"atLeast"|"atMost"|"none"|"work"|"off"|"together"
                    |"notTogether"|"atLeastGroup"|"notTogetherGroup"|"preferShift",
               count?, value? } }
  ],

  events:  { "2026-04-12": "敬老会" },    // 行事・予定（日付→テキスト）
  wishes:  { "staffId": ["2026-04-12", ...] },  // 希望休（職員→日付配列）
  monthlyMaxDays: { "2026-04": { "staffId": 20 } },  // 月別の勤務日数上限オーバーライド
  timeproMap: { "shiftId": { kotai:"公休", shift:"" } },  // TimePro-VG 変換表

  schedules: {                            // 月間シフト
    "2026-04": {
      adopted: { "staffId": { "1":"b2", "2":"off", "9":"n1", ... } },  // 採択済みグリッド
      locks:   { "staffId": { "12": true } }                          // ロックセル
    }
  }
}
```

**固定ルール（`rules[]` に入らず、コードに埋め込まれた制約）**
- 職員の `allowedShiftIds` 以外の勤務は不可
- 夜勤ブロックの扱い（`nightMode`）：ake=翌日「明」翌々日「休」／direct=翌日「公休」＋2日後に指定勤務回避
- `maxConsecutive`（連続勤務上限）
- `effectiveMaxDays`（月間勤務上限。**常勤は下限も兼ねる**＝必要出勤日数に届かないと違反「要出勤」）
- `shiftConsecutiveCaps`（勤務記号別の連続上限）
- `compatibility` の `x` ペア（`meta.compHard` が true のとき同一シフト禁止＝必須）
- `minRestHours`（勤務間インターバル。**推奨＝ソフト**）
- 月内の偏り（週ごとの稼働密度・種別分散。**スコアのみ**）

---

## 3. 自動シフト作成ロジック

### 3案のプロファイル（`PROFILES`）
| 案 | fair(公平) | comp(相性) | wish(希望休) | soft(推奨) | interval(休息) | spread(偏り) |
|---|---|---|---|---|---|---|
| A 公平性重視 | 40 | 20 | 25 | 15 | 15 | 15 |
| B 相性重視 | 20 | 40 | 25 | 15 | 15 | 15 |
| C 希望休優先 | 20 | 15 | 50 | 15 | 15 | 15 |

※ 重みは合計で正規化。`total = Σ(指標×重み) / Σ重み`。

### `generateOne(y, m, profile)` のパイプライン
1. **初期化**: 職員ごとに空グリッド。
2. **ロック引き継ぎ**: `schedules[ym].locks` が立っているセルは採択済みグリッドから値をコピー。
3. **希望休の仮置き**: `wishes` の日を `"off"` で埋める。
4. **夜勤の割り当て**: 日ごと・夜勤記号ごとに、`demandFor`（必要数）を満たすまで
   `canWork` を通る職員から選ぶ。優先度 `nightPriority` ＝ 個人の `nightShiftTarget` に未達なら強く優先、なければ現在の夜勤回数が少ない順。上位2名からランダム。
   nightMode に応じ翌日「明」＋翌々日「休」または翌日「公休」を自動セット。
5. **日中シフトの割り当て**: 日ごと・日中記号ごとに必要数まで。優先度＝
   `月間勤務数 + その記号の回数×0.8 + 休息不足ペナルティ(3)` が小さい順。上位3名からランダム。
6. **空セルを `"off"`**。
7. **`fillMinimumWorkdays`**: 常勤で必要出勤日数に未達の職員に対し、週（7日）単位で均等に休みの日を勤務へ振替。振替先の記号は `preferredFillShift` の時間帯に近く、同じ週で同種別が偏らないものを優先。
8. **`repair`**（最大400反復）: 必要数不足のシフトを解消。手段を順に試行 —
   ① 休みの職員を充当（希望休の人・勤務数多い人は後回し）
   ② 同日の余剰シフトから付け替え
   ③ 2手修復：別日の余剰勤務を休に振替 → 空いた職員を今日へ
   最後に `repairGroups`（`shiftGroup` 系 hard ルールの充足：合計人数不足の補充／同時配置禁止の解消）。
9. **`hillClimb`**（時間制限 800ms）: ランダムな近傍操作を試し、`hardCount` が減る or 同数で `total` が上がるときのみ採用。操作は3種 —
   ・同一職員の「休」と「勤務」を別日と入替
   ・同日の2職員のシフトを交換
   ・不足シフトへ休みの職員を充当（希望休の人は避ける）
10. **`repair` を再実行** → `checkMonth`（違反抽出）＋ `scoreGrid`（採点）。

### 採点 `scoreGrid` → 各0〜100
| 指標 | 内容 |
|---|---|
| `fair` 公平性 | 勤務日数の標準偏差 ×10 ＋ 夜勤回数の「個人目標との乖離」×12 ＋ 土日勤務回数SD ×8 ＋ 同一勤務条件グループ内の種別回数SD ×7 を 100 から減点 |
| `comp` 相性 | 同一シフトのペアごとに ◎+2 / △-2 / ×-6。ペア数で正規化し 50 基準にスケール |
| `wish` 希望休 | 守れた希望休 / 全希望休 × 100 |
| `soft` 推奨 | ソフトルールの充足日数 / 対象日数 × 100 |
| `interval` 休息 | `minRestHours` 未満の並びの不足時間合計をチェック数で割り減点 |
| `spread` 偏り | ①週ごとの稼働密度の均等さ ②週をまたぐ種別の散らばり を各50%で合成 |

### ベスト案の選定・採択
- ベスト＝ `hardCount` 最少 → 同数なら `total` 最大。
- 採択で `schedules[ym].adopted` に候補グリッドをディープコピー保存、`candidates` は破棄（**候補は永続化しない**）。
- 生成は `setTimeout` で UI ブロックを避けるのみ（ワーカー未使用）。

---

## 4. 条件・制約ロジック

### ルールビルダーの語彙（`rules[]`）
- **対象日 `days.type`**: `all`（毎日）/ `weekdays`（平日）/ `weekend`（土日）/ `dow`（曜日指定 values=[0..6]）/ `dates`（日付指定 values=["YYYY-MM-DD"]）
- **対象 `target.type`**:
  - `shift`（シフト種別）/ `qualification`（資格）/ `trait`（特性タグ）/ `staff`（特定職員）
  - `traitPair`（タグのペア value,value2）/ `shiftGroup`（シフトの組み合わせ value=[id,...]）
- **条件 `cond.type`**:
  - 人数系: `exact`（ちょうどN）/ `atLeast`（N以上）/ `atMost`（N以下）/ `none`（配置しない）
  - 職員系: `work`（必ず勤務）/ `off`（勤務させない）/ `preferShift`（特定シフトを優先＝推奨向け）
  - ペア系: `together`（必ず同一シフト）/ `notTogether`（同一シフト禁止）
  - グループ系: `atLeastGroup`（合計N名以上）/ `notTogetherGroup`（どちらか一方のみ）
- **強さ `strength`**: `hard`（必須）/ `soft`（推奨）

### 評価の流れ
- `ruleAppliesToDate(rule, y, m, d)` で対象日か判定 → `evalRuleDay` で1日分を評価、違反なら `{msg, cells:[{sid,d}]}`。
- `demandFor(y, m, d)`: **有効な hard ルールのうち `target.type==="shift"` かつ `cond` が `exact`/`atLeast` のものから、その日の必要人数を算出**（生成ロジックの入力）。
- `checkMonth(y, m, grid)`: 固定ルール ＋ 相性× ＋ ビルダールール ＋ 休息時間 をまとめて評価し、
  `{ cells:{sid:{d:[msg]}}, hard:[], soft:[], hardCount, softCount }` を返す。
- `canWork(grid, p, d, tid, y, m)`: 生成時の配置可否。allowedShift・既存セル・強制休みルール・夜勤ブロック・「明」の翌日・夜勤前後の空き・連続勤務・記号別連続・月間上限・相性×hard を一括チェック。
- 「固定休み曜日」は専用フィールドではなく **`target:staff / cond:off / days:dow` の hard ルール**として表現（Excel取込時も自動でルール化）。

### 休息時間（勤務間インターバル）
- `restIntervalHours(prevId, nextId)`: 夜勤絡み・時刻未設定は対象外（null）。`(24 - 前日終業h) + 翌日始業h`。
- `minRestHours` 未満 → **ソフト違反**（生成では配置ペナルティ、採点では減点）。

---

## 5. Excel インポート／エクスポート仕様

### テンプレート（`downloadTemplate` / base64内蔵 `.xlsx`）
シート構成（`parseExcelTemplate` が読む）:
| シート | 列 |
|---|---|
| 施設情報 | 「施設名」「夜勤明けの扱い（公休に直行/明を使う）」「夜勤の2日後に避ける…」「最低休息時間…」（キー/値の縦持ち） |
| 勤務記号 | 記号 / 名称 / 開始 / 終了 / 勤務(はい・いいえ) / 夜勤(はい・いいえ) |
| 職員 | 氏名 / 雇用形態 / 月間勤務上限 / 連続勤務上限 / 対応可能勤務(記号カンマ区切り) / 資格 / 特性タグ / 月間夜勤回数目標 / 固定休み曜日 |
| 条件 | 有効 / 必須・推奨 / 対象日タイプ / 対象日詳細 / 対象タイプ / 値1 / 値2 / 条件タイプ / 人数 |
| 勤務実績（任意） | 年月(YYYY-MM) / 日 / 氏名 / 記号 |
| 使い方 | 説明のみ |

日本語ラベル → 内部enum の対応表（`CONDMAP` / `DAYSMAP` / `TARGETMAP` / `DOWMAP_JA`）を内蔵。

### 読込時のバリデーション・確認画面（`showExcelReview`）
- `parseExcelTemplate` は `{draft, warnings[]}` を返す。**該当行はスキップして警告に積む**：
  - シートが無い／勤務記号が見つからない／職員名が見つからない／曜日を認識できない／シフトの組み合わせが2未満／条件の項目を認識できない 等
- 確認モーダルに「施設名・夜勤明けの扱い・勤務記号◯種・職員◯名・条件◯件・取込む月◯ヶ月」と警告一覧を表示。
- 職員が0名なら取込不可。
- 「取り込むと現在のデータはすべて置き換わります」と明記 → `confirmExcelImport` で `S` を丸ごと差し替え。
- 勤務記号IDは英数字ならその小文字、そうでなければ乱数ID。`off`/`paid` は固定で付与。

### エクスポート
- **シフト表のExcel書き出しは無い**。データ全体の `JSONエクスポート`（`exportJson` バックアップ）と `JSONインポート` のみ。
- 勤怠連携は **TimePro-VG 用のクリップボードコピー**（`copyTimeproColumn`）：職員別に「勤怠区分」列・「シフト区分」列を1ヶ月分、改行区切りテキストで生成。記号→表記は `timeproMap` で調整（`kotai` / `shift` の2値。勤務記号は `記号:HHMM-HHMM` を既定）。

---

## 6. 新 Firestore 設計への対応表

| 旧 `S` の場所 | 新 Firestore | 備考 |
|---|---|---|
| `meta.facilityName` | `facilities/{fid}.name` | |
| `meta.nightMode` / `nightAvoidShiftAfter2` / `shiftConsecutiveCaps` / `minRestHours` / `preferredFillShift` / `compHard` | `facilities/{fid}/settings/shiftRules` | 旧 `afterNightShift` 周辺と統合。初期は未設定 |
| `shiftTypes[]` | `facilities/{fid}/shiftPatterns/{patternId}` | `symbol→code`, `name→label`, `start/end/isWork/isNight/color/text` 維持。`fixed→isSystem`。`category` を追加 |
| `staff[]` | `facilities/{fid}/staff/{staffId}` | 下記で分解 |
| `staff[].employment` | `staff.employmentTypeId` ＋ `employmentTypes/{id}` マスタ | 旧は自由文字列（常勤/非常勤/パート） |
| `staff[].qualifications` / `traits` | `staff.qualifications[]` / `staff.traits[]` | ルールが参照するので**名称のまま維持** |
| `staff[].maxDaysPerMonth` / `maxConsecutive` / `allowedShiftIds` / `nightShiftTarget` | `staff.workConditions.*` | `maxWorkdaysPerMonth` / `maxConsecutiveWorkdays` / `workablePatternIds` / `maxNightShiftsPerMonth` or 専用 `nightShiftTarget` |
| （固定休み曜日：旧は hard ルール） | `staff.workConditions.workableWeekdays` **または** `rules` のまま | §8-4 で方針決定 |
| `compatibility[]` | `facilities/{fid}/compatibilities/{pairId}` | `level: double/good/caution/x`（設計書の -2..+2 と統合、§8-5） |
| `rules[]` | `facilities/{fid}/rules/{ruleId}` | 構造ほぼ 1:1（`strength→kind`, `days/target/cond` の語彙を維持） |
| `wishes{}` | `facilities/{fid}/leaveRequests/{requestId}` | 1職員1日1ドキュメント。旧は「希望休」二値のみ → `type/priority/status/desiredPatternId` を付与し承認フロー化 |
| `events{}` | `facilities/{fid}/schedules/{ym}.events` | **設計書に未記載 → 追加** |
| `monthlyMaxDays{}` | `facilities/{fid}/schedules/{ym}.monthlyMaxDaysOverride` | 月依存なのでスケジュール文書へ。**設計書に未記載 → 追加** |
| `timeproMap{}` | `facilities/{fid}/settings/timeproExport` | **設計書に未記載 → 追加** |
| `schedules[ym].adopted` | `facilities/{fid}/schedules/{ym}.assignments` | 値は `symbol` ではなく `patternId` に統一 |
| `schedules[ym].locks` | `facilities/{fid}/schedules/{ym}.locks` | `{ staffId: { day: true } }` そのまま |
| `V.candidates`（非永続） | `facilities/{fid}/schedules/{ym}/candidates/{candidateId}` | 設計書に既にある。旧は保存していなかった |
| `localStorage` 全体 | 認証済みユーザー ＋ `facilityId` スコープ | 「置き換え型」Excel取込は**1施設スコープ＋バッチ書き込み＋プレビュー**に再設計 |

---

## 7. 新版でそのまま継承するもの（業務ロジックとして忠実に移植）

1. **勤務記号モデル**（記号 / 名称 / 開始終了 / isWork / isNight / 色）。「明」「公休」「有給」の固定記号の考え方。
2. **ルールビルダーの語彙**（対象日 × 対象 × 条件 × 必須/推奨）。これが業務要件の中核。enum をそのまま TypeScript の型にする。
3. **必要人数の導出**（`demandFor`：hard の shift ルールから日次必要数を計算）。
4. **夜勤運用の2モード**（`ake` / `direct`）と夜勤前後の配置制約。
5. **月間勤務上限が常勤では下限も兼ねる**（必要出勤日数）という考え方、`monthlyMaxDays` の月別上書き。
6. **3案生成 → 比較 → プレビュー → 採択** のワークフローと6指標スコア（fair/comp/wish/soft/interval/spread）＋3プロファイル。
7. **生成パイプライン**（seed → 夜勤 → 日中 → 最低出勤補充 → repair → hillClimb → 再repair）。まずクライアント側で移植。
8. **違反表示**（`checkMonth` の hard/soft 分類、セル単位の `!` とツールチップ、希望休の金枠/赤枠）。
9. **手修正 UX**（セルクリックで可能記号のみ提示、セルロック、夜勤入力時の翌日自動補完）。
10. **勤務種別ごとの日次集計行**（`◯/必要数`、不足赤）と個人別サマリ、夜勤目標対比パネル。
11. **TimePro-VG の2列クリップボード出力**（勤怠区分／シフト区分、記号→表記の対応表）。
12. **Excelテンプレートによる他施設オンボーディング** のシート構成と、**取込プレビュー＋警告一覧**の UX。
13. **印刷レイアウト**（月＝A4横／週＝A4縦、施設名・印刷日ヘッダ）。React の印刷ビューとして再現。
14. **相性マトリクス UX**（クリックで循環、× を必須扱いにするトグル）。

---

## 8. 新版で設計し直すもの

1. **ID体系**: 旧はローマ字姓・記号小文字・乱数が混在。新は Firestore 自動ID（またはスラッグ）。`assignments` は必ず `patternId` を保存（`symbol` は表示専用）。
2. **雇用区分**: 自由文字列 → `employmentTypes` マスタ＋参照。旧の「常勤は必要出勤日数の下限あり」を区分の属性（`countsWorkdayLowerBound` 等）に一般化。
3. **職種（jobType）**: 旧には明示的な職種概念が無い（全員介護職、看護は資格ルールで表現）。新は `jobTypes` マスタを導入しつつ、既存のルールが使う `qualifications` / `traits` は温存（別軸として維持）。
4. **固定休み曜日**: 旧は hard ルール化。新は「`staff.workConditions.workableWeekdays` に持たせて生成時にルールへコンパイル」か「従来どおりルールとして保持」の二択。
   → **推奨: 生成エンジンの入力はルールに正規化**（アルゴリズムを旧と揃えられる）。UI 上は職員フォームからも編集できるようにし、保存時にルールへ変換 or 双方向同期。
5. **相性の表現**: 旧は4段階ラベル（double/good/caution/x）。設計書の `score:-2..+2` と統合し、`{ level: enum, weight: number|null, note }` の形に。`good` は保存しない方針も維持。
6. **希望休（leaveRequests）**: 二値リスト → 構造化（type / priority / status / desiredPatternId）。認証により **職員本人が自己申請 → 管理者が承認** のフローを追加（設計書 §8 のルールで担保）。生成エンジンは「承認済み or must」を高速に読める形（`yearMonth` 単位のクエリ）にする。
7. **events / monthlyMaxDaysOverride / timeproExport**: 設計書 rev.2 に未記載。`schedules/{ym}` 文書 or `settings/` に追加（→ firestore-design.md rev.3 で反映提案）。
8. **Excel「全置換」取込**: 単一 localStorage 前提の「丸ごと差し替え」を、**1施設スコープ・トランザクション（バッチ）書き込み・差分プレビュー（新規/変更/削除）**に再設計。SheetJS はクライアントに読み込む（CSPで外部CDN不可なので self-host/inline）。
9. **生成の実行場所**: 旧はブラウザ内 `setTimeout`＋800ms 山登り。新も当面クライアント側（全データがメモリに載る規模）。将来 Cloud Functions（Blaze 必須）へ切り出す場合に備え、生成ロジックを **UI 非依存の純関数モジュール**（`src/domain/scheduler/`）として実装。
10. **月シフトの同時編集**: firestore-design.md §7 の楽観ロック方針を適用（`revision`）。旧は単一利用前提のため対策なし。
11. **描画**: 全再描画の文字列テンプレート → React コンポーネント（`ShiftGrid` / `RuleBuilder` / `CompatMatrix` / `StaffForm` / `CandidatePanel`）。
12. **バックアップ**: 旧の JSON エクスポート/インポートは、Firestore 版では「施設データのエクスポート（管理者用）」として残すか検討（移行・退避用）。

---

## 9. firestore-design.md への反映提案（rev.3 候補）

分析で判明した、設計書 rev.2 に足りない要素:

- `facilities/{fid}/settings/shiftRules` に旧 `meta` 由来のフィールドを明記:
  `nightMode` / `nightAvoidPatternIdsAfter2` / `shiftConsecutiveCaps` / `minRestHours` / `preferredFillShift` / `treatCompatibilityXAsHard`
- `facilities/{fid}/compatibilities/{pairId}` を正式に節として追加（設計書では「将来」扱いだった）
- `facilities/{fid}/rules/{ruleId}` の `days/target/cond` 語彙を §4 の enum で確定
- `facilities/{fid}/schedules/{ym}` に `events` / `monthlyMaxDaysOverride` を追加
- `facilities/{fid}/settings/timeproExport` を追加
- `staff.workConditions` に `traits[]` を追加（ルールが参照）、`nightShiftTarget` を明記
- Excel テンプレートのシート仕様を別紙（`docs/excel-template-spec.md`）として切り出し予定

→ 反映してよいか確認後、firestore-design.md rev.3 として更新します。
```
