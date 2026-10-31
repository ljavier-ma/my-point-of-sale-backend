import type { Request, RequestHandler, Response } from "express";

import { firestoreDB } from "../config/firebase.js";

export const storeMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const userId: string | undefined = req.firebaseUser?.uid;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const stores = await firestoreDB.collection("stores").get();
    const userDocuments = await firestoreDB.getAll(
      ...stores.docs.map((store) => store.ref.collection("users").doc(userId)),
    );
    const storeIndex = userDocuments.findIndex(
      (userDocument) => userDocument.exists,
    );

    if (storeIndex === -1) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const store = stores.docs[storeIndex];
    res.json({ ...store.data(), id: store.id });
  } catch (error) {
    console.error("Failed to fetch the user's store from Firestore:", error);
    res.status(500).json({ error: "Failed to fetch store" });
  }
};
