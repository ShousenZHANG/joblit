import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import LoginPageClient from "./LoginPageClient";
import { getSafeCallbackUrl } from "./authError";

export const dynamic = "force-dynamic";

type LoginSearchParams = Promise<{
  callbackUrl?: string | string[];
}>;

function firstSearchParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Resolve authenticated visitors before any login UI reaches the browser.
 *
 * Client-only redirection rendered the login card for one frame while
 * `useSession()` hydrated. Server gating keeps authentication authoritative,
 * preserves safe local callbacks, and removes that route flash entirely.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  const [session, params] = await Promise.all([
    getServerSession(authOptions),
    searchParams,
  ]);
  const callbackUrl = getSafeCallbackUrl(
    firstSearchParam(params.callbackUrl),
  );

  if (session?.user) {
    redirect(callbackUrl);
  }

  return <LoginPageClient />;
}
