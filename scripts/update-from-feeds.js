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
const FEED_TIMEOUT_MS = 10000;   // per-feed request timeout
const FEED_JOB_TIMEOUT_MS = 18000; // max time per feed (fetch + fallback), then skip so no feed can hang the run
const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
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

const AI_TERMS = /\b(ai|artificial\s+intelligence|llm|gpt|claude|gemini|machine\s+learning|genai|generative\s+ai|agentic|synthetic\s+user|automated|automation|chatbot|copilot|neural|deep\s+learning|nlp|natural\s+language)\b/;
const AI_TERMS_PT = /\b(ia|inteligência\s+artificial|ferramentas\s+de\s+ia|automação\s+com\s+ia|modelos\s+de\s+linguagem)\b/;

function hasAIRelevance(text) {
  const lower = (text || '').toLowerCase();
  return AI_TERMS.test(lower) || AI_TERMS_PT.test(lower);
}

function matchesKeywords(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (!keywords.some((k) => lower.includes(k.toLowerCase()))) return false;
  return hasAIRelevance(text);
}

/**
 * Infer theme from post title and description. Order matters: first match wins.
 * Patterns are intentionally broad so most UX/AI posts land in a specific theme.
 */
function inferCategory(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();

  // Synthetic users — synthetic participants, AI personas
  if (/synthetic\s+users?|synthetic\s+participant|llm\s+persona|ai\s+persona|synthetic\s+user\s+panel/.test(text)) return 'Synthetic users';

  // AI summarization — transcript summaries, theme extraction, affinity mapping, opportunity trees
  if (/summariz|summar.*transcript|theme\s+extraction|one-?click\s+summar|synthesis.*(ai|transcript)|affinity.*ai|thematic.*ai|insight\s+extraction|pattern\s+recognition.*(ai|research)|opportunity\s+solution\s+tree/.test(text)) return 'AI summarization';

  // Automated usability checks — must be before "AI for design" and "AI in user testing" to catch "usability issue detection"
  if (/automated\s+usability|usability\s+issue\s+detection|ai.*(a11y|accessibility)|heuristic.*ai|flag.*usability|ux\s+analysis.*parameter|instant\s+ux\s+analysis|scan\s+prototype/.test(text)) return 'Automated usability checks';

  // AI in user testing — must be before "AI for design" to catch UXtweak/Useberry tool comparisons
  if (/usability\s+test|user\s+test|ux\s+test|\buxtweak\b|\buseberry\b|ux\s+benchmark|unmoderated\s+test/.test(text)) return 'AI in user testing';

  // Interview analysis — interviews, qualitative research, known qual tools (Looppanel, Condens, Dovetail)
  if (/\binterview|qualitative\s+(research|insight|coding)|\blooppanel\b|\bcondens\b|\bdovetail\b|stakeholder.*(report|ready)|insights?\s+editor|ai[- ]moderated/.test(text)) return 'Interview analysis';

  // AI for design — UXPin, prototyping with AI/Claude/GPT, AI design tools, Figma alternatives
  if (/\buxpin\b|prototype.*(claude|gpt|ai|merge)|ai.*(design\s+tool|prototyp|wireframe)|design\s+tool.*(ai|alternative)|figma.*(ai|alternative)|ai[- ]native\s+design|ai\s+prototype|code[- ]backed\s+design|react\s+component.*(ai|design)/.test(text)) return 'AI for design';

  // Survey optimization — survey AI, question optimization, message testing tools
  if (/survey.*(ai|optimiz|design|question)|questionnaire.*ai|ai.*survey|clearer\s+survey|reduce\s+bias.*survey|adaptive\s+(survey|follow-?up)|\bwynter\b|message\s+testing/.test(text)) return 'Survey optimization';

  // Session replay + AI
  if (/session\s+replay|behavioral\s+pattern.*ai|drop-?off.*detection|rage\s+click|heatmap.*ai/.test(text)) return 'Session replay + AI';

  // Conversational AI in research — chatbots, AI sales reps, voice+AI workflows
  if (/chatbot|conversational\s+ai|virtual\s+assistant|chat\s+bot|ai\s+sales\s+rep|voice.*ai.*workflow/.test(text)) return 'Conversational AI in research';

  // Sentiment & feedback analysis
  if (/sentiment.*(ai|automat|ml)|nps.*(ai|automat)|feedback\s+analysis|voice\s+of\s+customer|ai.*(sentiment|nps|feedback\s+analysis)/.test(text)) return 'Sentiment & feedback analysis';

  // AI strategy & literacy — AI skills, responsible AI, AI impact on work, AI tools guidance
  if (/ai\s+(skill|literacy|native|era|superpower|coding\s+tool)|responsible.*(ai|developer)|ai\s+writes|poisoning.*ai|context\s+rot.*ai|ai.*gets?\s+worse|valuable\s+skill.*ai|age\s+of\s+ai|ai.*consult/.test(text)) return 'AI strategy & literacy';

  // AI for product management — AI in product decisions, opportunity trees with AI, product leadership + AI
  if (/product\s+talk.*ai|ai.*product\s+(management|decision|leader)|claude\s+code|ai\s+product/.test(text)) return 'AI for product management';

  // Research automation — AI across research, AI tools for UX, agentic AI
  if (/ai.*research\s+process|research.*automat|ai\s+tools?.*(research|ux|lesson)|ai\s+across.*research|research\s+recommend|ai.*user\s+research|agentic\s+ai/.test(text)) return 'Research automation';

  // AI-assisted recruitment
  if (/recruit.*ai|ai.*recruit|screener.*ai|participant\s+recruitment/.test(text)) return 'AI-assisted recruitment';

  return 'General AI in research';
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
    req.setTimeout(FEED_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
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

/** Call fetchFeed but never wait longer than FEED_JOB_TIMEOUT_MS; skip feed on timeout so one slow feed can't hang the run. */
function fetchFeedWithTimeout(feedConfig) {
  return Promise.race([
    fetchFeed(feedConfig),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), FEED_JOB_TIMEOUT_MS)
    )
  ]).catch((err) => {
    if (err.message === 'timeout') {
      console.warn(`Skipping feed ${feedConfig.name}: exceeded ${FEED_JOB_TIMEOUT_MS / 1000}s`);
    }
    return null;
  });
}

