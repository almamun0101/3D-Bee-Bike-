import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Root node in Realtime Database that holds orders + settings.
export const DB_ROOT = process.env.NEXT_PUBLIC_DB_ROOT || "3dbee v2";
export const REQUIRE_LOGIN = process.env.NEXT_PUBLIC_REQUIRE_LOGIN !== "false";

// Lazy getters so the app can be built/exported without env vars present.
const REQUIRED_CONFIG = ["apiKey", "authDomain", "databaseURL", "projectId", "appId"];
export const getFirebaseConfigError = () => {
  const missing = REQUIRED_CONFIG.filter(key => !firebaseConfig[key] || String(firebaseConfig[key]).startsWith("your_"));
  return missing.length
    ? `Firebase is not configured. Missing environment values: ${missing.map(k => `NEXT_PUBLIC_FIREBASE_${k.replace(/[A-Z]/g, c => "_" + c).toUpperCase()}`).join(", ")}. Add them in Netlify → Site configuration → Environment variables, then trigger a new deploy.`
    : "";
};

const getFirebaseApp = () => {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
};
export const getDb = () => getDatabase(getFirebaseApp());
export const getAuthInstance = () => getAuth(getFirebaseApp());
