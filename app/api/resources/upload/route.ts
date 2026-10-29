import { randomUUID } from "crypto";
import { adminEmail, deny } from "@/lib/admin";
import { putFile, resourcesRepo, resourcesRepoIsPrivate } from "@/lib/github";

export const dynamic = "force-dynamic";
const MAX = 4 * 1024 * 1024;

/** Stores a private resource file in RESOURCES_REPO under resources/files/. Any file type. */
export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return deny();
  if (!resourcesRepo() || !(await resourcesRepoIsPrivate().catch(() => false))) return Response.json({ error: "not_configured" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "File is over 4 MB." }, { status: 413 });
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "file";
  const path = `resources/files/${randomUUID().slice(0, 8)}-${safe}`;
  try {
    await putFile(resourcesRepo(), path, Buffer.from(await file.arrayBuffer()).toString("base64"), `Resources: upload ${safe} (admin: ${email})`);
    return Response.json({ url: `/api/resources/file?path=${encodeURIComponent(path)}`, id: path, sizeBytes: file.size, contentType: file.type });
  } catch {
    return Response.json({ error: "Could not save to GitHub." }, { status: 502 });
  }
}
