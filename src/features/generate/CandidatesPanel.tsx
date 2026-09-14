import type { Candidate, ScoreKey } from '../../domain/scheduler/types'

type CandidateWithId = Candidate & { id: string }

interface Props {
  candidates: CandidateWithId[]
  previewId: string | null
  adoptingId: string | null
  onPreview: (id: string) => void
  onAdopt: (candidate: CandidateWithId) => void
}

const SCORE_LABELS: Record<ScoreKey, string> = {
  fair: '公平',
  comp: '相性',
  wish: '希望休',
  soft: '推奨',
  interval: '休息',
  spread: '偏り',
}

/** hardCount が最も少なく、同数なら total が最も高い案を「おすすめ」とする */
function pickRecommendedId(candidates: CandidateWithId[]): string | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => {
    if (c.hardCount < best.hardCount) return c
    if (c.hardCount === best.hardCount && c.scores.total > best.scores.total) return c
    return best
  }, candidates[0]).id
}

/**
 * 自動生成された3案を横並びのカードで比較表示する（Phase 4e）。
 * 「プレビュー」で ShiftGridPage 側の previewId を切り替え、「採択する」で確定する。
 */
export default function CandidatesPanel({ candidates, previewId, adoptingId, onPreview, onAdopt }: Props) {
  if (candidates.length === 0) return null
  const recommendedId = pickRecommendedId(candidates)

  return (
    <div className="candidates-panel no-print">
      {candidates.map((c) => (
        <div key={c.id} className={`candidate-card${c.id === previewId ? ' previewing' : ''}`}>
          <div className="candidate-card-head">
            <span className="candidate-label">{c.label}</span>
            {c.id === recommendedId && <span className="badge recommend">おすすめ</span>}
          </div>

          <div className="candidate-total">
            <span className="candidate-total-num">{c.scores.total}</span>
            <span className="muted"> / 100</span>
          </div>
          <div className="candidate-fulfillment">充足率 {Math.round(c.fulfillmentRate)}%</div>

          <div className="candidate-scores">
            {(Object.keys(SCORE_LABELS) as ScoreKey[]).map((key) => (
              <div key={key} className="candidate-score-item">
                <span className="muted">{SCORE_LABELS[key]}</span>
                <span>{c.scores[key]}</span>
              </div>
            ))}
          </div>

          <div className="candidate-violations">
            {c.hardCount > 0 ? (
              <p className="warn">
                ⚠ 必須違反 {c.hardCount}件
                {c.hardViolations[0] && <span className="candidate-violation-detail">{c.hardViolations[0]}</span>}
              </p>
            ) : (
              <p className="ok">必須違反なし</p>
            )}
            {c.softCount > 0 && <p className="muted">推奨未達 {c.softCount}件</p>}
          </div>

          <div className="candidate-actions">
            <button type="button" onClick={() => onPreview(c.id)} disabled={adoptingId === c.id}>
              {c.id === previewId ? 'プレビュー中' : 'プレビュー'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => onAdopt(c)}
              disabled={adoptingId !== null}
            >
              {adoptingId === c.id ? '採択中…' : '採択する'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
