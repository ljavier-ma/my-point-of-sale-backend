import type { RequestHandler } from "express";

import { firebaseAuth } from "../config/firebase.js";
import { isTestingUser } from "../services/firebase-auth.service.js";

const testAccountEmail = "javier.dev.contact@gmail.com";

export const testLoginMiddleware: RequestHandler = async (
  _req,
  res,
): Promise<void> => {
  try {
    const user = await firebaseAuth.getUserByEmail(testAccountEmail);
    if (user.disabled || !(await isTestingUser(user.uid))) {
      res.status(403).json({ error: "Test account is not available" });
      return;
    }

    const token = await firebaseAuth.createCustomToken(user.uid);
    res.json({ token });
  } catch (error) {
    console.error(
      "Failed to create a Firebase token for the test account:",
      error,
    );
    res.status(500).json({ error: "Failed to start test session" });
  }
};
