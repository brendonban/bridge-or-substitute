"""Regenerate the Next.js page files from design/bridge-or-substitute.html. Run from the repo root: python3 design/build_next.py

Rerun after changing the page: it regenerates app/site.css, app/markup.ts
and public/site.js. It never overwrites public/site-data.json (that file is
the live content edited from the admin page) unless --seed is passed.
"""
import json, os, re, sys

SRC = "design/bridge-or-substitute.html"
OUT = "."
s = open(SRC, encoding="utf-8").read()

css = re.search(r"<style>(.*?)</style>", s, re.S).group(1)
body_start = s.index("</style>") + len("</style>")
d3_tag = re.search(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/d3/[^"]+"></script>', s).group(0)
d3_src = re.search(r'src="([^"]+)"', d3_tag).group(1)
markup = s[body_start:s.index(d3_tag)].strip()
main_js = s[s.index("<script>", s.index(d3_tag)) + len("<script>"):s.rindex("</script>")]

shim = r"""/* Host bridge: gives the page the same window.claude interface it uses on
   claude.ai, backed by this Next.js app (Google sign-in + GitHub commits). */
(function(){
  if (window.claude) return;
  const host = { signInUrl: "/api/auth/signin/google?callbackUrl=%2F%23admin", signOutUrl: "/api/auth/signout?callbackUrl=%2F", email: "" };
  let mePromise = null;
  const me = () => mePromise || (mePromise = fetch("/api/me", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(m => { host.email = m.email || ""; return m; }));
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  async function post(url, body, isForm) {
    const r = await fetch(url, isForm ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw err("not_writer", j.error);
    if (r.status === 409) throw err("conflict", j.error);
    if (r.status === 413) throw err("too_large", j.error);
    if (r.status === 415) throw err("unsupported_type", j.error);
    if (!r.ok) throw err("upstream_error", j.error);
    return j;
  }
  window.claude = {
    host,
    use: async (name) => {
      if (name === "user") {
        const m = await me();
        return { canEdit: async () => !!m.isAdmin, isOwner: async () => !!m.isAdmin, id: async () => m.email || null, profiles: async (ids) => Object.fromEntries((ids || []).map(i => [i, { name: i }])) };
      }
      if (name === "artifact") {
        const m = await me();
        if (!m.isAdmin) return null;
        return { publish: async (files) => post("/api/content", { content: files["site-data.json"] }) };
      }
      if (name === "assets") {
        const m = await me();
        if (!m.isAdmin) return null;
        return {
          upload: async (file) => { const fd = new FormData(); fd.append("file", file); return post("/api/upload", fd, true); },
          delete: async () => {}
        };
      }
      if (name === "db") {
        const m = await me();
        if (!m.isAdmin) return null;
        const probe = await fetch("/api/resources", { cache: "no-store" }).catch(() => null);
        if (!probe || probe.status === 503) return null;
        return resourcesDb();
      }
      return null;
    }
  };

  /* Research resources: a small stand-in for the db the page uses on claude.ai,
     backed by /api/resources (a private GitHub repository). */
  function resourcesDb() {
    const listeners = new Set();
    let timer = null;
    async function refresh() {
      const r = await fetch("/api/resources", { cache: "no-store" });
      if (!r.ok) throw err(r.status === 401 ? "permission_denied" : "unavailable");
      const j = await r.json();
      const docs = (j.items || []).map(it => ({ id: it.id, exists: true, data: () => it }));
      listeners.forEach(l => l.next({ docs, size: docs.length, empty: !docs.length }));
    }
    const call = async (body) => { await post("/api/resources", body); refresh().catch(() => {}); };
    return {
      collection: () => ({
        orderBy: () => ({
          onSnapshot: (next, error) => {
            const l = { next, error }; listeners.add(l);
            refresh().catch(e => error && error(e));
            if (!timer) timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60000);
            return () => listeners.delete(l);
          }
        }),
        add: async (data) => { await call({ action: "add", data }); return {}; }
      }),
      doc: (path) => {
        const id = String(path).split("/")[1];
        return { update: (data) => call({ action: "update", id, data }), delete: () => call({ action: "delete", id }) };
      },
      upload: async (file) => { const fd = new FormData(); fd.append("file", file); return post("/api/resources/upload", fd, true); },
      deleteFile: async (p) => { await fetch("/api/resources/file?path=" + encodeURIComponent(p), { method: "DELETE" }).catch(() => {}); }
    };
  }
})();
"""

os.makedirs(f"{OUT}/app", exist_ok=True)
os.makedirs(f"{OUT}/public", exist_ok=True)
open(f"{OUT}/app/site.css", "w", encoding="utf-8").write(
    "/* generated from bridge-or-substitute.html by build_next.py */\n"
    ":root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}\n"
    "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}\n" + css)
open(f"{OUT}/app/markup.ts", "w", encoding="utf-8").write(
    "// generated from bridge-or-substitute.html by build_next.py\n"
    "const markup: string = " + json.dumps(markup, ensure_ascii=False) + ";\nexport default markup;\n")
open(f"{OUT}/app/d3src.ts", "w").write(f'export const D3_SRC = "{d3_src}";\n')
open(f"{OUT}/public/site.js", "w", encoding="utf-8").write(shim + "\n" + main_js)
if "--seed" in sys.argv or not os.path.exists(f"{OUT}/public/site-data.json"):
    seed = sys.argv[sys.argv.index("--seed") + 1] if "--seed" in sys.argv else "site-data.json"
    open(f"{OUT}/public/site-data.json", "w", encoding="utf-8").write(open(seed, encoding="utf-8").read())
print("built", OUT, "markup", len(markup), "js", len(main_js))
