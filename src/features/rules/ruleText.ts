import type { Rule, RuleDays, RuleTarget } from '../../types/models'
import { WEEKDAY_LABELS } from '../../lib/dateUtils'

export interface RuleTextContext {
  shiftLabel: (id: string) => string
  staffName: (id: string) => string
}

function daysLabel(days: RuleDays): string {
  switch (days.type) {
    case 'all':
      return '毎日'
    case 'weekdays':
      return '平日'
    case 'weekend':
      return '土日'
    case 'dow':
      return (
        ((days.values as number[] | undefined) ?? [])
          .map((v) => WEEKDAY_LABELS[v])
          .join('・') + '曜日'
      )
    case 'dates':
      return ((days.values as string[] | undefined) ?? [])
        .map((v) => v.slice(5).replace('-', '/'))
        .join(', ')
    default:
      return ''
  }
}

function targetLabel(target: RuleTarget, ctx: RuleTextContext): string {
  switch (target.type) {
    case 'shift':
      return ctx.shiftLabel(String(target.value ?? ''))
    case 'qualification':
      return `資格「${target.value ?? ''}」`
    case 'trait':
      return `タグ「${target.value ?? ''}」`
    case 'staff':
      return ctx.staffName(String(target.value ?? ''))
    case 'traitPair':
      return `「${target.value ?? ''}」と「${target.value2 ?? ''}」`
    case 'shiftGroup':
      return ((target.value as string[] | undefined) ?? [])
        .map((id) => ctx.shiftLabel(id))
        .join('または')
    default:
      return '?'
  }
}

export function ruleText(rule: Rule, ctx: RuleTextContext): string {
  const dl = daysLabel(rule.days)
  const tl = targetLabel(rule.target, ctx)
  const c = rule.cond
  switch (c.type) {
    case 'exact':
      return `${dl}、${tl}をちょうど${c.count}名配置`
    case 'atLeast':
      return `${dl}、${tl}を${c.count}名以上配置`
    case 'atMost':
      return `${dl}、${tl}は${c.count}名以下`
    case 'none':
      return `${dl}、${tl}は配置しない`
    case 'work':
      return `${dl}、${tl}を必ず勤務させる`
    case 'off':
      return `${dl}、${tl}は勤務させない`
    case 'notTogether':
      return `${dl}、${tl}は同一シフトに入れない`
    case 'together':
      return `${dl}、${tl}を同一シフトに配置する`
    case 'atLeastGroup':
      return `${dl}、${tl}を合計${c.count}名以上配置`
    case 'notTogetherGroup':
      return `${dl}、${tl}は同時に配置しない（どちらか一方のみ）`
    case 'preferShift':
      return `${dl}、${tl}は${ctx.shiftLabel(c.value ?? '')}を優先`
    default:
      return ''
  }
}
