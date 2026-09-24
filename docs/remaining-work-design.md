# 残作業 実装設計書（Phase 4d 〜 機能パリティ完了まで）

作成日: 2026-09-14 / 作成: 設計セッション（実装は後続セッションが本書に従って行う）
前提資料: `firestore-design.md`(rev.3) / `legacy-html-analysis.md` / `feature-parity.md`

---

## 0. この文書の位置づけと絶対ルール

- **完成済みの機能（Phase 0〜4c、UI刷新）は変更しない。** 本書に「変更許可」と明記した統合ポイントのみ触ってよい。
- 実装は本書のフェーズ順に**1フェーズずつ**進め、各フェーズ完了時に
  ①ユーザーの手動確認 → ②`feature-parity.md` 更新 → ③コミット → ④`npm run deploy:dev` → ⑤ユーザーにpush依頼、
  の既存サイクルを守る。
- Firebase CLI は常に `firebase.cmd`。prod への操作は毎回ユーザー確認。dev は確認不要。
- 新規依存は **P7(Excel) の `xlsx` のみ**。それ以外のライブラリ追加は禁止（無駄の排除）。
- 生成はブラウザ内で実行する（Cloud Functions 不使用。Sparkプランのまま）。

### 完成済み（触らない）
ログイン/施設選択、マスタCRUD(職種/雇用区分/勤務パターン)、職員CRUD、
シフト表(手修正/ロック/印刷/個人別集計列/セルピッカー)、希望休、相性、条件ビルダー、
違反チェック `src/domain/scheduler/check.ts`、サイドバーUI。

---

## 1. 残作業の全体像と実装順

| # | フェーズ | 内容 | 依存 |
|---|---|---|---|
| S1 | 設定画面 | `settings/shiftRules` の編集UI + checkMonth拡張 | なし |
| 4d-1 | エンジン基盤 | `defaults.ts` / `score.ts` / `demand` / `canWork` | S1 |
| 4d-2 | 生成本体 | `generateOne` / `repair` / `hillClimb` | 4d-1 |
| 4e | 生成UI | 3案生成・比較カード・プレビュー・採択・候補の永続化 | 4d-2 |
| P5 | 表まわり小物 | 行事(events)行 / 月の上限調整 / 夜勤目標対比パネル | S1 |
| P6 | TimePro連携 | 変換表 + 2列クリップボードコピー | なし |
| P7a | Excel出力 | テンプレート生成（現データの書き出し兼用） | なし |
| P7b | Excel取込 | 解析 + 差分プレビュー + バッチ反映 | P7a |
| P8 | 週表示 | 画面の週表示 + A4縦印刷（**保留のまま。指示があれば着手**） | なし |

S1→4d-1→4d-2→4e が本線。P5/P6/P7 は本線と独立なので、ユーザーの希望順で差し込み可能。
既定の推奨順は表の上から順。

---

## 2. S1: 設定画面（`settings/shiftRules`）

### 2-1. データ
`facilities/{fid}/settings/shiftRules`（rev.3 §4 の定義どおり。未作成=全て制約なし）:

```ts
export interface ShiftRulesSettings {
  nightMode: 'ake' | 'direct' | null            // null = 夜勤ブロック制約なし
  nightAvoidPatternIdsAfter2: string[]          // direct時、夜勤2日後に避ける
  shiftConsecutiveCaps: Record<string, number>  // patternId -> 連続上限
  minRestHours: number | null                   // 勤務間インターバル（soft）
  preferredFillTimeRange: { start: string | null; end: string | null }
  treatCompatibilityXAsHard: boolean | null     // null は true 扱い（旧版既定）
  maxConsecutiveWorkdaysDefault: number | null
  monthlyLimitsDefault: {
    targetWorkdays: number | null
    maxWorkdays: number | null
    maxNightShifts: number | null
  }
}
```

- `lib/firestore.ts` に追加（変更許可）: `fetchShiftRulesSettings(fid)`（未作成なら全null既定値を返す）、
  `saveShiftRulesSettings(fid, data)`（setDoc merge:true）。
- `types/models.ts` に上記型を追加（変更許可）。

