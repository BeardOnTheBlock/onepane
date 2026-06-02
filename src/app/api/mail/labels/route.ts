// GET  /api/mail/labels?accountId=ID  — lists an account's labels (Gmail) /
//                                        mail folders (Outlook).
// POST /api/mail/labels                — body { accountId, name }; creates a new
//                                        user label/folder and returns it.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import { requireUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId")?.trim();

  if (!accountId) {
    return badRequest("A non-empty 'accountId' is required.");
  }

  try {
    const account = await getAccountWithTokens(userId, accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const labels = await getMailProvider(account.provider).listLabels(account);

    return Response.json({ labels });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list labels.";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const { accountId, name } = (body ?? {}) as {
    accountId?: unknown;
    name?: unknown;
  };

  if (typeof accountId !== "string" || accountId.length === 0) {
    return badRequest("A non-empty 'accountId' is required.");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    return badRequest("A non-empty 'name' is required.");
  }

  try {
    const account = await getAccountWithTokens(userId, accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const label = await getMailProvider(account.provider).createLabel(
      account,
      name.trim(),
    );

    return Response.json({ label });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create label.";
    return Response.json({ error: message }, { status: 502 });
  }
}
