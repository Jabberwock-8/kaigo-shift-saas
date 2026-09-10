/**
 * Firebase 初期化。
 *
 * 接続情報は .env.local（Git管理外）から読み込む。
 * すべて揃っていない間は初期化せず、firebaseStatus.configured = false になる。
 * Phase 0 の App.tsx は「設定済みかどうか」の表示だけに使う。
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const configured = Object.values(config).every(
  (v) => typeof v === 'string' && v.length > 0,
)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

if (configured) {
  app = initializeApp(config as Record<string, string>)
  auth = getAuth(app)
  db = getFirestore(app)
}

export const firebaseStatus = {
  configured,
  projectId: config.projectId ?? null,
}

export { app, auth, db }