### 2-2. UI
- サイドバーに「⚙️ 設定」タブ追加（`FacilityShell` の TABS と Routes に1行ずつ。変更許可）。
- `features/settings/SettingsPage.tsx` 新規。フォームは1画面・「保存」ボタン1つ（行単位保存にしない）。
  - 夜勤明けの扱い: select（未設定/明を使う/公休に直行）。direct選択時のみ「2日後に避ける勤務」チェック群を表示
  - 勤務パターン別連続上限: パターンselect+日数+追加/削除（旧版のcapsと同じ）
  - 最低休息時間・不足補充の優先時間帯・相性×を必須扱い・施設既定の連続/月間上限
- admin以外は読み取り表示のみ（既存画面と同じ流儀）。

### 2-3. checkMonth 拡張（`domain/scheduler/check.ts` 変更許可）
`CheckInput` に `settings: ShiftRulesSettings` を追加し、以下を追加実装（全て旧版 checkMonth の移植）:

1. **夜勤ブロック**（`nightMode` 設定時のみ）
   - `ake`: 夜勤の翌日は afterNightカテゴリ、その翌日は offカテゴリ でないと hard違反。
     夜勤なしの「明」も hard違反。
   - `direct`: 夜勤ブロック終端の翌日が isWork なら hard違反（「夜勤翌日は休みが必要」）。
     翌々日が `nightAvoidPatternIdsAfter2` に含まれる勤務なら hard違反。
     連続夜勤はブロックとして1回だけ判定（旧版 checkMonth の e ループと同じ）。
2. **パターン別連続上限** `shiftConsecutiveCaps`: 超過で hard違反。
3. **休息時間** `minRestHours`: 夜勤絡み・時刻未設定ペアは対象外。
   `gap = (24 - 前日end) + 翌日start`（>24なら-24）。gap < minRest で **soft** 違反。
4. **既定値の解決**: 職員の `maxConsecutiveWorkdays` / `targetWorkdaysPerMonth` /
   `maxWorkdaysPerMonth` / `maxNightShiftsPerMonth` が null のとき settings の既定値へフォールバック。
   解決関数は `domain/scheduler/limits.ts` に新設し check と engine で共用:
   ```ts
   resolveLimits(staff, employmentType, settings, monthlyOverride?):
     { targetWorkdays, maxWorkdays, maxConsecutive, maxNights }  // 各 number | null
   ```
   - targetWorkdays は employmentType.hasTargetWorkdays が true のときのみ有効。
   - 優先順: 月別上書き(P5) → 職員 → 施設既定 → null(制約なし)。rev.3 §4-1どおり。
5. **相性×**: `treatCompatibilityXAsHard === false` のときは hard違反にしない（softにも入れない。
   スコアの comp でのみ減点）。null/true は現行どおり hard。
6. CheckInput へ `employmentTypes` と `monthlyMaxDaysOverride` も追加（4のため）。

呼び出し側の `ShiftGridPage` は settings/employmentTypes を load に追加して渡す（変更許可）。
※ checkMonth のシグネチャ変更はこのフェーズで一度に済ませ、以後凍結する。

---

## 3. 4d-1: エンジン基盤（純関数・UI非依存）

すべて `src/domain/scheduler/` 配下。React/Firestore を import しない。

### 3-1. `defaults.ts` — 旧版由来の初期係数（v1として凍結）
```ts
export const GENERATION_DEFAULTS_V1 = {
  profiles: [
    { key: 'fairness', label: '案A 公平性重視', weights: { fair: 40, comp: 20, wish: 25, soft: 15, interval: 15, spread: 15 } },
    { key: 'compat',   label: '案B 相性重視',   weights: { fair: 20, comp: 40, wish: 25, soft: 15, interval: 15, spread: 15 } },
    { key: 'leave',    label: '案C 希望休優先', weights: { fair: 20, comp: 15, wish: 50, soft: 15, interval: 15, spread: 15 } },
  ],
  score: {
    fair:     { workdaySd: 10, nightTargetDev: 12, weekendSd: 8, typeFairDev: 7 },
    comp:     { double: +2, caution: -2, x: -6 },
    interval: { penaltyPerHour: 18 },
    spread:   { overallWeight: 0.5, typeWeight: 0.5, overallK: 60, typeK: 35 },
  },
  engine: { hillClimbMs: 800, repairMaxIter: 400, groupRepairMaxIter: 100,
            nightPickTopN: 2, dayPickTopN: 3, typeCountWeight: 0.8, restPenalty: 3 },
} as const
```
`settings/generationConfig` ドキュメントが存在すればフィールド単位で上書き（deep mergeユーティリティを1つ書く）。
**generationConfig の編集UIは作らない**（当面コンソール編集で足りる。UI化は将来）。

