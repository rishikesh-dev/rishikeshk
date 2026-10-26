# Portfolio: Richi (solo Flutter developer)

## Goal
Portfolio for freelance clients first. Recruiters and app users are secondary.

## Stack
- Astro, static output only
- Plain CSS (no Tailwind, no UI libraries)
- No new dependencies without asking me first
- Project data: Firestore (existing) or GitHub API at build time

## Pages
- / : hero, app cards, contact section
- /apps/[slug] : case study per app (Journeo, Inveio)
- No live demos. Use screenshots and phone mockups only.

## Design (locked)
- Reference image: /design/reference.png
- Colors: [fill in hex values]
- Fonts: [fill in, max 2]
- Layout: follow the reference image. Do not redesign.

## Hard rules
- No gradients, glassmorphism, glowing effects, or emoji icons
- No placeholder lorem ipsum. Ask me for real copy.
- Case study text lives in markdown files, written by me. Never generate it.
- GitHub token only in env variables. Fetch at build time only, never in client code.
- Keep changes small. Only touch files related to the task.
- Tell me which files you changed after each task.