# Publishing on GitHub (account: anandbhamri-dot)

This repository holds two tools and a portfolio homepage. All links point to `anandbhamri-dot`.

What the top level of the repository must look like:

```
index.html              <- portfolio homepage
README.md
HOW_TO_PUBLISH.md
rmbs-waterfall-lab/     <- contains index.html directly inside
loan-tape-analyser/     <- contains index.html directly inside
```

Live addresses once GitHub Pages is on (Settings → Pages → Deploy from a branch → main → / (root)):

- Portfolio: https://anandbhamri-dot.github.io/structured-finance-ai-lab/
- RMBS Waterfall & Stress Lab: https://anandbhamri-dot.github.io/structured-finance-ai-lab/rmbs-waterfall-lab/
- Loan Tape Analyser: https://anandbhamri-dot.github.io/structured-finance-ai-lab/loan-tape-analyser/

Common causes of "404 Page not found": a folder name that differs in spelling or capitals, an extra nested folder (e.g. `rmbs-waterfall-lab/rmbs-waterfall-lab/index.html`), or a page file not named exactly `index.html`.

To update a tool later: open its folder on GitHub → Add file → Upload files → drop in the new `index.html` → Commit changes. The live site refreshes within a few minutes.