async function main() {
  // Re-categorize all existing posts with current theme definitions (no feed fetch).
  if (process.argv.includes('--categories-only')) {
    const existing = loadJSON(UPDATES_PATH);
    if (!existing || !Array.isArray(existing.updates)) {
      console.error('No updates.json or empty updates.');
      process.exit(1);
    }
    const filtered = existing.updates.filter((u) => {
      const postText = `${u.title || ''} ${u.summary || ''} ${u.content || ''}`;
      return hasAIRelevance(postText);
    });
    const updated = filtered.map((u) => ({
      ...u,
      category: inferCategory(u.title, u.summary || u.content || '')
    }));
    const removed = existing.updates.length - updated.length;
    const output = {
      title: existing.title || 'AI for UX Research',
      subtitle: existing.subtitle || 'Daily updates on AI applications improving UX research efficiency',
      lastUpdated: new Date().toISOString(),
      updates: updated
    };
    fs.writeFileSync(UPDATES_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log('Updated categories for ' + updated.length + ' posts in ' + UPDATES_PATH + (removed > 0 ? ' (removed ' + removed + ' non-AI posts).' : '.'));
    process.exit(0);
  }

  const sources = loadJSON(SOURCES_PATH);
  if (!sources || !sources.feeds || !Array.isArray(sources.feeds)) {
    console.error('Missing or invalid sources.json (needs "feeds" array).');
    process.exit(1);
  }

  const keywords = sources.keywords || ['AI', 'UX research', 'user research', 'research'];
  const maxUpdates = Math.min(Math.max(1, Number(sources.maxUpdates) || 365), 365);
  const daysBack = Math.min(Math.max(1, Number(sources.daysBack) || 30), 365);
  // Use CURRENT_DATE when set (e.g. in GitHub Actions) so the site uses that as "today"
  const now = process.env.CURRENT_DATE ? (() => {
    const d = new Date(process.env.CURRENT_DATE);
    return isNaN(d.getTime()) ? new Date() : d;
  })() : new Date();
  const cutoff = new Date(now);
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

  // Build a map of URL -> update so we merge with existing (keep up to maxUpdates across runs).
  // Skip existing posts that don't pass the AI relevance check (removes non-AI posts from earlier runs).
  const byUrl = new Map();
  if (existing && Array.isArray(existing.updates)) {
    for (const u of existing.updates) {
      const url = u.source && u.source.url;
      if (!url) continue;
      const postText = `${u.title || ''} ${u.summary || ''} ${u.content || ''}`;
      if (!hasAIRelevance(postText)) continue;
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

  // Theme frequency across ALL posts from our RSS sources in the current month only.
  // Count every feed item published this month (no keyword filter, no cutoff). Do NOT use the site's curated updates.
  const today = toISODate(now);
  const currentMonthKey = today.slice(0, 7); // e.g. "2026-02"
  const themeCountsAcrossSources = {};
  const seenLinks = new Set();

  // Fetch all feeds in parallel; each feed is capped at FEED_JOB_TIMEOUT_MS so none can hang the run for hours.
  const feedResults = await Promise.all(sources.feeds.map((fc) => fetchFeedWithTimeout(fc)));

  for (const result of feedResults) {
    if (!result) continue;

    const { feed, name } = result;
    const items = feed.items || [];

    for (const item of items) {
      const pubDate = parseDate(item.pubDate);
      if (!pubDate) continue;

      const itemMonthKey = toISODate(pubDate).slice(0, 7);
      const title = (item.title && item.title.trim()) || 'Untitled';
      const description = item.contentSnippet || item.content || item.summary || '';

      // Count theme for every AI-relevant post in the current month (sources only; not the website's updates).
      if (itemMonthKey === currentMonthKey && hasAIRelevance(`${title} ${description}`)) {
        const theme = inferCategory(title, description);
        themeCountsAcrossSources[theme] = (themeCountsAcrossSources[theme] || 0) + 1;
      }

      // Add to the site (byUrl) any post from the last N days so we pick up new content (including today).
      if (pubDate < cutoff) continue;

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

  // Deduplicate by URL, then sort newest-first.
  const allItems = Array.from(byUrl.values());
  allItems.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  const existingUpdates = existing && Array.isArray(existing.updates) ? existing.updates : [];
  let finalUpdates = allItems.length > 0 ? allItems.slice(0, maxUpdates) : existingUpdates;

  // Apply current theme definitions to every post so past posts match the new themes (once per run).
  finalUpdates = finalUpdates.map((u) => ({
    ...u,
    category: inferCategory(u.title, u.summary || u.content || '')
  }));

  const output = {
    title: siteTitle,
    subtitle: siteSubtitle,
    lastUpdated: new Date().toISOString(),
    updates: finalUpdates
  };

  fs.writeFileSync(UPDATES_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Updated ${UPDATES_PATH} with ${finalUpdates.length} items.`);

  // Top 5 themes by frequency across our RSS sources for this specific month (e.g. February).
  const APPLICATION_THEMES = [
    'Synthetic users',
    'AI summarization',
    'Automated usability checks',
    'Survey optimization',
    'Session replay + AI',
    'Interview analysis',
    'Conversational AI in research',
    'Sentiment & feedback analysis',
    'AI for design',
    'Research automation',
    'AI in user testing',
    'AI strategy & literacy',
    'AI for product management',
    'General AI in research'
  ];
  let topThemes = Object.entries(themeCountsAcrossSources)
    .map(([name, count]) => ({ name: name || 'General AI in research', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  // If we have fewer than 5 themes (e.g. only "Other" had count), fill with other application themes at 0 so we show 5 distinct AI-application themes.
  if (topThemes.length < 5) {
    const seen = new Set(topThemes.map((t) => t.name));
    for (const themeName of APPLICATION_THEMES) {
      if (seen.has(themeName)) continue;
      topThemes.push({ name: themeName, count: 0 });
      if (topThemes.length >= 5) break;
    }
    topThemes = topThemes.sort((a, b) => b.count - a.count).slice(0, 5);
  }
  const themesPayload = {
    month: currentMonthKey,
    updated: today,
    themes: topThemes,
    note: 'Based on how often each theme appears in posts from our RSS sources this month. Social media (e.g. LinkedIn) is not included—no public API.'
  };
  fs.writeFileSync(THEMES_PATH, JSON.stringify(themesPayload, null, 2), 'utf8');
  console.log(`Updated ${THEMES_PATH} with top ${topThemes.length} themes for ${currentMonthKey} (from ${Object.values(themeCountsAcrossSources).reduce((a, b) => a + b, 0)} source posts this month).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
