// Copy this file to firebase-config.js and add your Firebase Web App config.
// NEVER commit private server credentials, service-account JSON, or API secrets.
// Firebase Web App configuration values are client identifiers, but your Firestore
// Security Rules must still protect user data.

window.firebaseConfig = {
  apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.firebasestorage.app',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_FIREBASE_APP_ID'
};
