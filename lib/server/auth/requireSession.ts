import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";
import { createRequestId } from "@/lib/server/api/errorResponse";

export type SessionContext = {
  userId: string;
  requestId: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function requireSession(): Promise<SessionContext> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    throw new UnauthorizedError();
  }
  return { userId, requestId: createRequestId() };
}

export type SessionContextWithEmail = SessionContext & { userEmail: string };

export async function requireSessionWithEmail(): Promise<SessionContextWithEmail> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  if (!userId || !userEmail) {
    throw new UnauthorizedError();
  }
  return { userId, userEmail, requestId: createRequestId() };
}
