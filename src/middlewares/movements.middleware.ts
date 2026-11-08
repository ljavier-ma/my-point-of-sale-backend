import type {
  ParamsDictionary,
  Request,
  RequestHandler,
  Response,
} from "express-serve-static-core";
import type {
  DocumentReference,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { Timestamp } from "firebase-admin/firestore";

import type {
  CreateMovementRequest,
  ErrorResponse,
  MovementProductDetail,
  MovementResponse,
  MovementsQuery,
  MovementsResponse,
} from "../types/movement.js";

import { firestoreDB } from "../config/firebase.js";
import { getAuthenticatedUserId } from "../utils/auth.js";

type CreateMovementResult =
  | { movement: MovementResponse; success: true }
  | { reason: "invalid-product-stock" | "product-not-found"; success: false };

function isCreateMovementRequest(
  value: unknown,
): value is CreateMovementRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof data.isMovementAPurchase === "boolean" &&
    Array.isArray(data.productDetails) &&
    data.productDetails.length > 0 &&
    data.productDetails.every(isValidCreateMovementProductDetail)
  );
}

function isMovementData(
  value: unknown,
): value is Pick<
  MovementResponse,
  "isMovementAPurchase" | "productDetails" | "time"
> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof data.isMovementAPurchase === "boolean" &&
    Array.isArray(data.productDetails) &&
    data.productDetails.every(isMovementProductDetail) &&
    Object.hasOwn(data, "time")
  );
}

function isMovementProductDetail(
  value: unknown,
): value is MovementProductDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const detail: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof detail.productTotal === "number" &&
    Number.isFinite(detail.productTotal) &&
    typeof detail.productId === "string" &&
    typeof detail.quantity === "number" &&
    Number.isFinite(detail.quantity)
  );
}

function isValidCreateMovementProductDetail(
  value: unknown,
): value is MovementProductDetail {
  if (!isMovementProductDetail(value)) {
    return false;
  }

  return (
    value.productId.trim().length > 0 &&
    value.productTotal >= 0 &&
    value.quantity >= 0
  );
}

function parsePaginationValue(
  value: string | undefined,
  minimum: number,
): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue >= minimum
    ? parsedValue
    : undefined;
}

export const movementsMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | MovementsResponse,
  unknown,
  MovementsQuery
> = async (
  req: Request<
    ParamsDictionary,
    ErrorResponse | MovementsResponse,
    unknown,
    MovementsQuery
  >,
  res: Response<ErrorResponse | MovementsResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const offset: number | undefined = parsePaginationValue(req.query.offset, 0);
  const limit: number | undefined = parsePaginationValue(req.query.limit, 1);
  if (offset === undefined || limit === undefined) {
    res
      .status(400)
      .json({ error: "Valid offset and limit query parameters are required" });
    return;
  }

  try {
    const stores = await firestoreDB.collection("stores").get();
    if (stores.empty) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const userDocuments = await firestoreDB.getAll(
      ...stores.docs.map((store: QueryDocumentSnapshot): DocumentReference =>
        store.ref.collection("users").doc(userId),
      ),
    );
    const storeIndex: number = userDocuments.findIndex(
      (userDocument: DocumentSnapshot): boolean => userDocument.exists,
    );
    if (storeIndex === -1) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const movementsCollection =
      stores.docs[storeIndex].ref.collection("movements");
    const [movementSnapshot, countSnapshot] = await Promise.all([
      movementsCollection
        .orderBy("time", "desc")
        .offset(offset)
        .limit(limit)
        .get(),
      movementsCollection.count().get(),
    ]);
    const movements: MovementResponse[] = [];
    for (const movementDocument of movementSnapshot.docs) {
      const movementData: unknown = movementDocument.data();
      if (!isMovementData(movementData)) {
        console.error(
          "Movement document is missing valid movement fields:",
          movementDocument.id,
        );
        res.status(500).json({ error: "Failed to fetch movements" });
        return;
      }

      movements.push({
        id: movementDocument.id,
        isMovementAPurchase: movementData.isMovementAPurchase,
        productDetails: movementData.productDetails.map(
          ({ productId, productTotal, quantity }) => ({
            productId,
            productTotal,
            quantity,
          }),
        ),
        time: movementData.time,
      });
    }

    res.json({
      movements,
      totalOfMovements: countSnapshot.data().count,
    });
  } catch (error) {
    console.error("Failed to fetch movements from Firestore:", error);
    res.status(500).json({ error: "Failed to fetch movements" });
  }
};

