import type { Request, RequestHandler, Response } from "express";

import type { UserResponse } from "../types/user.js";

import { firestoreDB } from "../config/firebase.js";
import { getAuthenticatedUserId } from "../utils/auth.js";

function isUserData(value: unknown): value is Omit<UserResponse, "id"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof value.email === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

export const userMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const stores = await firestoreDB.collection("stores").get();
    if (stores.empty) {
      res.status(404).json({ error: "No user found" });
      return;
    }

    const userDocuments = await firestoreDB.getAll(
      ...stores.docs.map((store) => store.ref.collection("users").doc(userId)),
    );
    const userDocumentIndex = userDocuments.findIndex(
      (userDocument) => userDocument.exists,
    );

    if (userDocumentIndex === -1) {
      res.status(404).json({ error: "No user found" });
      return;
    }

    const userDocument = userDocuments[userDocumentIndex];
    const userData: unknown = userDocument.data();
    if (!isUserData(userData)) {
      console.error(
        "User document is missing a valid email or name:",
        userDocument.id,
      );
      res.status(500).json({ error: "Failed to fetch user" });
      return;
    }

    const response: UserResponse = {
      email: userData.email,
      id: userDocument.id,
      name: userData.name,
    };
    res.json(response);
  } catch (error) {
    console.error(
      "Failed to fetch the user's information from Firestore:",
      error,
    );
    res.status(500).json({ error: "Failed to fetch user" });
  }
};
