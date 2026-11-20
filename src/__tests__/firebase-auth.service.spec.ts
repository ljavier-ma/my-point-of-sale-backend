import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firebaseAuth } = vi.hoisted(() => ({
  firebaseAuth: {
    verifyIdToken: vi.fn(),
  },
}));

vi.mock("../config/firebase.js", () => ({ firebaseAuth }));

import { firebaseAuthMiddleware } from "../services/firebase-auth.service.js";

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
    firebaseAuth.verifyIdToken.mockResolvedValue({
      isForTesting: true,
      uid: "user-1",
    });
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
  });

  it("allows non-GET requests when the testing claim is absent", async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({ uid: "user-1" });
    const req = createRequest("PATCH");
    const res = createResponse();
    const next = vi.fn();

    await firebaseAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
