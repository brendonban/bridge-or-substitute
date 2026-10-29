import { adminEmail, deny } from "@/lib/admin";
import { getRaw, deleteFile, resourcesRepo, resourcesRepoIsPrivate } from "@/lib/github";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel", zip: "application/zip",
};
const INLINE = /^(application\/pdf|image\/|text\/plain)/;

function validPath(p: string | null): p is string {
  return !!p && /^resources\/files\/[A-Za-z0-9._-]+$/.test(p);
}

/** Streams a private resource file to a signed-in admin. */
export async function GET(req: Request) {
  if (!(await adminEmail())) return deny();
  const path = new URL(req.url).searchParams.get("path");
  if (!validPath(path) || !resourcesRepo() || !(await resourcesRepoIsPrivate().catch(() => false))) return new Response("Not found", { status: 404 });
  const r = await getRaw(resourcesRepo(), path);
  if (!r.ok || !r.body) return new Response("Not found", { status: 404 });
  const name = path.split("/").pop()!.replace(/^[0-9a-f]{8}-/, "");
  const type = TYPES[name.split(".").pop()!.toLowerCase()] || "application/octet-stream";
  return new Response(r.body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${INLINE.test(type) ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(req: Request) {
  const email = await adminEmail();
  if (!email) return deny();
  const path = new URL(req.url).searchParams.get("path");
  if (!validPath(path) || !resourcesRepo()) return new Response(null, { status: 204 });
  try {
    await deleteFile(resourcesRepo(), path, `Resources: delete ${path.split("/").pop()} (admin: ${email})`);
  } catch {}
  return new Response(null, { status: 204 });
}
