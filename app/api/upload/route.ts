import { adminEmail, deny } from "@/lib/admin";
import { putFile, siteRepo } from "@/lib/github";

export const dynamic = "force-dynamic";

const MAX = 4 * 1024 * 1024; // Vercel request bodies are limited to about 4.5 MB
const ALLOWED = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

/** Saves a public file (team photos) into public/uploads. Live after the next deploy. */
export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return deny();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "File is over 4 MB." }, { status: 413 });
  if (!ALLOWED.test(file.type)) return Response.json({ error: "Use a PNG, JPEG, WebP, GIF or PDF." }, { status: 415 });
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "file";
  const path = `public/uploads/${Date.now()}-${safe}`;
  try {
    await putFile(siteRepo(), path, Buffer.from(await file.arrayBuffer()).toString("base64"), `Upload ${safe} (admin: ${email})`);
    return Response.json({ url: "/" + path.replace(/^public\//, ""), id: path, sizeBytes: file.size, contentType: file.type });
  } catch {
    return Response.json({ error: "Could not save to GitHub." }, { status: 502 });
  }
}