export const createMovementMiddleware: RequestHandler<
  ParamsDictionary,
  ErrorResponse | MovementResponse,
  unknown
> = async (
  req: Request<ParamsDictionary, ErrorResponse | MovementResponse, unknown>,
  res: Response<ErrorResponse | MovementResponse>,
): Promise<void> => {
  const userId: string | undefined = getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!isCreateMovementRequest(req.body)) {
    res.status(400).json({ error: "Invalid movement data" });
    return;
  }
  const movementData: CreateMovementRequest = req.body;
  const productDetails: MovementProductDetail[] =
    movementData.productDetails.map(
      ({ productId, productTotal, quantity }) => ({
        productId,
        productTotal,
        quantity,
      }),
    );

  const productIds = productDetails.map(({ productId }) => productId);
  if (new Set(productIds).size !== productIds.length) {
    res.status(400).json({ error: "Product IDs must be unique" });
    return;
  }

  try {
    const stores = await firestoreDB.collection("stores").get();
    if (stores.empty) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const userDocuments = await firestoreDB.getAll(
      ...stores.docs.map((store: QueryDocumentSnapshot): DocumentReference =>
        store.ref.collection("users").doc(userId),
      ),
    );
    const storeIndex: number = userDocuments.findIndex(
      (userDocument: DocumentSnapshot): boolean => userDocument.exists,
    );
    if (storeIndex === -1) {
      res.status(404).json({ error: "No store found for this user" });
      return;
    }

    const storeReference = stores.docs[storeIndex].ref;
    const productReferences: DocumentReference[] = productIds.map(
      (productId: string): DocumentReference =>
        storeReference.collection("products").doc(productId),
    );
    const movementReference = storeReference.collection("movements").doc();
    const time = Timestamp.now();
    const result: CreateMovementResult = await firestoreDB.runTransaction(
      async (transaction): Promise<CreateMovementResult> => {
        const productSnapshots = await Promise.all(
          productReferences.map((productReference) =>
            transaction.get(productReference),
          ),
        );
        const updatedStocks: number[] = [];

        for (const [index, productSnapshot] of productSnapshots.entries()) {
          if (!productSnapshot.exists) {
            return { reason: "product-not-found", success: false };
          }

          const productData: unknown = productSnapshot.data();
          if (
            typeof productData !== "object" ||
            productData === null ||
            Array.isArray(productData)
          ) {
            return { reason: "invalid-product-stock", success: false };
          }

          const storedStock: unknown = Reflect.get(productData, "stock");
          if (
            typeof storedStock !== "number" ||
            !Number.isFinite(storedStock) ||
            storedStock < 0
          ) {
            return { reason: "invalid-product-stock", success: false };
          }

          const currentStock: number = storedStock;
          const detail = productDetails[index];
          const updatedStock = movementData.isMovementAPurchase
            ? currentStock + detail.quantity
            : Math.max(0, currentStock - detail.quantity);
          if (!Number.isFinite(updatedStock)) {
            return { reason: "invalid-product-stock", success: false };
          }
          updatedStocks.push(updatedStock);
        }

        for (const [index, productReference] of productReferences.entries()) {
          transaction.update(productReference, {
            stock: updatedStocks[index],
          });
        }

        const movement: Omit<MovementResponse, "id"> = {
          isMovementAPurchase: movementData.isMovementAPurchase,
          productDetails,
          time,
        };
        transaction.set(movementReference, movement);
        return {
          movement: { ...movement, id: movementReference.id },
          success: true,
        };
      },
    );

    if (!result.success) {
      if (result.reason === "product-not-found") {
        res.status(404).json({ error: "Product not found" });
        return;
      }

      console.error("Product has invalid stock data during movement");
      res.status(500).json({ error: "Failed to create movement" });
      return;
    }

    res.status(201).json(result.movement);
  } catch (error) {
    console.error("Failed to create movement in Firestore:", error);
    res.status(500).json({ error: "Failed to create movement" });
  }
};