### 3-2. 入力型（`types.ts` に追記。変更許可）
```ts
export interface GenerateInput {
  yearMonth: string
  daysInMonth: number
  staff: StaffWithId[]                    // active のみ
  employmentTypes: (EmploymentType & { id: string })[]
  shiftPatterns: PatternWithId[]
  rules: RuleWithId[]                     // enabled のみ渡す
  compatibilities: CompatibilityWithId[]
  settings: ShiftRulesSettings
  wishes: { staffId: string; day: number }[]        // 当月の希望休のみ（type=希望休）
  lockedCells: Record<string, Record<string, true>> // schedule.locks
  baseAssignments: Record<string, Record<string, string>> // ロック引継ぎ元（現在の adopted）
  monthlyMaxDaysOverride?: Record<string, { targetWorkdays?: number|null; maxWorkdays?: number|null }>
  config: typeof GENERATION_DEFAULTS_V1   // マージ済みを渡す
}

export interface Candidate {
  profileKey: string
  label: string
  weights: Record<'fair'|'comp'|'wish'|'soft'|'interval'|'spread', number>
  assignments: Record<string, Record<string, string>>
  scores: { fair: number; comp: number; wish: number; soft: number; interval: number; spread: number; total: number }
  hardCount: number; softCount: number
  hardViolations: string[]; softViolations: string[]
  fulfillmentRate: number
}
```
グリッドは既存と同じ `Record<staffId, Record<day文字列, patternId>>` を使う（新表現を作らない）。

### 3-3. `demand.ts` — 必要人数（旧 demandFor の移植）
有効な **hard** ルールのうち `target.type==='shift'` かつ `cond.type ∈ {exact, atLeast}` から
`demandFor(day): Record<patternId, number>`（同一パターン複数ルールは max）。
※ `shiftGroup/atLeastGroup` は demand に入れない（旧版同様、repairGroups で扱う）。

### 3-4. `canWork.ts` — 配置可否（旧 canWork の移植 + rev.3 対応）
`canWork(grid, staff, day, patternId, ctx): boolean`。判定順（早期return）:
1. `workablePatternIds` が非空で含まれない → 不可（空/未設定なら全パターン可。既存UIと同じ解釈）
2. 既にその日に割当あり → 不可
3. `fixedOffWeekdays` に該当曜日 → 不可
4. 「特定職員を勤務させない」hard ルール（target:staff / cond:off）該当日 → 不可
4.5. **人数上限（2026-09-17 追加。旧HTML版からの意図的な逸脱）**:
   target:shift かつ cond:none（配置しない）/ cond:atMost（N名以下）の hard ルールから
   日ごと・パターンごとの上限を作り（`caps.ts` の `buildDayPatternCaps`）、上限に達していたら不可。
   同一パターンに複数ルールがあれば min、最後に同日の `demandFor` と比較して大きい方を採用する
   （「N名以上」と「配置しない」が同居する矛盾データでは上限が必要人数まで上がり、
   従来と完全に同一の挙動になる＝充足率が下がる回帰が起きない）。
   - 逸脱の理由: 旧版は違反を作ってから hillClimb が偶然見つけたときだけ消す作りだが、
     手順8の repair は不足の補充しかせず**過剰配置を除去しない**ため取りこぼしが残り続けていた
     （アミティホーム寺田で毎回2〜4件、発生日はランダム）。`defaults.ts` の restPenalty 変更と同じ扱い。
   - `exact` の超過は塞がない（fillMinimumWorkdays の配置先が狭まり「必要出勤日数未達」に化けるため）。
     資格/特性の件数ルールも対象外（CanWorkContext に職員リストが無く型変更が要るため別フェーズ）。
   - `engine.enforceDayPatternCaps`（既定 true）で施設ごとに旧挙動へ戻せる。
   - ロック済みセルが既に上限超過の場合、その日そのパターンは全ブロックになる（checkMonth が違反として報告する）。
