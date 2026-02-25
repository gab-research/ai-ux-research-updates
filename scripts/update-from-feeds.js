#!/usr/bin/env node
/**
 * Fetches articles from RSS feeds (UX research / AI sources), filters by keywords,
 * and writes updates.json so the website updates automatically.
 * Run daily via GitHub Actions or cron.
 */

const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const ROOT = path.resolve(__dirname, '..');
const SOURCES_PATH = path.join(ROOT, 'sources.json');
const UPDATES_PATH = path.join(ROOT, 'updates.json');
const ANALYSES_PATH = path.join(ROOT, 'analyses.json');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'AI-UX-Research-Updates-Bot/1.0' }
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

async function fetchFeed(feedConfig) {
  try {
    const feed = await parser.parseURL(feedConfig.url);
    return { feed, name: feedConfig.name };
  } catch (err) {
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
  const daysBack = Number(sources.daysBack) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

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

  const seenLinks = new Set();
  for (const feedConfig of sources.feeds) {
    const result = await fetchFeed(feedConfig);
    if (!result) continue;

    const { feed, name } = result;
    const items = feed.items || [];

    for (const item of items) {
      const link = item.link && item.link.trim();
      if (!link || seenLinks.has(link)) continue;

      const pubDate = parseDate(item.pubDate);
      if (!pubDate || pubDate < cutoff) continue;

      const title = (item.title && item.title.trim()) || 'Untitled';
      const description = item.contentSnippet || item.content || item.summary || '';
      const textToMatch = `${title} ${description}`;
      if (!matchesKeywords(textToMatch, keywords)) continue;

      seenLinks.add(link);
      const summary = truncate(stripHtml(description || title), 280);
      const content = truncate(stripHtml(description || ''), 1200);
      const analysis = typeof analysesByUrl[link] === 'string' ? analysesByUrl[link].trim() : (byUrl.get(link) && byUrl.get(link).analysis) || '';

      byUrl.set(link, {
        date: toISODate(pubDate),
        title,
        summary: summary || title,
        content: content || summary,
        category: 'Research',
        source: { name, url: link },
        analysis: analysis || ''
      });
    }
  }

  const allItems = Array.from(byUrl.values());
  allItems.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const existingUpdates = existing && Array.isArray(existing.updates) ? existing.updates : [];
  const finalUpdates = allItems.length > 0 ? allItems.slice(0, maxUpdates) : existingUpdates;

  const output = {
    title: siteTitle,
    subtitle: siteSubtitle,
    updates: finalUpdates
  };

  fs.writeFileSync(UPDATES_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Updated ${UPDATES_PATH} with ${finalUpdates.length} items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
