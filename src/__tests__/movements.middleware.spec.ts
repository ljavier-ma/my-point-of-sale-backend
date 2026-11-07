import type { Request, Response } from "express";

import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  firestoreDB,
  movementCollection,
  movementProductCollection,
  movementTransaction,
} = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
    runTransaction: vi.fn(),
  },
  movementCollection: {
    count: vi.fn(),
    doc: vi.fn(),
    get: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  },
  movementProductCollection: {
    doc: vi.fn(),
  },
  movementTransaction: {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import type {
  ErrorResponse,
  MovementResponse,
  MovementsQuery,
  MovementsResponse,
} from "../types/movement.js";

import {
  createMovementMiddleware,
  movementsMiddleware,
} from "../middlewares/movements.middleware.js";

const createResponse = (): Response =>
  ({
    json: vi.fn((body: unknown): void => {
      latestResponseBody = body;
    }),
    status: vi.fn().mockReturnThis(),
  }) as unknown as Response;

let latestResponseBody: unknown;
let storedMovementData: unknown;

const createMovementRequest = (
  body: unknown,
): Request<Record<string, never>, ErrorResponse | MovementResponse, unknown> =>
  ({
    body,
    firebaseUser: { uid: "user-1" },
  }) as Request<
    Record<string, never>,
    ErrorResponse | MovementResponse,
    unknown
  >;

function configureFirestore(
  config: {
    membershipExists?: boolean;
    movementDocuments?: { data: () => unknown; id: string }[];
    productDocuments?: { data: () => unknown; id: string }[];
    storeCount?: number;
  } = {},
): void {
  const storeCount = config.storeCount ?? 1;
  const productDocuments = config.productDocuments ?? [];
  movementCollection.offset.mockReturnThis();
  movementCollection.limit.mockReturnThis();
  movementCollection.doc.mockReturnValue({ id: "movement-new" });
  movementCollection.get.mockResolvedValue({
    docs: config.movementDocuments ?? [],
  });
  movementCollection.count.mockReturnValue({
    get: vi.fn().mockResolvedValue({
      data: () => ({ count: config.movementDocuments?.length ?? 0 }),
    }),
  });
  movementProductCollection.doc.mockImplementation((id: string) => ({ id }));
  movementTransaction.get.mockImplementation(
    (reference: { id: string }): Promise<unknown> => {
      const productDocument = productDocuments.find(
        (document) => document.id === reference.id,
      );
      return Promise.resolve(
        productDocument
          ? {
              data: productDocument.data,
              exists: true,
            }
          : { exists: false },
      );
    },
  );
  movementTransaction.set.mockResolvedValue(undefined);
  movementTransaction.set.mockImplementation(
    (_reference: unknown, movementData: unknown): void => {
      storedMovementData = movementData;
    },
  );
  movementTransaction.update.mockResolvedValue(undefined);
  firestoreDB.runTransaction.mockImplementation(
    (callback: (transaction: typeof movementTransaction) => unknown) =>
      Promise.resolve(callback(movementTransaction)),
  );

  const stores = Array.from({ length: storeCount }, (_value, index) => ({
    ref: {
      collection: vi.fn((name: string) =>
        name === "movements"
          ? movementCollection
          : name === "products"
            ? movementProductCollection
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

function expectTimestampProperty(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected an object containing a Firestore timestamp");
  }

  expect(Reflect.get(value, "time")).toBeInstanceOf(Timestamp);
}

describe("movementsMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestResponseBody = undefined;
    storedMovementData = undefined;
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

  describe("createMovementMiddleware", () => {
    it("requires authentication", async (): Promise<void> => {
      const req = {
        body: {
          isMovementAPurchase: true,
          productDetails: [
            { productId: "product-1", productTotal: 10, quantity: 1 },
          ],
        },
      } as Request;
      const res = createResponse();

      await createMovementMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentication required",
      });
      expect(firestoreDB.collection).not.toHaveBeenCalled();
    });

    it("adds stock for purchases and saves a Firestore timestamp", async (): Promise<void> => {
      configureFirestore({
        productDocuments: [
          {
            data: (): Record<string, unknown> => ({ stock: 3 }),
            id: "product-1",
          },
        ],
      });
      const body = {
        isMovementAPurchase: true,
        productDetails: [
          { productId: "product-1", productTotal: 37, quantity: 2 },
        ],
      };
      const res = createResponse();

      await createMovementMiddleware(createMovementRequest(body), res, vi.fn());

      expect(movementTransaction.update).toHaveBeenCalledWith(
        { id: "product-1" },
        { stock: 5 },
      );
      expect(movementTransaction.set).toHaveBeenCalledWith(
        { id: "movement-new" },
        expect.objectContaining(body),
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledOnce();
      expectTimestampProperty(storedMovementData);
      expectTimestampProperty(latestResponseBody);
    });

    it("subtracts stock for non-purchases and clamps it at zero", async (): Promise<void> => {
      configureFirestore({
        productDocuments: [
          {
            data: (): Record<string, unknown> => ({ stock: 2 }),
            id: "product-1",
          },
        ],
      });
      const body = {
        isMovementAPurchase: false,
        productDetails: [
          { productId: "product-1", productTotal: 37, quantity: 5 },
        ],
      };
      const res = createResponse();

      await createMovementMiddleware(createMovementRequest(body), res, vi.fn());

      expect(movementTransaction.update).toHaveBeenCalledWith(
        { id: "product-1" },
        { stock: 0 },
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("adds purchase quantity to stock", async (): Promise<void> => {
      configureFirestore({
        productDocuments: [
          {
            data: (): Record<string, unknown> => ({ stock: 2 }),
            id: "product-1",
          },
        ],
      });
      const res = createResponse();

      await createMovementMiddleware(
        createMovementRequest({
          isMovementAPurchase: true,
          productDetails: [
            { productId: "product-1", productTotal: 37, quantity: 5 },
          ],
        }),
        res,
        vi.fn(),
      );

      expect(movementTransaction.update).toHaveBeenCalledWith(
        { id: "product-1" },
        { stock: 7 },
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("treats a null stock as zero", async (): Promise<void> => {
      configureFirestore({
        productDocuments: [
          {
            data: (): Record<string, unknown> => ({ stock: null }),
            id: "product-1",
          },
        ],
      });
      const body = {
        isMovementAPurchase: true,
        productDetails: [
          { productId: "product-1", productTotal: 37, quantity: 2 },
        ],
      };
      const res = createResponse();

      await createMovementMiddleware(createMovementRequest(body), res, vi.fn());

      expect(movementTransaction.update).toHaveBeenCalledWith(
        { id: "product-1" },
        { stock: 2 },
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("rejects repeated product IDs before starting a transaction", async (): Promise<void> => {
      configureFirestore();
      const res = createResponse();

      await createMovementMiddleware(
        createMovementRequest({
          isMovementAPurchase: true,
          productDetails: [
            { productId: "product-1", productTotal: 10, quantity: 1 },
            { productId: "product-1", productTotal: 20, quantity: 2 },
          ],
        }),
        res,
        vi.fn(),
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Product IDs must be unique",
      });
      expect(firestoreDB.runTransaction).not.toHaveBeenCalled();
    });

    it("does not update stocks or save a movement when a product is missing", async (): Promise<void> => {
      configureFirestore({
        productDocuments: [
          {
            data: (): Record<string, unknown> => ({ stock: 3 }),
            id: "product-1",
          },
        ],
      });
      const res = createResponse();

      await createMovementMiddleware(
        createMovementRequest({
          isMovementAPurchase: true,
          productDetails: [
            { productId: "product-1", productTotal: 10, quantity: 1 },
            { productId: "missing-product", productTotal: 20, quantity: 2 },
          ],
        }),
        res,
        vi.fn(),
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Product not found" });
      expect(movementTransaction.update).not.toHaveBeenCalled();
      expect(movementTransaction.set).not.toHaveBeenCalled();
    });

    it("rejects invalid movement data", async (): Promise<void> => {
      configureFirestore();
      const res = createResponse();

      await createMovementMiddleware(
        createMovementRequest({
          isMovementAPurchase: "true",
          productDetails: [],
        }),
        res,
        vi.fn(),
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid movement data",
      });
      expect(firestoreDB.collection).not.toHaveBeenCalled();
    });
  });
});
