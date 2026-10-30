import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccountPath = process.env.FIREBASE_PRIVATE_KEY_PATH;

if (!serviceAccountPath) {
  throw new Error(
    "FIREBASE_PRIVATE_KEY_PATH must point to a Firebase service account JSON file",
  );
}

const firebaseApp = initializeApp({
  credential: cert(serviceAccountPath),
});

export const firestoreDB = getFirestore(firebaseApp);
export const firebaseAuth = getAuth(firebaseApp);
