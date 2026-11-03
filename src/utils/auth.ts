import type { Request } from "express";

export function getAuthenticatedUserId(
  req: Pick<Request, "firebaseUser">,
): string | undefined {
  const userId: string | undefined = req.firebaseUser?.uid;
  return userId && userId.length > 0 ? userId : undefined;
}
