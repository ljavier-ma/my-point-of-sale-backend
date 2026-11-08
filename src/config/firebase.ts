import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountPath = process.env.FIREBASE_PRIVATE_KEY_PATH;

const firebaseApp = serviceAccountPath
  ? initializeApp({ credential: cert(serviceAccountPath) })
  : initializeApp();

export const firestoreDB = getFirestore(firebaseApp);
export const firebaseAuth = getAuth(firebaseApp);
