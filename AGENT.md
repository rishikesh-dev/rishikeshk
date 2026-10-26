# AGENT.md – Rishikesh K portfolio

## Goal
A portfolio that wins freelance clients first, then remote roles, and promotes my apps. A visitor should understand in five seconds what I do, see real apps, and be able to contact or book me.

## Look: editorial newspaper on warm paper
Reference: `design/reference.png` (the hero). Keep that feel everywhere.

| Token | Value |
|---|---|
| `--bg` paper | `#E9DBBE` |
| `--ink` | `#1A1814` |
| `--red` (only accent) | `#B5322A` |
| Headings | Playfair Display Variable, weight 900 |
| Body | Source Serif 4 Variable |
| Code block only | system monospace |

Style rules: thick black rules and borders, hairline dividers, sharp corners, numbered section labels ("02 | Featured Works"), big uppercase headline. Red is for the Contact button, the Featured tag, the headline period and the code-block shadow, nothing else.

## Hard rules
- Astro static output only. Plain CSS in `src/styles/global.css`. No Tailwind, no UI libraries, no React.
- Vanilla TypeScript in `<script>` tags for the few interactions (mobile menu, pubspec button, contact form).
- No gradients except the mask fade on the hero sketch. No glow, no blur shadows (the hard offset shadow on the code block is fine). No emoji.
- No live app demos.
- No new dependency without asking me first (`marked` is already approved for README text).
- Body text at least 18px. Labels at least 15px. Everything works at 390px wide with no sideways scroll.
- Respect `prefers-reduced-motion`.
- No `href="#"` left in a finished page. Hide a button if its link is empty.
- Do not change the tokens above.

## Routes and content
- `/` one page: Hero, Featured Works, More projects, More on the way, About, Skills (pubspec block), Contact.
- `/apps/[slug]/` one case study per app.
- App content comes only from Firestore `projects` at build time (`src/lib/appsLoader.ts`), through the public REST API. No local project files, no hardcoded project arrays. If Firestore returns nothing, the home page shows an empty project state. `featured: true` controls Featured Work; `published: false` hides a project. Non-featured `status: "soon"` projects populate "More on the way".
- GitHub stats and README text come from `src/lib/github.ts` at build time. README HTML is sanitized and split into sections. Failures must never break the build.
- Contact messages are saved to Firestore `messages` from the browser (`src/components/ContactForm.astro`). Security comes from `firestore.rules`.
- Never put a private key or service account in this repo or in Actions.
- Personal details live in `src/data/site.ts`.

## Deploy
GitHub Pages from `main` with `.github/workflows/deploy.yml`. Node 22, npm only (keep `package-lock.json`, no pnpm).

## Done means
1. `npm run build` passes with no warnings.
2. Checked at 1440px and 390px.
3. Every link works. Contact form sends (or falls back to email).
4. Case study text is real and lives in Firestore, not in local placeholder files.
