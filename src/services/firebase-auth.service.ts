import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import type {
  DocumentReference,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { firebaseAuth, firestoreDB } from "../config/firebase.js";

export const firebaseAuthMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authorization: string | undefined = req.get("authorization");
  const token: string | undefined =
    authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    req.firebaseUser = await verifyFirebaseIdToken(token);
  } catch (error) {
    console.error("Failed to verify Firebase ID token:", error);
    res.status(401).json({ error: "Invalid authentication token" });
    return;
  }

  if (req.method !== "GET") {
    try {
      if (await isTestingUser(req.firebaseUser.uid)) {
        res.status(403).json({ error: "Testing users cannot modify data" });
        return;
      }
    } catch (error) {
      console.error("Failed to check testing status for Firebase user:", error);
      res.status(500).json({ error: "Failed to verify user permissions" });
      return;
    }
  }

  next();
};

export async function verifyFirebaseIdToken(
  token: string,
): Promise<DecodedIdToken> {
  return firebaseAuth.verifyIdToken(token);
}

async function isTestingUser(userId: string): Promise<boolean> {
  const stores = await firestoreDB.collection("stores").get();
  if (stores.empty) {
    return false;
  }

  const userDocuments = await firestoreDB.getAll(
    ...stores.docs.map((store: QueryDocumentSnapshot): DocumentReference =>
      store.ref.collection("users").doc(userId),
    ),
  );
  return userDocuments.some(
    (userDocument: DocumentSnapshot): boolean =>
      userDocument.exists && userDocument.get("isForTesting") === true,
  );
}
