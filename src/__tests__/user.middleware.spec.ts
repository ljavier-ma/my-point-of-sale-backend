import type { Request, Response } from "express";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { firestoreDB } = vi.hoisted(() => ({
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firestoreDB }));

import { userMiddleware } from "../middlewares/user.middleware.js";

const createResponse = (): Response =>
  ({
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  }) as unknown as Response;

function mockUserDocument(userData: unknown, exists?: boolean): void {
  const store = {
    ref: {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue("user-reference"),
      }),
    },
  };
  firestoreDB.collection.mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [store], empty: false }),
  });
  firestoreDB.getAll.mockResolvedValue([
    {
      data: (): unknown => userData,
      exists: exists ?? true,
      id: "user-1",
    },
  ]);
}

describe("userMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when the request has no authenticated user", async () => {
    const res = createResponse();

    await userMiddleware({} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authentication required",
    });
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("returns only the validated user properties from Firestore", async () => {
    mockUserDocument({
      email: "user@example.com",
      extra: "not returned",
      isForTesting: true,
      name: "Example User",
    });
    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await userMiddleware(req, res, vi.fn());

    expect(firestoreDB.collection).toHaveBeenCalledWith("stores");
    expect(firestoreDB.getAll).toHaveBeenCalledWith("user-reference");
    expect(res.json).toHaveBeenCalledWith({
      email: "user@example.com",
      id: "user-1",
      isForTesting: true,
      name: "Example User",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("defaults isForTesting to false when it is absent from Firestore", async () => {
    mockUserDocument({
      email: "user@example.com",
      name: "Example User",
    });
    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await userMiddleware(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      email: "user@example.com",
      id: "user-1",
      isForTesting: false,
      name: "Example User",
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated user is not in a store", async () => {
    mockUserDocument(undefined, false);
    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await userMiddleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "No user found" });
  });

  it("returns 500 when the Firestore user document has an invalid shape", async () => {
    mockUserDocument({
      email: "user@example.com",
      isForTesting: "yes",
      name: 7,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const req = { firebaseUser: { uid: "user-1" } } as Request;
    const res = createResponse();

    await userMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "User document is missing valid email or name, or has invalid isForTesting:",
      "user-1",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch user" });
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

    await userMiddleware(req, res, vi.fn());

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to fetch the user's information from Firestore:",
      error,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to fetch user" });
  });
});
