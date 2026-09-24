/**
 * アプリアイコン（PWA・ファビコン）の PNG を生成する。
 *
 * 図案（下の ART）がアイコンの正本。アプリと同じ丸文字フォント（M PLUS Rounded 1c）で描くため、
 * 手元の Chrome を画面なし（headless）で起動してスクリーンショットを撮る方式にしている（npm の追加依存なし）。
 * 図案を直したら `npm run icons` で public/ 以下の PNG を作り直してコミットする。
 * Chrome の場所が違う PC では環境変数 CHROME_PATH で指定する。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const BG = '#0c4a3b'
const FONT = "'M PLUS Rounded 1c', sans-serif"

/** 図案（背景を除いた中身）。512×512 の座標で描く。案2「カレンダー＋文字」（2026-09-24 ユーザー選定） */
const ART = `
<rect x="160" y="96" width="192" height="176" rx="28" fill="#fbfaf7"/>
<path d="M160 124a28 28 0 0 1 28-28h136a28 28 0 0 1 28 28v18H160z" fill="#1d7a63"/>
<rect x="206" y="76" width="18" height="44" rx="9" fill="#fbfaf7"/>
<rect x="288" y="76" width="18" height="44" rx="9" fill="#fbfaf7"/>
<rect x="184" y="160" width="40" height="40" rx="10" fill="#cfe9df"/>
<rect x="236" y="160" width="40" height="40" rx="10" fill="#cfe9df"/>
<rect x="288" y="160" width="40" height="40" rx="10" fill="#c9971f"/>
<rect x="184" y="212" width="40" height="40" rx="10" fill="#cfe9df"/>
<rect x="236" y="212" width="40" height="40" rx="10" fill="#1d7a63"/>
<rect x="288" y="212" width="40" height="40" rx="10" fill="#cfe9df"/>
<text x="256" y="360" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="64" fill="#fbfaf7" letter-spacing="1">SHIFT</text>
<text x="256" y="428" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="64" fill="#fbfaf7" letter-spacing="1">MAKER</text>
`

/** 角丸の背景（パソコンのデスクトップ・ファビコン用。角は透明） */
const rounded = () => `<rect width="512" height="512" rx="112" fill="${BG}"/>${ART}`

/**
 * 四角いっぱいの背景（Android の maskable・iPhone のホーム画面用）。OS 側が丸や角丸に切り抜くので、
 * 中身を縮めて切り抜かれても欠けない範囲（中心から半径40%の円）に収める
 */
const fullBleed = (scale) =>
  `<rect width="512" height="512" fill="${BG}"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${ART}</g>`

const OUTPUTS = [
  { file: 'icons/icon-192.png', size: 192, body: rounded() },
  { file: 'icons/icon-512.png', size: 512, body: rounded() },
  { file: 'icons/maskable-512.png', size: 512, body: fullBleed(0.8) },
  { file: 'apple-touch-icon.png', size: 180, body: fullBleed(0.9) },
  { file: 'favicon-32.png', size: 32, body: rounded() },
  { file: 'favicon-16.png', size: 16, body: rounded() },
]

const work = mkdtempSync(join(tmpdir(), 'shift-icons-'))
try {
  for (const { file, size, body } of OUTPUTS) {
    const html = join(work, `${size}-${file.replace(/[\\/]/g, '_')}.html`)
    writeFileSync(
      html,
      `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800&display=block" rel="stylesheet">
<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style></head>
<body><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${body}</svg></body></html>`,
    )
    const out = join(publicDir, file)
    mkdirSync(dirname(out), { recursive: true })
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${join(work, 'profile')}`, // 普段使いの Chrome のプロフィールには触れない
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      '--virtual-time-budget=10000', // Web フォントの読み込みを待ってから撮る
      `--screenshot=${out}`,
      pathToFileURL(html).href,
    ], { stdio: 'ignore' })
    console.log(`${file} (${size}px, ${statSync(out).size} bytes)`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
