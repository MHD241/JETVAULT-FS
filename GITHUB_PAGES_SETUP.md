# JetVault — GitHub Pages deployment (browser only)

This project already includes `.github/workflows/pages.yml`. It builds from `main` using Node 22, runs `npm test`, builds with Vite, and deploys `dist/`. The Vite base is `./` for relative asset URLs.

1. Upload or commit the **project files** (not this ZIP as a single file) to your GitHub repository at `mhd241/jetvault-fs`, on branch `main`. Keep the directory paths unchanged. A GitHub browser upload accepts a maximum of 100 files at a time and individual files up to 25 MiB; upload in batches if necessary. Avoid overwriting with an older branch by accident.
2. In GitHub, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Go to **Actions → Deploy to GitHub Pages → Run workflow**, select `main`, and run it (or commit to `main` to trigger automatically).
4. Inspect the green/red build status. If it succeeds, the expected site is `https://mhd241.github.io/jetvault-fs/` (only after it has actually deployed).

If deployment fails, read the first failing log in Actions. Note that `npm ci`, tests and TypeScript checks run remotely, not on your Mac. The proposed Update 40 animation work has not yet been browser-tested.

GitHub Pages sites are publicly accessible even if your repository visibility differs. Do not upload secrets.
