# DevTeleport landing page

Static HTML, CSS and JavaScript matching the desktop app's graphite/mint theme. No website dependencies, external fonts, analytics, backend, API keys or environment variables. Product screenshots are checked-in copies from the desktop visual review's disposable fixture.

## Local preview

From the repository root:

```sh
npm run dev:website
```

Open http://localhost:4173. Refresh after changes. To use another port: `PORT=4174 npm run dev:website`.

## Build

```sh
npm run build:website
```

The build validates internal links and directly referenced local assets, then copies only public website files to `dist/website`. It does not install or build the desktop application. Node.js 24+ matches this repository's runtime requirement. The build script also works directly with `node scripts/build-website.mjs`, without installing npm dependencies.

## Deploy on Vercel

1. Push these changes to your GitHub repository.
2. In Vercel, select **Add New → Project** and import `atulvjd/devteleport`.
3. Leave **Root Directory** at the repository root (`.`). Use **Other** as the framework preset if prompted.
4. Deploy. The root `vercel.json` configures installation (`node --version`, intentionally skipping application dependencies), build (`node scripts/build-website.mjs`) and output (`dist/website`). No environment variables are needed.

The equivalent settings, if entered manually, are:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`.`) |
| Framework Preset | Other |
| Install Command | `node --version` |
| Build Command | `node scripts/build-website.mjs` |
| Output Directory | `dist/website` |
| Node.js | 24.x |

Or, with the Vercel CLI already authenticated, run `vercel` from the repository root for a preview and `vercel --prod` for production. Publishing is a separate user action; the website scripts do not deploy anything.

Vercel configuration reference: https://vercel.com/docs/project-configuration/vercel-json

## Content and assets

- `index.html`: sections, release links, metadata and initial accessible content.
- `style.css`: desktop-matched tokens and responsive layouts.
- `site.js`: screenshot/recipe tabs, keyboard navigation, copy controls and mobile menu.
- `assets/`: diamond favicon and four actual desktop screenshots.
- All desktop download CTAs link to the explicit `v0.2.0` release page, because this is a prerelease and GitHub's `/latest` redirect can omit prereleases. The release page chooses the available artifacts; asset filenames are not guessed.
- CLI recipes follow `docs/CLI.md` and the project README. Placeholder filesystem paths/LAN addresses must be adapted by the reader.
- When updating the project version, review the release links, npm command, compatibility boundaries and FAQs together. Screenshot fixtures are examples rather than visitor workspace data.
- Excluded secrets, saved-state scope, unsigned desktop status and experimental LAN transfer are described in the page. No unsupported platform or security certification is advertised.

Only `dist/website` is deployed. The app source, local evidence, installers and snapshot files are outside that output.
