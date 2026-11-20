import type { Request, Response } from "express";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { firebaseAuth, isTestingUser } = vi.hoisted(() => ({
  firebaseAuth: {
    createCustomToken: vi.fn(),
    getUserByEmail: vi.fn(),
  },
  isTestingUser: vi.fn(),
}));

vi.mock("../config/firebase.js", () => ({ firebaseAuth }));
vi.mock("../services/firebase-auth.service.js", () => ({ isTestingUser }));

import { testLoginMiddleware } from "../middlewares/test-login.middleware.js";

function createResponse(): Response {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("testLoginMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mints a token for the configured test account", async () => {
    firebaseAuth.getUserByEmail.mockResolvedValue({
      disabled: false,
      email: "javier.dev.contact@gmail.com",
      uid: "test-user",
    });
    isTestingUser.mockResolvedValue(true);
    firebaseAuth.createCustomToken.mockResolvedValue("custom-token");
    const res = createResponse();

    await testLoginMiddleware({} as Request, res, vi.fn());

    expect(firebaseAuth.getUserByEmail).toHaveBeenCalledWith(
      "javier.dev.contact@gmail.com",
    );
    expect(isTestingUser).toHaveBeenCalledWith("test-user");
    expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith("test-user");
    expect(res.json).toHaveBeenCalledWith({ token: "custom-token" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses to mint a token for accounts not marked for testing", async () => {
    firebaseAuth.getUserByEmail.mockResolvedValue({
      disabled: false,
      uid: "test-user",
    });
    isTestingUser.mockResolvedValue(false);
    const res = createResponse();

    await testLoginMiddleware({} as Request, res, vi.fn());

    expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Test account is not available",
    });
  });

  it("refuses to mint a token for a disabled account", async () => {
    firebaseAuth.getUserByEmail.mockResolvedValue({
      disabled: true,
      uid: "test-user",
    });
    const res = createResponse();

    await testLoginMiddleware({} as Request, res, vi.fn());

    expect(isTestingUser).not.toHaveBeenCalled();
    expect(firebaseAuth.createCustomToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
