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

import type {
  ErrorResponse,
  MovementProductDetail,
  MovementResponse,
  MovementsQuery,
  MovementsResponse,
} from "../types/movement.js";

import { firestoreDB } from "../config/firebase.js";
import { getAuthenticatedUserId } from "../utils/auth.js";

function isMovementData(
  value: unknown,
): value is Pick<MovementResponse, "productDetails" | "time"> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;
  return (
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
      movementsCollection.offset(offset).limit(limit).get(),
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
