import { adminEmail, deny } from "@/lib/admin";
import { putFile, siteRepo, GitHubError } from "@/lib/github";

export const dynamic = "force-dynamic";

/** Saves the site content (public/site-data.json) as a commit; Vercel then redeploys. */
export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return deny();
  if (!siteRepo()) return Response.json({ error: "GITHUB_REPO is not set." }, { status: 503 });

  const body = await req.json().catch(() => null);
  const content = body?.content;
  if (typeof content !== "string") return Response.json({ error: "Missing content." }, { status: 400 });
  if (content.length > 900_000) return Response.json({ error: "Content is too large." }, { status: 413 });
  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    return Response.json({ error: "Content is not valid JSON." }, { status: 400 });
  }
  if (!data || typeof data !== "object" || !data.recruit || !Array.isArray(data.posts) || !Array.isArray(data.pubs)) {
    return Response.json({ error: "Content is missing required sections." }, { status: 400 });
  }
  try {
    const out = await putFile(
      siteRepo(),
      "public/site-data.json",
      Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf8").toString("base64"),
      `Update site content (admin: ${email})`
    );
    return Response.json({ version: out?.commit?.sha ?? "" });
  } catch (e) {
    const status = e instanceof GitHubError && e.status === 409 ? 409 : 502;
    return Response.json({ error: "Could not save to GitHub." }, { status });
  }
}
