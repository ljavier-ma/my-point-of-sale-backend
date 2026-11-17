import type {
  ParamsDictionary,
  Request,
  RequestHandler,
  Response,
} from "express-serve-static-core";

import type {
  StoreErrorResponse,
  StoreResponse,
  StoreUpdateRequest,
} from "../types/store.js";

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

function isStoreUpdateRequest(value: unknown): value is StoreUpdateRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2
  ) {
    return false;
  }

  const data = value as Record<string, unknown>;
  if (
    !Object.hasOwn(data, "name") ||
    !Object.hasOwn(data, "settings") ||
    typeof data.name !== "string" ||
    data.name.trim().length === 0
  ) {
    return false;
  }

  const settings: unknown = data.settings;
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings) ||
    Object.keys(settings).length !== 2
  ) {
    return false;
  }

  const settingsData = settings as Record<string, unknown>;
  return (
    Object.hasOwn(settingsData, "idealPercentageOfProduct") &&
    typeof settingsData.idealPercentageOfProduct === "number" &&
    Number.isFinite(settingsData.idealPercentageOfProduct) &&
    settingsData.idealPercentageOfProduct >= 0 &&
    settingsData.idealPercentageOfProduct < 100 &&
    Object.hasOwn(settingsData, "lowPercentageOfProduct") &&
    typeof settingsData.lowPercentageOfProduct === "number" &&
    Number.isFinite(settingsData.lowPercentageOfProduct) &&
    settingsData.lowPercentageOfProduct >= 0 &&
    settingsData.lowPercentageOfProduct < 100 &&
    settingsData.idealPercentageOfProduct > settingsData.lowPercentageOfProduct
  );
}

export const storeMiddleware: RequestHandler<
  ParamsDictionary,
  StoreErrorResponse | StoreResponse,
  unknown
> = async (
  req: Request<ParamsDictionary, StoreErrorResponse | StoreResponse, unknown>,
  res: Response<StoreErrorResponse | StoreResponse>,
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

export const updateStoreMiddleware: RequestHandler<
  ParamsDictionary,
  StoreErrorResponse | StoreResponse,
  unknown
> = async (
  req: Request<ParamsDictionary, StoreErrorResponse | StoreResponse, unknown>,
  res: Response<StoreErrorResponse | StoreResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!isStoreUpdateRequest(req.body)) {
    res.status(400).json({ error: "Invalid store data" });
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
    await store.ref.update({
      name: req.body.name,
      settings: req.body.settings,
    });

    res.json({
      id: store.id,
      name: req.body.name,
      settings: req.body.settings,
    });
  } catch (error) {
    console.error("Failed to update the user's store in Firestore:", error);
    res.status(500).json({ error: "Failed to update store" });
  }
};
