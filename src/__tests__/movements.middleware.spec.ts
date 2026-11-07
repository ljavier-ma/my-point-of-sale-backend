import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firestoreDB, movementCollection } = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
  movementCollection: {
    count: vi.fn(),
    get: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import type {
  ErrorResponse,
  MovementsQuery,
  MovementsResponse,
} from "../types/movement.js";

import { movementsMiddleware } from "../middlewares/movements.middleware.js";

const createResponse = (): Response =>
  ({
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }) as unknown as Response;

function configureFirestore(
  config: {
    membershipExists?: boolean;
    movementDocuments?: { data: () => unknown; id: string }[];
    storeCount?: number;
  } = {},
): void {
  const storeCount = config.storeCount ?? 1;
  movementCollection.offset.mockReturnThis();
  movementCollection.limit.mockReturnThis();
  movementCollection.get.mockResolvedValue({
    docs: config.movementDocuments ?? [],
  });
  movementCollection.count.mockReturnValue({
    get: vi.fn().mockResolvedValue({
      data: () => ({ count: config.movementDocuments?.length ?? 0 }),
    }),
  });

  const stores = Array.from({ length: storeCount }, (_value, index) => ({
    ref: {
      collection: vi.fn((name: string) =>
        name === "movements"
          ? movementCollection
          : {
              doc: vi
                .fn()
                .mockReturnValue(`user-reference-${String(index + 1)}`),
            },
      ),
    },
  }));
  firestoreDB.collection.mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: stores, empty: storeCount === 0 }),
  });
  firestoreDB.getAll.mockResolvedValue(
    stores.map((_store, index) => ({
      exists: (config.membershipExists ?? true) && index === storeCount - 1,
    })),
  );
}

describe("movementsMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request has no authenticated user", async () => {
    const res = createResponse();

    await movementsMiddleware({} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authentication required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("returns a page of movements and the total count", async () => {
    const movementTime = { nanoseconds: 456, seconds: 123 };
    const productDetails = [
      {
        productId: "product-1",
        productTotal: 37,
        quantity: 2,
        unrecognized: "not returned",
      },
    ];
    configureFirestore({
      movementDocuments: [
        {
          data: (): Record<string, unknown> => ({
            extra: "not returned",
            isMovementAPurchase: true,
            productDetails,
            time: movementTime,
          }),
          id: "movement-1",
        },
      ],
      storeCount: 2,
    });
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "10" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(firestoreDB.collection).toHaveBeenCalledWith("stores");
    expect(firestoreDB.getAll).toHaveBeenCalledWith(
      "user-reference-1",
      "user-reference-2",
    );
    expect(movementCollection.offset).toHaveBeenCalledWith(10);
    expect(movementCollection.limit).toHaveBeenCalledWith(5);
    expect(res.json).toHaveBeenCalledWith({
      movements: [
        {
          id: "movement-1",
          isMovementAPurchase: true,
          productDetails: [
            { productId: "product-1", productTotal: 37, quantity: 2 },
          ],
          time: movementTime,
        },
      ],
      totalOfMovements: 1,
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns an empty array when the store has no movements", async () => {
    configureFirestore();
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      movements: [],
      totalOfMovements: 0,
    });
  });

  it("returns 404 when no store contains the authenticated user", async () => {
    configureFirestore({ membershipExists: false });
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "No store found for this user",
    });
    expect(movementCollection.get).not.toHaveBeenCalled();
  });

  it("returns 400 when pagination parameters are missing or invalid", async () => {
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "0", offset: "-1" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Valid offset and limit query parameters are required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("returns 500 when a movement has invalid product details", async () => {
    configureFirestore({
      movementDocuments: [
        {
          data: (): Record<string, unknown> => ({
            isMovementAPurchase: true,
            productDetails: [
              { productId: "product-1", productTotal: "37", quantity: 2 },
            ],
            time: "today",
          }),
          id: "invalid-movement",
        },
      ],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Movement document is missing valid movement fields:",
      "invalid-movement",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Failed to fetch movements",
    });
  });

  it("returns 500 when a movement has an invalid purchase flag", async () => {
    configureFirestore({
      movementDocuments: [
        {
          data: (): Record<string, unknown> => ({
            isMovementAPurchase: "true",
            productDetails: [],
            time: "today",
          }),
          id: "invalid-movement",
        },
      ],
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Movement document is missing valid movement fields:",
      "invalid-movement",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Failed to fetch movements",
    });
  });

  it("logs Firestore failures and returns 500", async () => {
    const error = new Error("Firestore unavailable");
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockRejectedValue(error),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const req = {
      firebaseUser: { uid: "user-1" },
      query: { limit: "5", offset: "0" },
    } as Request<
      Record<string, never>,
      ErrorResponse | MovementsResponse,
      unknown,
      MovementsQuery
    >;
    const res = createResponse();

    await movementsMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to fetch movements from Firestore:",
      error,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Failed to fetch movements",
    });
  });
});
