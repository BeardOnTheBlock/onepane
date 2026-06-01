// GET /api/providers
// Reports which OAuth providers are configured (env vars present) so the UI can
// show/hide the "Connect" buttons without ever throwing.

import { isProviderConfigured } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    providers: {
      google: isProviderConfigured("google"),
      microsoft: isProviderConfigured("microsoft"),
    },
  });
}
