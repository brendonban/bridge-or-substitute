# Bridge or Substitute

Website for *Bridge or Substitute*, a three-study research program at Universiti Malaya on AI companions, self-compassion and help-seeking among Malaysian men.

Built with Next.js and hosted on Vercel. Admins sign in with Google and edit the site from the key icon in the header. Every save becomes a commit to this repository, and Vercel redeploys the site in about a minute.

## How it fits together

| Part | Where |
| --- | --- |
| Page design and behavior | `app/markup.ts`, `app/site.css`, `public/site.js` (generated, see below) |
| Content (blog, publications, team, recruitment, timelines, edited text) | `public/site-data.json` |
| Google sign-in | `lib/auth.ts`, `app/api/auth` |
| Admin saves and photo uploads | `app/api/content`, `app/api/upload`, `lib/github.ts` |
| Private research resources | `app/api/resources`, stored in `resources/` of this (private) repository |
| Uploaded photos | `public/uploads/` |

## Deploy on Vercel (one time)

1. **Push this repository to GitHub.**
2. **Import it in Vercel.** Go to vercel.com → Add New → Project → Import this repository. Keep the default settings (Framework: Next.js) and deploy once.
3. **Create a Google sign-in client.** In Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
   - Authorized JavaScript origin: `https://YOUR-DOMAIN`
   - Authorized redirect URI: `https://YOUR-DOMAIN/api/auth/callback/google`
   - If asked to configure the consent screen first, choose External and add your email as a test user, or publish the app.
4. **Create a GitHub token** so admin saves can commit. GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: only this repository. Permissions: Contents → Read and write.
5. **Keep this repository private.** Research resources are stored in its `resources/` folder and only work while the repository is private. Vercel skips redeploying for commits that only change `resources/` (see `vercel.json`).
6. **Add environment variables** in Vercel → Project → Settings → Environment Variables (see `.env.example`):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`: a long random string (`openssl rand -base64 32`)
   - `NEXTAUTH_URL`: `https://YOUR-DOMAIN`
   - `ADMIN_EMAILS`: Google accounts allowed to edit, comma separated
   - `GITHUB_TOKEN`, `GITHUB_REPO` (`owner/name`), `GITHUB_BRANCH` (`main`)
7. **Redeploy** (Deployments → ⋯ → Redeploy) so the variables take effect.

Then open the site, click the key icon, sign in with Google, and edit.

## Editing

- Changes stay as a draft until you press **Publish to site**.
- After publishing, the change shows for you straight away and for everyone else after Vercel finishes redeploying, usually within a minute.
- Team photos upload to `public/uploads/` and appear after the next deploy. PNG, JPEG, WebP, GIF or PDF, up to 4 MB.
- **Research resources** (Admin → Research resources) are private files, links and notes for the team. They're stored in this repository's `resources/` folder, which the site never serves publicly; only signed-in admins can list or open them, through the site. They switch off if the repository is made public. (To keep them in a separate private repository instead, set `RESOURCES_REPO`.) Any file type up to 4 MB, Word and Excel included. Don't store participant data or anything that identifies a person.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

## Changing the design

The page design lives in `design/bridge-or-substitute.html`. After changing it, run `python3 design/build_next.py` from the repo root to regenerate `app/markup.ts`, `app/site.css` and `public/site.js`. It never touches `public/site-data.json`.
