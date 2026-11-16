import type { Request, RequestHandler, Response } from "express";

import type { StoreResponse } from "../types/store.js";

import { firestoreDB } from "../config/firebase.js";
import { getAuthenticatedUserId } from "../utils/auth.js";

function isStoreResponse(value: unknown): value is StoreResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "settings" in value &&
    typeof value.settings === "object" &&
    value.settings !== null &&
    "idealPercentageOfProduct" in value.settings &&
    typeof value.settings.idealPercentageOfProduct === "number" &&
    "lowPercentageOfProduct" in value.settings &&
    typeof value.settings.lowPercentageOfProduct === "number"
  );
}

export const storeMiddleware: RequestHandler = async (
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
    const storeData: unknown = store.data();
    const storeName: unknown =
      typeof storeData === "object" && storeData !== null && "name" in storeData
        ? storeData.name
        : undefined;
    const storeSettings: unknown =
      typeof storeData === "object" &&
      storeData !== null &&
      "settings" in storeData
        ? storeData.settings
        : undefined;
    const response: unknown = {
      id: store.id,
      name: storeName,
      settings: storeSettings,
    };
    if (!isStoreResponse(response)) {
      console.error(
        "Store document is missing valid id, name, or settings:",
        store.id,
      );
      res.status(500).json({ error: "Failed to fetch store" });
      return;
    }

    res.json(response);
  } catch (error) {
    console.error("Failed to fetch the user's store from Firestore:", error);
    res.status(500).json({ error: "Failed to fetch store" });
  }
};
