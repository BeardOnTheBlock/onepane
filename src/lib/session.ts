// Server-only helper for resolving the logged-in user from the session.
// API routes call requireUserId() and return 401 when it is null; every
// accounts data-layer call is then scoped by this id (per-user isolation).

import { auth } from "@/lib/auth";

/** Returns the logged-in user's id, or null if there is no session. */
export async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