4.6. **タグのペアの同席禁止（2026-09-24 追加。4.5 と同じく旧HTML版からの意図的な逸脱）**:
   target:traitPair かつ cond:notTogether の hard ルールについて、配置しようとしている職員と
   同じ日・同じ勤務に、相手側のタグを持つ別の職員がすでにいれば不可（`traitPairs.ts`）。
   勤務でないパターン（公休など）は対象外。判定の意味は check.ts の evalRuleDay と揃えている。
   - 逸脱の理由: 4.5 と同じ。生成は同席を作ってから hillClimb が偶然見つけたときだけ消していた
     （アミティホーム寺田の「臼井と中野を同じ勤務帯にしない」が違反一覧に出ていた）。
     hillClimb を止めた状態で比べると、ブロック無しでは配置の段階で同席が生まれ、有りでは0件になる。
   - `together`（必ず同席）は対象外。「置かない」判定では表せないため（必要になれば別途）。
   - `engine.enforceTraitPairs`（既定 true）で施設ごとに旧挙動へ戻せる。
5. 夜勤ブロック（nightMode設定時のみ）:
   - direct: 前日が夜勤なら夜勤以外不可（連続夜勤は許容、上限はcapsで管理）。
     前々日が夜勤で patternId が nightAvoid に含まれる → 不可。
     夜勤を置く場合、翌日が既埋まりなら不可。
   - ake: 前日が夜勤なら不可（明はエンジンが自動でセットするため候補にしない）。
     前日が afterNight → 不可。夜勤を置く場合、翌日/翌々日が既埋まりなら不可。
6. 連続勤務: 前後の連続 work 数 + 1 が resolveLimits().maxConsecutive 超 → 不可（null なら無制限）
7. パターン別連続上限 caps 超 → 不可
8. 月間: workCount+1 > maxWorkdays → 不可 / 夜勤なら nightCount+1 > maxNights → 不可
9. 相性×（treatCompatibilityXAsHard !== false のとき）: 同日同パターンに×相手が既にいる → 不可

### 3-5. `score.ts` — 6指標採点（旧 scoreGrid の忠実移植）
係数はすべて `config.score` から。数式は旧版と同一:
- **fair** = max(0, 100 − (勤務日数SD×workdaySd + 夜勤目標乖離RMS×nightTargetDev + 土日勤務SD×weekendSd + 同条件グループ内種別SD平均×typeFairDev))
  - 夜勤目標乖離: `nightShiftTarget` 設定者のみ `sqrt(Σ(実績−目標)² / n)`
  - 同条件グループ: `workablePatternIds の日勤部分をsortしてjoin` が同じ職員同士で各種別回数のSD
- **comp**: 同日同パターンの全ペアに ◎+2/△−2/×−6 を加算（基準50）、
  `max(0, min(100, pairs ? 50 + (raw−50)×2/√pairs : 70))`
- **wish** = 守れた希望休/全希望休×100（希望なしは100）
- **soft** = softルール充足日数/対象日数×100（対象なしは100）
- **interval** = checks ? max(0, round(100 − (不足時間合計/checks)×penaltyPerHour)) : 100
- **spread** = 週ごとの稼働密度均等(overallK=60) と 種別の週分散(typeK=35, 月2回未満の種別は除外) を 0.5:0.5 合成
- **total** = round(Σ(指標×重み)/Σ重み)
- `fulfillmentRate(grid)` = Σmin(need, actual)/Σneed ×100（needなしは100）

---

## 4. 4d-2: 生成本体（`generate.ts` / `repair.ts` / `hillClimb.ts`）

`generate(input): Candidate[]` — profiles ごとに `generateOne` を実行して3案返す。
`generateOne(input, profile)` のパイプライン（旧版と同一手順）:

1. **seed**: 空グリッド作成 → `lockedCells` にある座標は `baseAssignments` の値をコピー
   → 希望休の日を offパターンで仮置き（既埋まりはスキップ）。
   - 前提: category `off` のパターン必須。nightMode='ake' なら category `afterNight` も必須。
     欠けていたら例外を投げ、UI側で「先に勤務パターンで◯◯を登録してください」と表示。
2. **夜勤割当**: 日1→末日、夜勤パターンごとに demand を満たすまで:
   - 候補 = canWork を通る職員を `nightPriority` 昇順 + 乱数タイブレークでソート
     - `nightPriority(p) = (target!=null && count<target) ? -1000 + (count - target) : count`
   - 上位 `nightPickTopN`(=2) からランダムに1人選び配置。
   - nightMode='ake': 翌日 afterNight・翌々日 off を自動セット（ロック済みセルは上書きしない）。
     'direct': 翌日 off を自動セット。null: 何もしない。
3. **日中割当**: 日ごと・日中パターンごとに demand を満たすまで:
   - 優先度 = `workCount + typeCount(そのパターン)×typeCountWeight + restPenalty(前日との休息<minRestなら+3)` 昇順+乱数
   - 上位 `dayPickTopN`(=3) からランダム。
   - **（2026-09-18/24 追加）職員ごとのルールを優先度に加減する**（`staffRuleAdjust`、重み `preferShiftWeight`=4）:
     「〜を優先」は該当勤務なら −重み・別の勤務なら +重み、「必ず勤務させる」は −重み（必須は −1000）、
     「勤務させない（推奨）」は +重み。さらに上位3人の中から選ぶ際、後押しされている人がいればその人から、
     いなければ押し下げられていない人から選ぶ（優先度を上げ下げするだけでは均等な抽選で打ち消され、
     「優先」は条件によって30日中0日、「勤務させない（推奨）」はまったく効いていなかったため）。
     上位に入るかは従来どおり勤務日数などで決まるので公平性の歯止めは残る。重み0で旧挙動。
4. **空セルを off で埋める。**
5. **fillMinimumWorkdays**: `resolveLimits().targetWorkdays` 未達の職員（hasTargetWorkdays区分のみ）に対し、
   月を7日区切りにし各週から順に off の日（ロック外・希望休外）を勤務へ振替。
   振替先パターンは `preferredFillTimeRange` に時刻が近く、同じ週で同種別が偏らないものを優先
   （旧版: `timeDistance + 週内種別使用数×1.5` 昇順）。振替は canWork を通る場合のみ。
6. **repair**（最大 repairMaxIter=400 反復・1反復1修正）: demand 不足の (日,パターン) に対し順に
   ① 休みの職員を充当（希望休の人と勤務数多い人を後回し）
   ② 同日の余剰パターンから付替え
   ③ 2手修復: 別日の余剰勤務を休に振替→空いた職員を充当
   その後 `repairGroups`（最大100反復）: shiftGroup 系 hard ルールの
   atLeastGroup 不足補充 / notTogetherGroup の後勝ち解消（旧版と同じ）。
7. **hillClimb**（時間制限 hillClimbMs=800ms）: ランダムに3種の近傍操作
   （35% 休↔勤務の日入替 / 30% 同日2人交換 / 35% 不足への充当）。
   各操作の事前ガードは旧版どおり（ロック・希望休・夜勤/明絡みはスキップ）。
   ただし「休↔勤務の日入替」だけは canWork を通らないため、3-4 の 4.5（人数上限）を
   ガード内で自前に判定する（同日2人交換はパターン別人数が不変なので不要、不足への充当は canWork 経由）。
   採用条件: `checkMonth の hardCount が減る` または `同数で total が上がる`。ダメなら巻き戻す。
   ※ 毎回フル checkMonth+score で良い（17名規模で旧版実証済み。増分計算は将来最適化）。
8. **repair 再実行** → checkMonth + score → Candidate を返す。

