/**
 * 自動シフト生成の初期係数。旧HTML版（legacy-html-analysis.md §3）の数値を
 * 「v1」として凍結したもの。業務ルールではなく調整可能なパラメータ
 * （docs/firestore-design.md §4-3・§9）。
 *
 * facilities/{fid}/settings/generationConfig ドキュメントが存在すれば、
 * mergeGenerationConfig() でフィールド単位に上書きする。編集UIは当面作らない
 * （必要になれば Firestore コンソールで直接編集）。
 */

export interface GenerationProfile {
  key: string
  label: string
  weights: {
    fair: number
    comp: number
    wish: number
    soft: number
    interval: number
    spread: number
  }
}

export interface GenerationConfig {
  profiles: GenerationProfile[]
  score: {
    fair: { workdaySd: number; nightTargetDev: number; weekendSd: number; typeFairDev: number }
    comp: { double: number; caution: number; x: number }
    interval: { penaltyPerHour: number }
    spread: { overallWeight: number; typeWeight: number; overallK: number; typeK: number }
  }
  engine: {
    hillClimbMs: number
    repairMaxIter: number
    /** repair 全体（repairGroups含む）の実時間上限(ms)。反復回数の上限だけでは
     *  条件を満たせないデータで1反復が高コストになり得るため、体感フリーズを防ぐ安全弁 */
    repairMaxMs: number
    groupRepairMaxIter: number
    groupRepairMaxMs: number
    nightPickTopN: number
    dayPickTopN: number
    typeCountWeight: number
    restPenalty: number
  }
}

export const GENERATION_DEFAULTS_V1: GenerationConfig = {
  profiles: [
    {
      key: 'fairness',
      label: '案A 公平性重視',
      weights: { fair: 40, comp: 20, wish: 25, soft: 15, interval: 15, spread: 15 },
    },
    {
      key: 'compat',
      label: '案B 相性重視',
      weights: { fair: 20, comp: 40, wish: 25, soft: 15, interval: 15, spread: 15 },
    },
    {
      key: 'leave',
      label: '案C 希望休優先',
      weights: { fair: 20, comp: 15, wish: 50, soft: 15, interval: 15, spread: 15 },
    },
  ],
  score: {
    fair: { workdaySd: 10, nightTargetDev: 12, weekendSd: 8, typeFairDev: 7 },
    comp: { double: 2, caution: -2, x: -6 },
    interval: { penaltyPerHour: 18 },
    spread: { overallWeight: 0.5, typeWeight: 0.5, overallK: 60, typeK: 35 },
  },
  engine: {
    hillClimbMs: 800,
    repairMaxIter: 400,
    repairMaxMs: 1500,
    groupRepairMaxIter: 100,
    groupRepairMaxMs: 500,
    nightPickTopN: 2,
    dayPickTopN: 3,
    typeCountWeight: 0.8,
    restPenalty: 3,
  },
}

/** settings/generationConfig の中身（部分的でよい）。フィールド単位でデフォルトに上書きする */
export type GenerationConfigOverride = {
  profiles?: GenerationProfile[]
  score?: Partial<{
    fair: Partial<GenerationConfig['score']['fair']>
    comp: Partial<GenerationConfig['score']['comp']>
    interval: Partial<GenerationConfig['score']['interval']>
    spread: Partial<GenerationConfig['score']['spread']>
  }>
  engine?: Partial<GenerationConfig['engine']>
}

export function mergeGenerationConfig(
  override: GenerationConfigOverride | null | undefined,
): GenerationConfig {
  if (!override) return GENERATION_DEFAULTS_V1
  return {
    // profiles は配列まるごと上書き（重みの一部だけ差し替える運用は想定しない）
    profiles: override.profiles ?? GENERATION_DEFAULTS_V1.profiles,
    score: {
      fair: { ...GENERATION_DEFAULTS_V1.score.fair, ...override.score?.fair },
      comp: { ...GENERATION_DEFAULTS_V1.score.comp, ...override.score?.comp },
      interval: { ...GENERATION_DEFAULTS_V1.score.interval, ...override.score?.interval },
      spread: { ...GENERATION_DEFAULTS_V1.score.spread, ...override.score?.spread },
    },
    engine: { ...GENERATION_DEFAULTS_V1.engine, ...override.engine },
  }
}
