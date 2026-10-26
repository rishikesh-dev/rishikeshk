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
| Projects and case studies | `src/content/apps/*.md` (one file per app) |
| "More on the way" cards | `src/data/soon.ts` |
| Skills (pubspec block) | `src/components/Pubspec.astro` |
| Colors, fonts, spacing | `src/styles/global.css` (variables at the top) |
| Images | `public/images/` |

## Add a project
Copy `src/content/apps/journeo.md`, rename it, change the text at the top. It shows on the home page and gets its own `/apps/<name>/` page.

## Contact form
Create a free form endpoint (Formspree, Web3Forms or similar) and set `PUBLIC_FORM_ENDPOINT` in your environment (or in a local `.env` file). Without it the form opens the visitor's email app. Set `PUBLIC_BOOKING_URL` to show a "Book a call" link.

## Before launch
- Replace the placeholder email in `src/data/site.ts` and set `SITE_URL`.
- Replace `public/images/sketch.jpg` with your original sketch, and the Journeo icon with real screenshots.
- Fill in the case study text (look for the [brackets]).

## Deploy
GitHub Pages from `main` with `.github/workflows/deploy.yml`. Node 22, npm only.

## Content sources
For now the only content source is `src/content/apps/*.md` (schema in `src/content.config.ts`). Firestore and GitHub fetching are not wired up yet.