- 実行は同期関数でよいが、UI から呼ぶ際は `setTimeout(…, 30)` 相当で1フレーム逃してから実行
  （旧版と同じ。Web Worker は使わない＝無駄の排除。3案×0.8s 程度は許容）。
- 乱数: `Math.random()` 直使用でよい（再現性が必要になったら seed 化。今はしない）。

---

## 5. 4e: 生成UI（候補比較・プレビュー・採択）

### 5-1. データ入出力（`lib/firestore.ts` 変更許可）
- `loadGenerateInput(fid, yearMonth)`: 既存フェッチャの Promise.all + config マージ。
  wishes は `type==='希望休'` のみ day 数値に変換。
- `saveCandidates(fid, ym, candidates)`: 既存 candidates を全削除（≤3件）→ 3件 addDoc。
- `adoptCandidate(fid, ym, daysInMonth, candidate, candidateId, uid, configSnapshot)`:
  ensureSchedule 後、updateDoc で `assignments` 全置換 + `generationMeta{source:'auto', candidateId,
  generationConfigSnapshot, generatedAt}` + `updatedByUid/updatedAt` + `revision: increment(1)`。
  locks はそのまま（seed 済みなので矛盾しない）。

### 5-2. UI（`ShiftGridPage` への統合。変更許可の統合ポイント）
- ヘッダーに「⚡ パターン生成」ボタン（admin のみ）。押下で生成→ `candidates` state + Firestore 保存。
- グリッド上に `features/generate/CandidatesPanel.tsx`（新規）を表示: 3カードを横並び
  （充足率/総合/6指標/必須違反件数+先頭1件/おすすめバッジ=hardCount最少→total最大）。
  各カードに「プレビュー」「採択する」。
- **プレビュー**: `previewAssignments` state をセットし、グリッドはそれを表示・編集無効・
  バナー「プレビュー中:◯◯（未確定）[この案を採択][閉じる]」。checkMonth/集計列もプレビュー側で再計算
  （assignments を1変数に集約して渡すだけなので既存ロジックはそのまま使える）。
- **採択**: hardCount>0 なら confirm。採択後 candidates/preview をクリアし load()。
- ページ再訪時: Firestore に candidates が残っていれば「前回の生成結果を表示」リンクで復元（軽実装でよい）。

---

## 6. P5: 表まわりの小物（3点セット・1フェーズで実施）

1. **行事(events)**: `schedules/{ym}.events: Record<day, string>`。
   グリッドの曜日行の下に「行事」行を追加（旧版と同配置・印刷にも出す）。
   セルクリック→小ポップオーバー（CellPicker と同じ fixed 方式）でテキスト入力・保存は
   `updateDoc { ['events.'+day]: text || deleteField(), revision: increment(1), … }`。
2. **月の上限調整**: ヘッダーに「📅 月の上限を調整」ボタン→モーダル。
   `monthlyMaxDaysOverride: Record<staffId, {targetWorkdays, maxWorkdays}>` を編集。
   旧版同様「この月の公休数から一括計算（日数−公休数）」ボタン（hasTargetWorkdays 区分のみに適用、
   target と max の両方に同値を設定）。checkMonth / engine は S1 の resolveLimits で自動反映済み。
3. **夜勤目標対比パネル**: `nightShiftTarget` 設定者がいる場合のみグリッド上に表示。
   `実績 n / 目標 m (±差)`。差>0 は danger色、<0 は warn色（旧版同様）。

モーダルは既存に仕組みがないため、`components/Modal.tsx`（オーバーレイ+中央カード、Escで閉じる）を
1つだけ新設し、以後のモーダル（TimePro/Excel確認）でも共用する。

---

## 7. P6: TimePro-VG 連携

- `settings/timeproExport` ドキュメント: `{ patternMap: Record<patternId, {kotai: string, shift: string}> }`。
  未作成時の既定値生成は旧版踏襲: offカテゴリ→`{kotai:'公休'}`、paidLeave→`{kotai:'有給'}`、
  isWork→`{shift: code + ':' + HHMM開始 + '-' + HHMM終了}`（時刻なしは code のみ）、他→`{kotai: code}`。
