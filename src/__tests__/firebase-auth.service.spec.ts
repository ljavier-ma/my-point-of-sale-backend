import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firebaseAuth, firestoreDB } = vi.hoisted(() => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
  firestoreDB: {
    collection: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firebaseAuth, firestoreDB }));

import { firebaseAuthMiddleware } from "../services/firebase-auth.service.js";

function configureUserDocument(isForTesting: unknown): void {
  const userReference = "user-reference";
  const store = {
    ref: {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue(userReference),
      }),
    },
  };
  firestoreDB.collection.mockReturnValue({
    get: vi.fn().mockResolvedValue({ docs: [store], empty: false }),
  });
  firestoreDB.getAll.mockResolvedValue([
    {
      exists: true,
      get: vi.fn().mockReturnValue(isForTesting),
    },
  ]);
}

function createRequest(method: string): Request {
  return {
    get: vi.fn().mockReturnValue("Bearer token"),
    method,
  } as unknown as Request;
}

function createResponse(): Response {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("firebaseAuthMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-GET requests from testing users", async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({ uid: "user-1" });
    configureUserDocument(true);
    const req = createRequest("POST");
    const res = createResponse();
    const next = vi.fn();

    await firebaseAuthMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Testing users cannot modify data",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("continues GET requests from testing users", async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      isForTesting: true,
      uid: "user-1",
    });
    const req = createRequest("GET");
    const res = createResponse();
    const next = vi.fn();

    await firebaseAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(firestoreDB.collection).not.toHaveBeenCalled();
  });

  it("allows non-GET requests when the user document has no testing attribute", async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      isForTesting: true,
      uid: "user-1",
    });
    configureUserDocument(undefined);
    const req = createRequest("PATCH");
    const res = createResponse();
    const next = vi.fn();

    await firebaseAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
