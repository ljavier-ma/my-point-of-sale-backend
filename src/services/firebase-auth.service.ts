import type { RequestHandler } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";

import { firebaseAuth } from "../config/firebase.js";

export const firebaseAuthMiddleware: RequestHandler = async (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

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

  next();
};

export async function verifyFirebaseIdToken(
  token: string,
): Promise<DecodedIdToken> {
  return firebaseAuth.verifyIdToken(token);
}
