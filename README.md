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
| Projects and case studies | Firestore `projects` |
| "More on the way" cards | Firestore projects with `status: "soon"` |
| Skills (pubspec block) | `src/components/Pubspec.astro` |
| Colors, fonts, spacing | `src/styles/global.css` (variables at the top) |
| Images | `public/images/` |
| Firebase rules | `firestore.rules` |

## Add a project
Add a document to the Firestore `projects` collection. The loader reads:
`title`, `description`, `techStack`, `tag`, `playStoreUrl`, `githubUrl`, `story`,
`highlight`, `decisions`, `image`, and `featured`.

`featured: true` puts a project in Featured Work on the home page. `featured:
false` or a missing `featured` field puts it in the regular project listing
only. Set `published: false` to hide a document without deleting it. The
`featured` and `published` rules are independent.

Non-featured projects with `status: "soon"` render under "More on the way";
non-featured live projects render under "More projects". When `status` is
missing, a document with a `playStoreUrl` is treated as live and one without it
as coming soon. Set `status` explicitly to override that.

New Firestore projects automatically get a `/apps/<slug>/` page at the next
build. No frontend array needs editing and there is no local project file to
keep in sync. Duplicate titles receive stable `-2`, `-3` suffixes so routes
never collide.

Firestore is the only project source. If it is not configured, empty, or
failing, the build still succeeds and the home page shows its empty project
state. Add `PUBLIC_FIREBASE_PROJECT_ID` and `PUBLIC_FIREBASE_API_KEY` (and make
the `projects` collection publicly readable) to publish projects.

## Live data at build time
- Firestore `projects` → project listing, Featured Work and case studies
  (`src/lib/appsLoader.ts`).
- Firestore `portfolio/bio` → `liveApps`, `projects`, and `downloads` in the About section.
- GitHub API → repository name, description, stars, forks, language, topics,
  last update, README sections and a sanitized README preview on each case study.

README Markdown is parsed with `marked`, split into sections (overview,
features, architecture, stack, decisions, setup and other notes), and rendered
with an allowlist sanitizer. Relative links and images are resolved against the
repository. Curated Firestore text wins; README sections fill gaps and add
architecture/setup detail without repeating the story, highlights or decisions.
Missing READMEs, private repositories, invalid URLs, rate limits and API errors
are treated as "no GitHub enrichment" and never break a build.

The Firestore REST API uses only the public web API key. No private key or
service account is needed. If Firestore is not configured, empty, or failing,
the build renders an empty project list. GitHub failures never break the build.

## Tests
```bash
npm test             # unit tests (Node's built-in runner)
npm run verify       # builds against local Firestore/GitHub mock servers
npm run verify:mobile # 390px overflow + mobile menu check (needs Firefox)
```
`npm run verify` checks featured filtering, dynamic pages, README precedence
and sanitization, the empty state during a Firestore outage, GitHub failure
handling, and that the GitHub token never reaches `dist/`. It uses local mocks
only.

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
- Replace `public/images/sketch.jpg` with your original sketch.
- Add the real projects and case study text to the Firestore `projects`
  collection.
