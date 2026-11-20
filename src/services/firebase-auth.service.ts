import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";

import { firebaseAuth } from "../config/firebase.js";

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

  if (req.method !== "GET" && req.firebaseUser.isForTesting === true) {
    res.status(403).json({ error: "Testing users cannot modify data" });
    return;
  }

  next();
};

export async function verifyFirebaseIdToken(
  token: string,
): Promise<DecodedIdToken> {
  return firebaseAuth.verifyIdToken(token);
}
