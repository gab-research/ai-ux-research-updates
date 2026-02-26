#!/usr/bin/env node
/**
 * Fetches articles from RSS feeds (UX research / AI sources), filters by keywords,
 * and writes updates.json so the website updates automatically.
 * Run daily via GitHub Actions or cron.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const Parser = require('rss-parser');

const ROOT = path.resolve(__dirname, '..');
const SOURCES_PATH = path.join(ROOT, 'sources.json');
const UPDATES_PATH = path.join(ROOT, 'updates.json');
const ANALYSES_PATH = path.join(ROOT, 'analyses.json');
const THEMES_PATH = path.join(ROOT, 'themes.json');

const USER_AGENT = 'Mozilla/5.0 (compatible; AI-UX-Research-Updates/1.0; +https://github.com/gab-research/ai-ux-research-updates)';
const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': USER_AGENT }
});

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 3).trim() + '...';
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function matchesKeywords(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/**
 * Infer theme from post title and description: focus on AI application (e.g. "Synthetic users")
 * rather than research process. Used so daily theme analysis reflects how AI is applied in research.
 */
function inferCategory(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  if (/\b(synthetic\s+user|synthetic\s+participant|LLM\s+persona|AI\s+persona|concept\s+test.*(AI|LLM)|AI.*concept\s+test)\b/.test(text)) return 'Synthetic users';
  if (/\b(transcript\s+summar|summariz|theme\s+extraction|one-?click\s+summar|synthesis.*(AI|from\s+transcript)|affinity.*AI|thematic.*AI)\b/.test(text)) return 'AI summarization';
  if (/\b(automated\s+usability|scan\s+prototype|usability\s+issue\s+detection|AI.*(a11y|accessibility)|heuristic.*AI|flag.*usability)\b/.test(text)) return 'Automated usability checks';
  if (/\b(survey.*(AI|optimiz)|questionnaire.*AI|AI.*survey|clearer\s+survey|reduce\s+bias.*survey|adaptive\s+(survey|follow-?up))\b/.test(text)) return 'Survey optimization';
  if (/\b(session\s+replay.*AI|AI.*session\s+replay|behavioral\s+pattern.*AI|drop-?off.*detection|rage\s+click|heatmap.*AI)\b/.test(text)) return 'Session replay + AI';
  if (/\b(recruit.*AI|AI.*recruit|screener.*AI|participant\s+recruitment.*AI)\b/.test(text)) return 'AI-assisted recruitment';
  if (/\b(interview.*(AI|transcript)|transcript.*interview|qualitative.*AI)\b/.test(text)) return 'Interview analysis';
  return 'Other AI in research';
}

/** Fetch raw URL with same User-Agent (for XML sanitization fallback). */
function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Status code ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Fix common XML issues: unescaped & that break parsers (e.g. in Dovetail feed). */
function sanitizeXmlForRss(xml) {
  return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;|[a-zA-Z]+\d*;)/g, '&amp;');
}

async function fetchFeed(feedConfig) {
  try {
    const feed = await parser.parseURL(feedConfig.url);
    return { feed, name: feedConfig.name };
  } catch (err) {
    const isParseError = /entity|parse|XML|invalid character/i.test(err.message);
    if (isParseError) {
      try {
        const raw = await fetchRaw(feedConfig.url);
        const sanitized = sanitizeXmlForRss(raw);
        const feed = await parser.parseString(sanitized);
        return { feed, name: feedConfig.name };
      } catch (fallbackErr) {
        console.warn(`Skipping feed ${feedConfig.name}: ${err.message}`);
        return null;
      }
    }
    console.warn(`Skipping feed ${feedConfig.name}: ${err.message}`);
    return null;
  }
}

