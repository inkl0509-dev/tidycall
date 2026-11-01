/*
 * STEP 1 OF SETUP — paste your Firebase web settings here.
 *
 * Firebase console → Project settings (gear icon) → General → "Your apps" → Web app → SDK setup and configuration → Config.
 * Copy only the values inside { } into FIREBASE_CONFIG below.
 *
 * VAPID_KEY: Project settings → Cloud Messaging → Web configuration → Web Push certificates → Generate key pair → copy the key.
 *
 * These values are not secret; it is normal for them to be public.
 */
self.FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

self.VAPID_KEY = "PASTE_WEB_PUSH_KEY";

// Name shown in the app header and notifications.
self.APP_NAME = "TidyCall";
