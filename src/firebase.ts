import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

/**
 * Safely parse the Firebase configuration from environment variables.
 * Firebase App Hosting provides FIREBASE_WEBAPP_CONFIG as a JSON string.
 */
const getFirebaseConfig = () => {
  try {
    // import.meta.env.VITE_FIREBASE_CONFIG is defined in vite.config.ts
    const configStr = import.meta.env.VITE_FIREBASE_CONFIG;
    if (configStr) {
      return JSON.parse(configStr);
    }
  } catch (error) {
    console.error('Failed to parse VITE_FIREBASE_CONFIG:', error);
  }

  /**
   * Fallback for local development.
   * You can set these in your .env file with the VITE_ prefix.
   */
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
    firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || '(default)'
  };
};

const firebaseConfig = getFirebaseConfig();

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Initialize Firestore with the specific database ID if provided
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId || '(default)');

export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const signOut = () => auth.signOut();
