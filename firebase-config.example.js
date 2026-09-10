// Firebase Web config example.
// Keep real client config in firebase-config.js only when needed by the site.
// Never commit service-account JSON/private keys or server-side secrets.
// Firebase Web API keys are client identifiers; protect the project with Auth,
// Firestore Security Rules, and API-key application/API restrictions.
window.firebaseConfig = {
  apiKey: "YOUR_FIREBASE_WEB_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
