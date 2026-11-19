import { CircleCheck, Sparkles, TriangleAlert } from 'lucide-react'
import type { Candidate, ScoreKey } from '../../domain/scheduler/types'
import { bestScoreByKey, pickRecommendedId, recommendReason } from './candidateCompare'

type CandidateWithId = Candidate & { id: string }

interface Props {
  candidates: CandidateWithId[]
  previewId: string | null
  adoptingId: string | null
  /** 新しい案を作成中は採択させない（作成中も画面を操作できるようになったため。§21 B1） */
  generating?: boolean
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

const SCORE_KEYS = Object.keys(SCORE_LABELS) as ScoreKey[]

/**
 * 自動生成された3案を横並びのカードで比較表示する（Phase 4e）。
 * 「プレビュー」で ShiftGridPage 側の previewId を切り替え、「採択する」で確定する。
 * 改善指示書 D5（remaining-work-design.md §28）: 6つの点数を横棒にし、3案の中でいちばん高い項目を濃い色に。
 * 「おすすめ」の理由を1行で出し、必須違反は開くと全件見られる
 */
export default function CandidatesPanel({ candidates, previewId, adoptingId, generating = false, onPreview, onAdopt }: Props) {
  if (candidates.length === 0) return null
  const recommendedId = pickRecommendedId(candidates)
  const reason = recommendReason(candidates, recommendedId)
  const best = bestScoreByKey(candidates, SCORE_KEYS)

  return (
    <div className="candidates-panel no-print">
      {candidates.map((c) => (
        <div
          key={c.id}
          className={`candidate-card${c.id === previewId ? ' previewing' : ''}${c.id === recommendedId ? ' recommended' : ''}`}
        >
          <div className="candidate-card-head">
            <span className="candidate-label">{c.label}</span>
            {c.id === recommendedId && <span className="badge recommend">おすすめ</span>}
          </div>
          {c.id === recommendedId && reason && (
            <p className="candidate-reason">
              <Sparkles className="ico" size={14} aria-hidden="true" />
              {reason}
            </p>
          )}

          <div className="candidate-total">
            <span className="candidate-total-num">{c.scores.total}</span>
            <span className="muted"> / 100</span>
          </div>
          <div className="candidate-fulfillment">充足率 {Math.round(c.fulfillmentRate)}%</div>

          <div className="candidate-bars" aria-label="6つの観点の点数（100点満点）">
            {SCORE_KEYS.map((key) => {
              const v = Math.max(0, Math.min(100, c.scores[key]))
              const isBest = candidates.length > 1 && c.scores[key] === best[key]
              return (
                <div key={key} className={`candidate-bar-row${isBest ? ' best' : ''}`}>
                  <span className="candidate-bar-label">{SCORE_LABELS[key]}</span>
                  <span className="candidate-bar-track" aria-hidden="true">
                    <span className="candidate-bar-fill" style={{ width: `${v}%` }} />
                  </span>
                  <span className="candidate-bar-value">{c.scores[key]}</span>
                </div>
              )
            })}
          </div>

          <div className="candidate-violations">
            {c.hardCount > 0 ? (
              <details className="candidate-violation-list">
                <summary className="warn">
                  <TriangleAlert className="ico" size={16} aria-hidden="true" />
                  必須違反 {c.hardCount}件
                  <span className="candidate-violation-open">（開いて全件を見る）</span>
                </summary>
                <ul>
                  {c.hardViolations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="ok">
                <CircleCheck className="ico" size={16} aria-hidden="true" />
                必須違反なし
              </p>
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
              disabled={adoptingId !== null || generating}
              title={generating ? '新しい案を作成中です。作成が終わるか中止してから採択してください' : undefined}
            >
              {adoptingId === c.id ? '採択中…' : '採択する'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
