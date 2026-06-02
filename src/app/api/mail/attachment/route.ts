// GET /api/mail/attachment?accountId=ID&messageId=MID&attachmentId=AID
// Downloads a single attachment's bytes and streams them back to the browser
// as a file download.

import { getAccountWithTokens } from "@/lib/accounts";
import { getValidAccessToken } from "@/lib/oauth";
import { getMailProvider } from "@/lib/providers";
import { requireUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Strips characters that would break the quoted `filename=` token in a
 *  Content-Disposition header (double-quotes, backslashes, and control/newline
 *  chars). Falls back to a safe default when nothing usable remains. The
 *  RFC 5987 `filename*` parameter carries the full UTF-8 name regardless. */
function sanitizeFilename(filename: string): string {
  // Remove double-quotes, backslashes, and any control chars (incl. \r and \n).
  // eslint-disable-next-line no-control-regex
  const cleaned = filename.replace(/["\\\x00-\x1f\x7f]/g, "").trim();
  return cleaned.length ? cleaned : "attachment";
}

export async function GET(req: Request): Promise<Response> {
  const userId = await requireUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const messageId = searchParams.get("messageId");
  const attachmentId = searchParams.get("attachmentId");

  if (!accountId) {
    return Response.json(
      { error: "An 'accountId' query parameter is required." },
      { status: 400 },
    );
  }
  if (!messageId) {
    return Response.json(
      { error: "A 'messageId' query parameter is required." },
      { status: 400 },
    );
  }
  if (!attachmentId) {
    return Response.json(
      { error: "An 'attachmentId' query parameter is required." },
      { status: 400 },
    );
  }

  try {
    const account = await getAccountWithTokens(userId, accountId);
    if (!account) {
      return Response.json({ error: "Account not found." }, { status: 404 });
    }

    await getValidAccessToken(account);
    const { filename, mimeType, contentBase64 } = await getMailProvider(
      account.provider,
    ).getAttachment(account, messageId, attachmentId);

    const buf = Buffer.from(contentBase64, "base64");
    const safe = sanitizeFilename(filename);

    return new Response(buf, {
      headers: {
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to download attachment.";
    return Response.json({ error: message }, { status: 502 });
  }
}