async function main() {
  const sources = loadJSON(SOURCES_PATH);
  if (!sources || !sources.feeds || !Array.isArray(sources.feeds)) {
    console.error('Missing or invalid sources.json (needs "feeds" array).');
    process.exit(1);
  }

  const keywords = sources.keywords || ['AI', 'UX research', 'user research', 'research'];
  const maxUpdates = Math.min(Math.max(1, Number(sources.maxUpdates) || 365), 365);
  // Use CURRENT_DATE (e.g. 2026-02-25) when set (e.g. in GitHub Actions) so the site uses that as "today"
  const now = process.env.CURRENT_DATE ? (() => {
    const d = new Date(process.env.CURRENT_DATE);
    return isNaN(d.getTime()) ? new Date() : d;
  })() : new Date();

  const existing = loadJSON(UPDATES_PATH);
  const siteTitle = (existing && existing.title) || 'AI for UX Research';
  const siteSubtitle =
    (existing && existing.subtitle) || 'Daily updates on AI applications improving UX research efficiency';

  // Load or create analyses (Nubank "How to use" text by article URL)
  let analysesByUrl = loadJSON(ANALYSES_PATH);
  if (!analysesByUrl || typeof analysesByUrl !== 'object') {
    analysesByUrl = {};
    if (existing && Array.isArray(existing.updates)) {
      for (const u of existing.updates) {
        if (u.source && u.source.url && typeof u.analysis === 'string' && u.analysis.trim()) {
          analysesByUrl[u.source.url] = u.analysis.trim();
        }
      }
      try {
        fs.writeFileSync(ANALYSES_PATH, JSON.stringify(analysesByUrl, null, 2), 'utf8');
        console.log('Created ' + ANALYSES_PATH + ' from existing updates.');
      } catch (e) {
        console.warn('Could not write analyses.json:', e.message);
      }
    }
  }

  // Build a map of URL -> update so we merge with existing (keep up to maxUpdates across runs)
  const byUrl = new Map();
  if (existing && Array.isArray(existing.updates)) {
    for (const u of existing.updates) {
      const url = u.source && u.source.url;
      if (url) {
        byUrl.set(url, {
          date: u.date,
          title: u.title,
          summary: u.summary,
          content: u.content || u.summary,
          category: u.category || 'Research',
          source: u.source,
          analysis: typeof u.analysis === 'string' ? u.analysis.trim() : ''
        });
      }
    }
  }

  // Theme frequency across ALL posts from our RSS sources in the current month only.
  // Count every feed item published this month (no keyword filter, no cutoff). Do NOT use the site's curated updates.
  const today = toISODate(now);
  const currentMonthKey = today.slice(0, 7); // e.g. "2026-02"
  const themeCountsAcrossSources = {};
  const seenLinks = new Set();

  for (const feedConfig of sources.feeds) {
    const result = await fetchFeed(feedConfig);
    if (!result) continue;

    const { feed, name } = result;
    const items = feed.items || [];

    for (const item of items) {
      const pubDate = parseDate(item.pubDate);
      if (!pubDate) continue;

      const itemMonthKey = toISODate(pubDate).slice(0, 7);
      const title = (item.title && item.title.trim()) || 'Untitled';
      const description = item.contentSnippet || item.content || item.summary || '';

      // Count theme for every post in the current month (sources only; not the website's updates).
      if (itemMonthKey === currentMonthKey) {
        const theme = inferCategory(title, description);
        themeCountsAcrossSources[theme] = (themeCountsAcrossSources[theme] || 0) + 1;
      }

      // Only add to the site (byUrl) posts that were published in the current month (e.g. February 2026).
      if (itemMonthKey !== currentMonthKey) continue;

      const link = item.link && item.link.trim();
      if (!link || seenLinks.has(link)) continue;

      const textToMatch = `${title} ${description}`;
      if (!matchesKeywords(textToMatch, keywords)) continue;

      seenLinks.add(link);
      const summary = truncate(stripHtml(description || title), 280);
      const content = truncate(stripHtml(description || ''), 1200);
      const analysis = typeof analysesByUrl[link] === 'string' ? analysesByUrl[link].trim() : (byUrl.get(link) && byUrl.get(link).analysis) || '';

      const category = inferCategory(title, description);
      byUrl.set(link, {
        date: toISODate(pubDate),
        title,
        summary: summary || title,
        content: content || summary,
        category,
        source: { name, url: link },
        analysis: analysis || ''
      });
    }
  }

  const allItems = Array.from(byUrl.values());
  allItems.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const existingUpdates = existing && Array.isArray(existing.updates) ? existing.updates : [];
  let finalUpdates = allItems.length > 0 ? allItems.slice(0, maxUpdates) : existingUpdates;

  // Ensure the latest update is always dated "today" so the site shows an update from the current day
  if (finalUpdates.length > 0 && finalUpdates[0].date !== today) {
    finalUpdates = [{ ...finalUpdates[0], date: today }, ...finalUpdates.slice(1)];
  }

  // Normalize all updates to AI-application themes (so existing and new items use the same taxonomy)
  finalUpdates = finalUpdates.map((u) => ({
    ...u,
    category: inferCategory(u.title, u.summary || u.content || '')
  }));

  const output = {
    title: siteTitle,
    subtitle: siteSubtitle,
    updates: finalUpdates
  };

  fs.writeFileSync(UPDATES_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Updated ${UPDATES_PATH} with ${finalUpdates.length} items.`);

  // Top 5 themes by frequency across our RSS sources for this specific month (e.g. February).
  const topThemes = Object.entries(themeCountsAcrossSources)
    .map(([name, count]) => ({ name: name || 'Other AI in research', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const themesPayload = {
    month: currentMonthKey,
    updated: today,
    themes: topThemes,
    note: 'Based on how often each theme appears in posts from our RSS sources this month. Social media (e.g. LinkedIn) is not included—no public API.'
  };
  fs.writeFileSync(THEMES_PATH, JSON.stringify(themesPayload, null, 2), 'utf8');
  console.log(`Updated ${THEMES_PATH} with top ${topThemes.length} themes for ${currentMonthKey} (from ${Object.values(themeCountsAcrossSources).reduce((a, b) => a + b, 0)} source posts this month).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
