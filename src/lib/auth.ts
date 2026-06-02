// ============================================================================
// NextAuth v5 configuration — IDENTITY ONLY.
//
// This Google client is used purely for "Sign in with Google" (login). It does
// NOT grant mailbox/calendar access — those scopes come from the separate
// /api/connect flow and are stored as encrypted per-account tokens.
//
// On first sign-in we upsert a User row keyed by email and stash its id on the
// JWT, so every request can resolve the logged-in user (see lib/session.ts).
// ============================================================================

import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";

import { prisma } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user, profile }) {
      // On first sign-in, `user`/`profile` are present. Upsert the app User by
      // email and remember its id on the token for all subsequent requests.
      const email = user?.email ?? profile?.email ?? null;
      if (email) {
        const name = user?.name ?? profile?.name ?? null;
        const image = user?.image ?? profile?.picture ?? null;
        const dbUser = await prisma.user.upsert({
          where: { email },
          create: { email, name, image },
          update: { name, image },
        });
        token.uid = dbUser.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
});
