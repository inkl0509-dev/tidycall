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
  apiKey: "AIzaSyBiF6dsXgyub1s6btEeJ2OjCu7BrYSnlwU",
  authDomain: "tidycall-c71a5.firebaseapp.com",
  projectId: "tidycall-c71a5",
  storageBucket: "tidycall-c71a5.firebasestorage.app",
  messagingSenderId: "392776359379",
  appId: "1:392776359379:web:b0e04bac75290a2565a326",
  measurementId: "G-HQMCW4TY1Y"
};

self.VAPID_KEY = "BOgqobInrEXuaSwN02siidOcCLvFbDEg5Zvg5vcz5V8xSiuAQGrobpD__DpROCnGdzV-jmDpBQeTXbUpy_rOYDM";

// Name shown in the app header and notifications.
self.APP_NAME = "TidyCall";
