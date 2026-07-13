import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/server/prisma";

const isProd = process.env.NODE_ENV === "production";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  // Route NextAuth's sign-in + error screens to our own /login (default is the
  // bare /api/auth/* pages) so authentication keeps the branded experience.
  pages: { signIn: "/login", error: "/login" },
  // Explicit cookie hardening (defense-in-depth atop NextAuth defaults). In
  // production the session token gets the __Secure- prefix + Secure flag so it
  // only travels over HTTPS; httpOnly blocks JS access (XSS token theft) and
  // sameSite=lax blocks cross-site POST CSRF while still allowing the top-level
  // OAuth redirect. Local http dev keeps the unprefixed, non-secure cookie.
  useSecureCookies: isProd,
  cookies: {
    sessionToken: {
      name: `${isProd ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProd,
      },
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};
