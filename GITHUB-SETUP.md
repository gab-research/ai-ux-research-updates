# Fix repo: move workflows and add scripts folder

Your site files are good. Two things to fix on GitHub:

---

## 1. Put workflow files inside `.github/workflows/`

Right now `deploy-pages.yml` and `daily-update.yml` are in the **root**. GitHub only runs workflows that live in **.github/workflows/**.

**On GitHub:**

1. Click **Add file** → **Create new file**.
2. In the filename box type: **`.github/workflows/deploy-pages.yml`**  
   (that creates the `.github/workflows` folder).
3. Copy the contents of **deploy-pages.yml** from your project (or from below) and paste into the editor.
4. Click **Commit changes**.
5. Again **Add file** → **Create new file**.
6. Filename: **`.github/workflows/daily-update.yml`**.
7. Paste the contents of **daily-update.yml**, then **Commit changes**.
8. Delete the old files from the root: open **deploy-pages.yml** (in root) → **Delete file**. Same for **daily-update.yml**.

---

## 2. Add the `scripts` folder

The daily updater needs **scripts/update-from-feeds.js**. Without it, the daily workflow will fail.

**On GitHub:**

1. **Add file** → **Create new file**.
2. Filename: **`scripts/update-from-feeds.js`**.
3. Open **scripts/update-from-feeds.js** in your project (in Cursor), copy **all** of its content, paste into GitHub, then **Commit changes**.

---

After that, in **Settings** → **Pages** set **Source** to **GitHub Actions**. Your site should deploy and the daily update will run from the correct place.
