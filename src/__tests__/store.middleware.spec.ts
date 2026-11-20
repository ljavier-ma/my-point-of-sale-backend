import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firestoreDB } = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import {
  storeMiddleware,
  updateStoreMiddleware,
} from "../middlewares/store.middleware.js";

const createResponse = (): Response =>
  ({
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }) as unknown as Response;

describe("storeMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request has no authenticated user", async () => {
    const req = {} as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authentication required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("returns the store that contains the authenticated user", async () => {
    const firstStoreRef = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue("first-user-ref"),
      }),
    };
    const matchingStoreRef = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue("matching-user-ref"),
      }),
    };
    const stores = [
      {
        data: (): { name: string } => ({ name: "First" }),
        id: "first-store",
        ref: firstStoreRef,
      },
      {
        data: (): {
          extra: boolean;
          id: string;
          name: string;
          settings: {
            idealPercentageOfProduct: number;
            lowPercentageOfProduct: number;
          };
        } => ({
          extra: true,
          id: "document-data-id",
          name: "Matching",
          settings: {
            idealPercentageOfProduct: 80,
            lowPercentageOfProduct: 20,
          },
        }),
        id: "matching-store",
        ref: matchingStoreRef,
      },
    ];
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockResolvedValue({ docs: stores }),
    });
    firestoreDB.getAll.mockResolvedValue([{ exists: false }, { exists: true }]);

    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(firestoreDB.collection).toHaveBeenCalledWith("stores");
    expect(firstStoreRef.collection).toHaveBeenCalledWith("users");
    expect(matchingStoreRef.collection).toHaveBeenCalledWith("users");
    expect(firestoreDB.getAll).toHaveBeenCalledWith(
      "first-user-ref",
      "matching-user-ref",
    );
    expect(res.json).toHaveBeenCalledWith({
      id: "matching-store",
      name: "Matching",
      settings: {
        idealPercentageOfProduct: 80,
        lowPercentageOfProduct: 20,
      },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 500 when the store document has no name", async () => {
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            data: (): Record<string, never> => ({}),
            id: "store-1",
            ref: { collection: vi.fn().mockReturnValue({ doc: vi.fn() }) },
          },
        ],
      }),
    });
    firestoreDB.getAll.mockResolvedValue([{ exists: true }]);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Store document is missing valid id, name, or settings:",
      "store-1",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch store" });
    consoleError.mockRestore();
  });

  it("returns 404 when no store contains the authenticated user", async () => {
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: "store-1",
            ref: { collection: vi.fn().mockReturnValue({ doc: vi.fn() }) },
          },
        ],
      }),
    });
    firestoreDB.getAll.mockResolvedValue([{ exists: false }]);

    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "No store found for this user",
    });
  });

  describe("updateStoreMiddleware", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const validStoreUpdate = {
      name: "Updated store",
      settings: {
        idealPercentageOfProduct: 80,
        lowPercentageOfProduct: 20,
      },
    };

    const createStore = (
      exists = true,
    ): {
      collection: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    } => {
      const storeReference = {
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue("user-reference"),
        }),
        update: vi.fn().mockResolvedValue(undefined),
      };
      firestoreDB.collection.mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [{ id: "store-1", ref: storeReference }],
        }),
      });
      firestoreDB.getAll.mockResolvedValue([{ exists }]);
      return storeReference;
    };

    it("updates the matching store and returns the updated data", async () => {
      const storeReference = createStore();
      const req = {
        body: validStoreUpdate,
        firebaseUser: { uid: "user-1" },
      } as Request;
      const res = createResponse();

      await updateStoreMiddleware(req, res, vi.fn());

      expect(storeReference.update).toHaveBeenCalledWith(validStoreUpdate);
      expect(res.json).toHaveBeenCalledWith({
        id: "store-1",
        ...validStoreUpdate,
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it("accepts a zero low percentage and values below 100", async () => {
      const storeReference = createStore();
      const body = {
        name: "Updated store",
        settings: {
          idealPercentageOfProduct: 99.99,
          lowPercentageOfProduct: 0,
        },
      };
      const req = {
        body,
        firebaseUser: { uid: "user-1" },
      } as Request;
      const res = createResponse();

      await updateStoreMiddleware(req, res, vi.fn());

      expect(storeReference.update).toHaveBeenCalledWith(body);
      expect(res.status).not.toHaveBeenCalled();
    });

    it.each([
      [
        "equal percentages",
        {
          ...validStoreUpdate,
          settings: {
            idealPercentageOfProduct: 20,
            lowPercentageOfProduct: 20,
          },
        },
      ],
      [
        "ideal percentage below low percentage",
        {
          ...validStoreUpdate,
          settings: {
            idealPercentageOfProduct: 19,
            lowPercentageOfProduct: 20,
          },
        },
      ],
      ["empty name", { ...validStoreUpdate, name: "" }],
      ["whitespace-only name", { ...validStoreUpdate, name: "  " }],
      [
        "percentage below zero",
        {
          ...validStoreUpdate,
          settings: {
            ...validStoreUpdate.settings,
            idealPercentageOfProduct: -1,
          },
        },
      ],
      [
        "percentage equal to 100",
        {
          ...validStoreUpdate,
          settings: {
            ...validStoreUpdate.settings,
            lowPercentageOfProduct: 100,
          },
        },
      ],
      [
        "non-numeric percentage",
        {
          ...validStoreUpdate,
          settings: {
            ...validStoreUpdate.settings,
            lowPercentageOfProduct: "20",
          },
        },
      ],
      ["extra field", { ...validStoreUpdate, extra: true }],
    ])("returns 400 for %s", async (_case, body) => {
      const req = {
        body,
        firebaseUser: { uid: "user-1" },
      } as Request;
      const res = createResponse();

      await updateStoreMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid store data" });
      expect(firestoreDB.collection).not.toHaveBeenCalled();
    });

    it("returns 401 when the request has no authenticated user", async () => {
      const req = { body: validStoreUpdate } as Request;
      const res = createResponse();

      await updateStoreMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Authentication required",
      });
      expect(firestoreDB.collection).not.toHaveBeenCalled();
    });

    it("returns 404 when no store contains the authenticated user", async () => {
      createStore(false);
      const req = {
        body: validStoreUpdate,
        firebaseUser: { uid: "user-1" },
      } as Request;
      const res = createResponse();

      await updateStoreMiddleware(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "No store found for this user",
      });
    });
  });

  it("returns 500 when the store document has no string name", async () => {
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            data: (): { name: number } => ({ name: 123 }),
            id: "store-1",
            ref: { collection: vi.fn().mockReturnValue({ doc: vi.fn() }) },
          },
        ],
      }),
    });
    firestoreDB.getAll.mockResolvedValue([{ exists: true }]);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Store document is missing valid id, name, or settings:",
      "store-1",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch store" });
    consoleError.mockRestore();
  });

  it("returns 500 when the store document has invalid settings", async () => {
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            data: (): {
              name: string;
              settings: { idealPercentageOfProduct: string };
            } => ({
              name: "Store",
              settings: { idealPercentageOfProduct: "80" },
            }),
            id: "store-1",
            ref: { collection: vi.fn().mockReturnValue({ doc: vi.fn() }) },
          },
        ],
      }),
    });
    firestoreDB.getAll.mockResolvedValue([{ exists: true }]);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Store document is missing valid id, name, or settings:",
      "store-1",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch store" });
    consoleError.mockRestore();
  });

  it("logs Firestore errors and returns 500", async () => {
    const error = new Error("Firestore unavailable");
    firestoreDB.collection.mockReturnValue({
      get: vi.fn().mockRejectedValue(error),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await storeMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to fetch the user's store from Firestore:",
      error,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch store" });

    consoleError.mockRestore();
  });
});
