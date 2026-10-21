/**
 * 岐阜市「勤務形態一覧表」（参考様式10・令和8年7月版）のサービス種別と、ひな形のシート名の対応。
 * 種別の名称は様式の「選択肢」シートのとおり（INDIRECT で職種の選択肢を引くため、表記を変えない）。
 */
export const SUBMISSION_TEMPLATE_URL = '/forms/gifu_kinmu_r80721.xlsx'
export const SUBMISSION_TEMPLATE_LABEL = '岐阜市 参考様式10（令和8年7月版）'

export const SERVICE_TYPES: { label: string; sheet: string }[] = [
  { label: '居宅介護', sheet: '勤務形態一覧表（居宅介護）' },
  { label: '重度訪問介護', sheet: '勤務形態一覧表（重度訪問介護）' },
  { label: '同行援護', sheet: '勤務形態一覧表（同行援護）' },
  { label: '行動援護', sheet: '勤務形態一覧表（行動援護）' },
  { label: '療養介護', sheet: '勤務形態一覧表（療養介護）' },
  { label: '生活介護', sheet: '勤務形態一覧表（生活介護）' },
  { label: '機能訓練', sheet: '勤務形態一覧表（機能訓練）' },
  { label: '生活訓練', sheet: '勤務形態一覧表（生活訓練）' },
  { label: '就労移行支援', sheet: '勤務形態一覧表（就労移行支援）' },
  { label: '認定指定就労移行支援', sheet: '勤務形態一覧表（認定指定就労移行支援）' },
  { label: '就労継続支援Ａ型・Ｂ型', sheet: '勤務形態一覧表（就労継続支援A型・B型）' },
  { label: '就労定着支援', sheet: '勤務形態一覧表（就労定着支援）' },
  { label: '自立生活援助', sheet: '勤務形態一覧表（自立生活援助）' },
  { label: '共同生活援助・介護サービス包括型', sheet: '勤務形態一覧表（共同生活援助・介護サービス包括型）' },
  { label: '共同生活援助・外部サービス利用型', sheet: '勤務形態一覧表（共同生活援助・外部サービス利用型）' },
  // ひな形のシート名は閉じ括弧が欠けている（31文字の上限）
  { label: '共同生活援助・日中サービス支援型', sheet: '勤務形態一覧表（共同生活援助・日中サービス支援型' },
  { label: '障害者支援施設', sheet: '勤務形態一覧表（障害者支援施設）' },
  { label: '一般相談支援事業', sheet: '勤務形態一覧表（一般相談支援）' },
  { label: '特定相談支援・障害児相談支援', sheet: '勤務形態一覧（特定相談支援・障害児相談支援）' },
]

/**
 * 画面に出すときの表記。法人・岐阜市の表記に合わせて「障害」を「障がい」にする。
 * 持っている値は様式の選択肢の名称（「障害」）のまま変えない（シート名・職種の選択肢がこの表記で作られているため）
 */
export function displayServiceType(label: string | undefined): string {
  return (label ?? '').replace(/障害/g, '障がい')
}

export function sheetForServiceType(label: string | undefined): string | null {
  return SERVICE_TYPES.find((t) => t.label === label)?.sheet ?? null
}

/** 様式の注意書き「職種ごとにまとめて記入」に合わせた並び順（ここに無い職種は後ろに、出てきた順で並べる） */
export const JOB_TITLE_ORDER = [
  '管理者',
  'サービス管理責任者',
  'サービス提供責任者',
  '医師',
  '看護職員',
  '理学療法士',
  '作業療法士',
  '言語聴覚士',
  '就労支援員',
  '職業指導員',
  '世話人',
  '生活支援員',
  '夜間支援従事者',
  'その他職員',
]