- グリッドヘッダーに「📋 TimePro貼付用」→ Modal:
  職員select / 対応表の折りたたみ編集(保存でsettingsへ) / 当月日別テーブル(処理日・曜日・勤怠区分・シフト区分) /
  「勤怠区分をコピー」「シフト区分をコピー」（`navigator.clipboard.writeText`、改行区切り1列分）。
- 純ロジック（行生成）は `features/timepro/buildTimeproRows.ts` に分離（テスト可能性のため）。

---

## 8. P7: Excel 入出力（唯一の新規依存 `xlsx` を導入）

### P7a: テンプレート出力
- 旧版はテンプレを base64 内蔵していたが、新版は **SheetJS でその場生成**（無駄なバイナリ同梱を排除）。
- シート構成は旧版互換 + rev.3 変更（`legacy-html-analysis.md` §5 / firestore-design §10）:
  使い方 / 施設情報 / 勤務記号 / 職員（勤務日数は**「必要勤務日数」「最大勤務日数」の2列**）/ 条件 / 勤務実績(任意)
- 「空テンプレDL」と「現在の施設データ入りDL」の両対応（後者がバックアップ兼用。JSONエクスポートの代替として
  feature-parity の「JSONバックアップ」は本機能で充足とし 🔮→✅ に更新してよい）。
- 日本語ラベル⇔enum の対応表は `features/excel/labels.ts` に一元化（P7bと共用）。

### P7b: 取込（全置換ではなく差分反映）
1. ファイル読取→`parseTemplate.ts`: 旧版 parseExcelTemplate と同じ寛容パース+warnings[]。
   固定休み曜日列は staff.workConditions.fixedOffWeekdays へ（ルール化しない）。
2. `diff.ts`: 現Firestoreデータと突合し、勤務パターン/職員/条件を 新規/変更/削除/据置 に分類。
   照合キー: 勤務パターン=code、職員=name、条件=正規化した内容のJSON一致。
3. 確認Modal: 件数+警告一覧+分類明細。**削除は既定OFF**（チェックした項目のみ）。
   使用中パターン（assignments/workablePatternIds/rules が参照）は削除不可と表示。
4. 反映: `writeBatch`（500件で分割）。ドキュメントIDは既存維持・新規は autoId。
- 対象は常に選択中施設のみ。settings/schedules の取込は「施設情報」「勤務実績」シート分のみ。

---

## 9. P8: 週表示（保留継続）

着手指示があった場合: `ShiftGridPage` に 月/週トグル、週は7日分を広セル（名称+時刻表示）で表示、
印刷は A4縦。データ・ロジック変更は一切不要（表示だけ）。それまでは feature-parity 上 ⏳ のまま。

---

## 10. 横展開（複数施設）観点の確認

新規設計は不要。既存構造で成立していることの確認のみ:
- 施設追加 = `facilities/{newId}` 作成 + `users` の `facilityIds` に追加（施設2つ目から選択画面が自動で出る）。
- 全データ・設定・生成は施設サブコレクション内で完結。ルールも施設単位で既に分離済み。
- 新施設の初期投入は P7 の Excel テンプレートが担う（これが横展開の実務手順になる）。
- 法人横断ビュー / orgAdmin / 職員個人ログインは将来フェーズ（firestore-design §6 の案A→B移行手順どおり）。

---

## 11. 実装セッション向けメモ

- 既知の落とし穴: Firestore の orderBy は対象フィールド未設定のドキュメントを**除外**する
  （rules で踏んだ）。新クエリは equality where のみ + JS側ソートを基本とする。
- `settings/*` 読取は「未作成 = 全null既定」を返すヘルパーに寄せ、画面/エンジンに null 分岐を散らさない。
- checkMonth のシグネチャ変更は S1 の1回のみ。以後のフェーズで入力を増やさないこと
  （必要になったら設計に戻る）。
- 生成エンジンのファイルは React/Firestore を import しない（レビュー時に import 文で機械的に確認できる）。
- 各フェーズの動作確認はユーザーの手動テスト（パスワード入力を伴うため）。確認項目リストを毎回提示する。
- コミットメッセージは日本語・フェーズ名先頭の既存慣例を踏襲。
