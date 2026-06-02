// /api/accounts
//   GET    -> { accounts: AccountPublic[] }
//   PATCH  -> { id, color } -> { account: AccountPublic }
//   DELETE -> ?id=ID        -> { ok: true }

import {
  deleteAccount,
  listAccountsPublic,
  updateAccountColor,
} from "@/lib/accounts";
import { requireUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A 3- or 6-digit hex colour, e.g. "#fff" or "#6366f1". */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function errorJson(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET(): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  try {
    const accounts = await listAccountsPublic(userId);
    return Response.json({ accounts });
  } catch (err) {
    return errorJson(messageOf(err), 500);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body.", 400);
  }

  const { id, color } = (body ?? {}) as { id?: unknown; color?: unknown };

  if (typeof id !== "string" || id.length === 0) {
    return errorJson("A non-empty 'id' is required.", 400);
  }
  if (typeof color !== "string" || !HEX_COLOR.test(color)) {
    return errorJson(
      "'color' must be a hex string like #6366f1 or #fff.",
      400,
    );
  }

  try {
    const account = await updateAccountColor(userId, id, color);
    if (!account) {
      return errorJson("Account not found.", 404);
    }
    return Response.json({ account });
  } catch (err) {
    return errorJson(messageOf(err), 500);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return errorJson("An 'id' query parameter is required.", 400);
  }

  try {
    await deleteAccount(userId, id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorJson(messageOf(err), 500);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected server error.";
}
