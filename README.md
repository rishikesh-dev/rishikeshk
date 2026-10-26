# Rishikesh K – portfolio (Astro)

```
npm install
npm run dev      # http://localhost:4321
npm run build    # output in dist/
```

## Where to edit
| What | File |
|---|---|
| Name, email, social links | `src/data/site.ts` |
| Projects and case studies | Firestore `projects`, with `src/content/apps/*.md` as fallback |
| "More on the way" cards | `src/data/soon.ts` |
| Skills (pubspec block) | `src/components/Pubspec.astro` |
| Colors, fonts, spacing | `src/styles/global.css` (variables at the top) |
| Images | `public/images/` |
| Firebase rules | `firestore.rules` |

## Add a project
Add a document to the Firestore `projects` collection. The loader reads:
`title`, `description`, `techStack`, `tag`, `playStoreUrl`, `githubUrl`, `story`,
`highlight`, `decisions`, and optionally `image`.

To work without Firestore, copy `src/content/apps/journeo.md`, rename it, and
edit the frontmatter and body. Markdown apps show on the home page and get their
own `/apps/<name>/` page.

## Live data at build time
- Firestore `projects` → app cards and case studies (`src/lib/appsLoader.ts`).
- Firestore `portfolio/bio` → `liveApps`, `projects`, and `downloads` in the About section.
- GitHub API → stars, forks, language, last update, and the case study README section.

The Firestore REST API uses only the public web API key. No private key or
service account is needed. If Firestore is not configured, empty, or failing,
the build falls back to `src/content/apps/*.md`. GitHub failures never break the
build.

## Contact form
Messages are saved to Firestore `messages` from the browser. Set
`PUBLIC_FIREBASE_PROJECT_ID` and `PUBLIC_FIREBASE_API_KEY`, then publish
`firestore.rules`. Without Firestore (or `PUBLIC_FORM_ENDPOINT`) the form opens
the visitor's email app.

Create `.env` from `.env.example` for local builds. `FIRESTORE_BASE` and
`GITHUB_API_BASE` are optional overrides for local mock servers.

## Deploy
GitHub Pages from `main` with `.github/workflows/deploy.yml`, rebuilt daily.
Node 22, npm only. Add repository variables `SITE_URL`,
`PUBLIC_FORM_ENDPOINT`, `PUBLIC_BOOKING_URL`,
`PUBLIC_FIREBASE_PROJECT_ID`, and `PUBLIC_FIREBASE_API_KEY`.

## Before launch
- Replace the placeholder email in `src/data/site.ts`.
- Replace `public/images/sketch.jpg` with your original sketch and the Journeo
  icon with real screenshots.
- Fill in the case study text (look for the `[brackets]`).
