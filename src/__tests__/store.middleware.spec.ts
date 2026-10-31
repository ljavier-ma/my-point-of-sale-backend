import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firestoreDB } = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import { storeMiddleware } from "../middlewares/store.middleware.js";

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
        data: (): { extra: boolean; id: string; name: string } => ({
          extra: true,
          id: "document-data-id",
          name: "Matching",
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
      "Store document is missing a valid id or name:",
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
      "Store document is missing a valid id or name:",
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
