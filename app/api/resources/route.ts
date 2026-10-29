import { randomUUID } from "crypto";
import { adminEmail, deny } from "@/lib/admin";
import { getText, putFile, resourcesRepo, resourcesRepoIsPrivate, GitHubError } from "@/lib/github";

export const dynamic = "force-dynamic";

/** Private research resources: an index file in the RESOURCES_REPO (keep that repository private). */
const INDEX = "resources/index.json";
type Item = Record<string, unknown> & { id: string };
const notConfigured = () => Response.json({ error: "not_configured" }, { status: 503 });
/** Resources are only kept in a private repository. */
async function ready() {
  if (!resourcesRepo()) return false;
  try { return await resourcesRepoIsPrivate(); } catch { return false; }
}

async function load(): Promise<{ sha: string | null; items: Item[] }> {
  const f = await getText(resourcesRepo(), INDEX);
  if (!f) return { sha: null, items: [] };
  const j = JSON.parse(f.text || "{}");
  return { sha: f.sha, items: Array.isArray(j.items) ? j.items : [] };
}

export async function GET() {
  if (!(await adminEmail())) return deny();
  if (!(await ready())) return notConfigured();
  try {
    const { items } = await load();
    items.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: "Could not read resources." }, { status: e instanceof GitHubError && e.status === 404 ? 503 : 502 });
  }
}

const ALLOWED_FIELDS = ["title", "category", "tags", "notes", "kind", "url", "assetId", "fileName", "size", "contentType"];
function clean(data: any) {
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_FIELDS) if (data && k in data) out[k] = data[k];
  if (typeof out.title === "string") out.title = out.title.slice(0, 300);
  if (typeof out.notes === "string") out.notes = out.notes.slice(0, 20000);
  if (out.url && typeof out.url === "string" && !/^(https?:\/\/|\/api\/resources\/file\?)/.test(out.url)) delete out.url;
  return out;
}

export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return deny();
  if (!(await ready())) return notConfigured();
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (!["add", "update", "delete"].includes(action)) return Response.json({ error: "Unknown action." }, { status: 400 });

  // read-modify-write with a retry if two admins save at once
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { sha, items } = await load();
      const now = Date.now();
      if (action === "add") {
        items.push({ ...clean(body.data), id: randomUUID().slice(0, 12), addedBy: email, createdAt: now, updatedAt: now });
      } else {
        const i = items.findIndex((x) => x.id === body.id);
        if (i < 0) return Response.json({ error: "Not found." }, { status: 404 });
        if (action === "update") items[i] = { ...items[i], ...clean(body.data), updatedAt: now };
        else items.splice(i, 1);
      }
      await putFile(
        resourcesRepo(),
        INDEX,
        Buffer.from(JSON.stringify({ items }, null, 2) + "\n").toString("base64"),
        `Resources: ${action} (admin: ${email})`,
        sha
      );
      return Response.json({ ok: true });
    } catch (e) {
      if (e instanceof GitHubError && e.status === 409 && attempt < 2) continue;
      return Response.json({ error: "Could not save resources." }, { status: 502 });
    }
  }
  return Response.json({ error: "Could not save resources." }, { status: 409 });
}
