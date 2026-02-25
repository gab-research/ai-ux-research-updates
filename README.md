# AI for UX Research — Daily Updates

A website that shows daily updates about AI applications used in the market to improve UX research efficiency. **Content can update automatically** by pulling new articles from the web (RSS feeds).

## Automatic daily updates (no manual adding)

The site can refresh itself every day by fetching new articles from trusted UX and AI research sources (RSS feeds), filtering by relevance, and updating `updates.json` for you.

### How to turn on automatic updates

1. **Put the project on GitHub**
   - Create a new repository on [GitHub](https://github.com/new).
   - Push this folder to it (or upload the files).

2. **That’s it**
   - GitHub Actions will run **once per day** (at 12:00 UTC) and:
     - Fetch the latest posts from the feeds in `sources.json`
     - Keep only items that mention AI, UX research, usability, etc.
     - Rewrite `updates.json` with the newest articles and their real source URLs, and merge in “How to use at Nubank” analyses from `analyses.json` (and from your current updates on first run).

3. **If you host the site from GitHub (e.g. GitHub Pages)**
   - Each run that changes `updates.json` will commit and push, so the next deployment shows the new content.

4. **Run the update yourself anytime**
   - In the repo: **Actions** → **Daily content update** → **Run workflow**.

You don’t add new items by hand; the script finds them on the internet and updates the site.

### What it uses (sources)

- **sources.json** — List of RSS feeds (Nielsen Norman Group, Dovetail, UX Collective, Hotjar, Typeform, Maze, etc.) and keywords used to filter relevant posts.
- **scripts/update-from-feeds.js** — Fetches those feeds, filters by keywords, merges in Nubank analyses, and writes `updates.json`.
- **analyses.json** — (Created automatically on first run.) Maps article URL → “How to use at Nubank” text. New posts from feeds get analysis only if the URL is listed here. To add analysis for a new article, add an entry: `"https://example.com/article-url": "Your analysis text."`

To add or remove sources, edit **sources.json** (add/remove entries in `feeds`, or change `keywords`, `maxUpdates`, `daysBack`).

### Run the updater on your computer (optional)

```bash
npm install
npm run update
```

This updates `updates.json` locally. Then commit and push if you want the site to show the new content.

---

## What’s in this project

| File / folder | Purpose |
|---------------|--------|
| **index.html** | Main page (hero, intro, updates feed). |
| **styles.css** | Styling. |
| **script.js** | Loads and displays `updates.json`. |
| **updates.json** | List of updates shown on the site. **Updated automatically** by the script, or you can edit it by hand. |
| **sources.json** | Feeds and keywords for automatic updates. |
| **analyses.json** | (Auto-created from current updates if missing.) Article URL → Nubank analysis text. Edit to add analyses for new posts. |
| **scripts/update-from-feeds.js** | Script that fetches feeds and rewrites `updates.json`. |
| **.github/workflows/daily-update.yml** | GitHub Action that runs the script every day. |

## Manual updates (optional)

You can still edit **updates.json** yourself to add or change an update. Use the same structure as before (date, title, summary, content, category, source with name and url). The next automatic run will replace `updates.json` with feed-based content, so manual edits will be overwritten unless you turn off or change the workflow.

## View the website locally

Browsers often block loading `updates.json` when you open `index.html` with `file://`. Use a local server:

**Python:**

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000**

**Node:**

```bash
npx serve .
```

Then open the URL it prints (e.g. **http://localhost:3000**).

## Customizing

- **Colors and fonts** — Edit the variables at the top of **styles.css** (`:root`).
- **Site title and tagline** — Edit the `<header>` in **index.html**.
- **Which sources are used** — Edit **sources.json** (feeds and keywords).

No Expo or extra accounts needed; the site is plain HTML/CSS/JS and (optionally) runs on GitHub Actions for automatic daily updates.
