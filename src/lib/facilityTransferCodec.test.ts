import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  countDocs,
  decodeDoc,
  encodeDoc,
  parseTransferFile,
  planImport,
  type FacilityTransferFile,
} from './facilityTransferCodec'

/** 書き出し → JSON文字列 → 読み込み の往復（実際のダウンロード・アップロードと同じ経路） */
function roundTrip(file: FacilityTransferFile) {
  return parseTransferFile(JSON.stringify(file))
}

function makeFile(collections: Partial<FacilityTransferFile['collections']> = {}): FacilityTransferFile {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: '2026-09-24T12:00:00.000Z',
    sourceProjectId: 'kaigo-shift-saas',
    facility: { id: 'fac1', name: 'アミティホーム寺田' },
    collections: {
      jobTypes: {},
      employmentTypes: {},
      shiftPatterns: {},
      staff: {},
      rules: {},
      compatibilities: {},
      settings: {},
      schedules: {},
      leaveRequests: {},
      ...collections,
    },
  }
}

describe('日時（Timestamp）の書き出しと読み込み', () => {
  it('入れ子の中の日時も、書き出して読み込むと同じ日時に戻る', () => {
    const at = new Timestamp(1790000000, 123000000)
    const schedule = {
      yearMonth: '2026-09',
      updatedAt: at,
      generationMeta: { source: 'auto', generatedAt: at, candidateId: null },
      locks: { kato: { '1': true } },
    }
    const file = roundTrip(makeFile({ schedules: { '2026-09': encodeDoc(schedule) } }))
    const back = decodeDoc(file.collections.schedules['2026-09'])

    expect(back.updatedAt).toBeInstanceOf(Timestamp)
    expect((back.updatedAt as Timestamp).isEqual(at)).toBe(true)
    expect(((back.generationMeta as Record<string, unknown>).generatedAt as Timestamp).isEqual(at)).toBe(true)
    expect(back.locks).toEqual({ kato: { '1': true } })
  })

  it('配列・null・真偽値・数値はそのまま往復する', () => {
    const staff = { name: '加藤', jobTypeIds: ['care', 'night'], linked: null, active: true, order: 3 }
    const file = roundTrip(makeFile({ staff: { s1: encodeDoc(staff) } }))
    expect(decodeDoc(file.collections.staff.s1)).toEqual(staff)
  })

  it('対応していない種類の値があれば、黙って壊さずに書き出しを止める', () => {
    expect(() => encodeDoc({ when: new Date() })).toThrow('書き出せない種類の値')
    expect(() => encodeDoc({ n: Number.NaN })).toThrow('書き出せない数値')
  })
})

describe('ファイルの検証', () => {
  it('施設データのファイルでなければ、分かる言葉で止める', () => {
    expect(() => parseTransferFile('これはJSONではない')).toThrow('ファイルを読み取れませんでした')
    expect(() => parseTransferFile(JSON.stringify({ hello: 1 }))).toThrow('施設データのファイルではありません')
    expect(() => parseTransferFile(JSON.stringify({ ...makeFile(), version: 99 }))).toThrow('対応していません')
    expect(() => parseTransferFile(JSON.stringify({ ...makeFile(), facility: {} }))).toThrow('施設の情報がありません')
  })

  it('コレクションの中身が文書の形でなければ止める', () => {
    const broken = { ...makeFile(), collections: { staff: { s1: 'いち' } } }
    expect(() => parseTransferFile(JSON.stringify(broken))).toThrow('「職員」の形式が正しくありません')
  })

  it('ファイルに無いコレクションは0件として扱い、対象外の名前は無視する', () => {
    const partial = { ...makeFile(), collections: { staff: { s1: { name: '森本' } }, users: { u1: { role: 'admin' } } } }
    const file = parseTransferFile(JSON.stringify(partial))
    expect(countDocs(file).staff).toBe(1)
    expect(countDocs(file).rules).toBe(0)
    expect(file.collections).not.toHaveProperty('users')
  })
})

describe('planImport: 読み込み後はファイルと同じ状態になる', () => {
  it('ファイルにある文書は書き込み、読み込み先にしか無い文書は削除する', () => {
    const file = makeFile({ staff: { s1: { name: '加藤' }, s2: { name: '森本' } } })
    const plan = planImport(file, { staff: ['s2', 'old'], rules: ['r9'] })

    expect(plan.writes.map((w) => `${w.collection}/${w.id}`).sort()).toEqual(['staff/s1', 'staff/s2'])
    expect(plan.deletes.map((d) => `${d.collection}/${d.id}`).sort()).toEqual(['rules/r9', 'staff/old'])
  })

  it('書き込む中身は日時を元の型に戻したもの', () => {
    const at = new Timestamp(1790000000, 0)
    const file = roundTrip(makeFile({ schedules: { '2026-09': encodeDoc({ updatedAt: at }) } }))
    const [write] = planImport(file, {}).writes
    expect((write.data.updatedAt as Timestamp).isEqual(at)).toBe(true)
  })
})
