// NextAuth v5 catch-all route — mounts the sign-in/callback/session endpoints.

import { handlers } from "@/lib/auth";

export const runtime = "nodejs";

export const { GET, POST } = handlers;
