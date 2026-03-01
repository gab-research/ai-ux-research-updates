#!/usr/bin/env node
/**
 * Fetches articles from RSS feeds (UX research / AI sources), filters by keywords,
 * and writes updates.json so the website updates automatically.
 * Uses Google Gemini API (free tier) to analyze broader internet data and identify trending themes.
 * Run every 2 hours via GitHub Actions or cron.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const ROOT = path.resolve(__dirname, '..');
const SOURCES_PATH = path.join(ROOT, 'sources.json');
const UPDATES_PATH = path.join(ROOT, 'updates.json');
const ANALYSES_PATH = path.join(ROOT, 'analyses.json');
const THEMES_PATH = path.join(ROOT, 'themes.json');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache'
};
const FEED_TIMEOUT_MS = 18000;   // per-feed Node.js request timeout
const FEED_JOB_TIMEOUT_MS = 40000; // max time per feed (node try + Substack API/curl fallback), then skip
const MAX_POSTS_PER_SOURCE = 5;  // cap per source for theme counting to prevent one prolific blog from dominating
const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  headers: BROWSER_HEADERS
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

const RESEARCH_TERMS = /\b(research|usability|user\s+test|user\s+experience|ux\b|survey|interview|feedback|insight|synthesis|participant|recruitment|qualitative|quantitative|persona|journey\s+map|nps|voice\s+of\s+customer|sentiment|session\s+replay|heatmap|a11y|accessibility|user\s+need|discovery|user\s+study|observation|ethnograph|diary\s+stud|card\s+sort|tree\s+test|benchmark|user\s+flow|pain\s+point|empathy|affinity|stakeholder)\b/;
const RESEARCH_TERMS_PT = /\b(pesquisa|usabilidade|experiência\s+do\s+usuário|entrevista|feedback|participante|jornada\s+do\s+usuário)\b/;

function hasAIRelevance(text) {
  const lower = (text || '').toLowerCase();
  return AI_TERMS.test(lower) || AI_TERMS_PT.test(lower);
}

function hasResearchRelevance(text) {
  const lower = (text || '').toLowerCase();
  return RESEARCH_TERMS.test(lower) || RESEARCH_TERMS_PT.test(lower);
}

function matchesKeywords(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (!keywords.some((k) => lower.includes(k.toLowerCase()))) return false;
  return hasAIRelevance(text) && hasResearchRelevance(text);
}

/**
 * Infer theme from post title and description. Order matters: first match wins.
 * Patterns are intentionally broad so most UX/AI posts land in a specific theme.
 */
function inferCategory(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();

  // Synthetic users — AI participants, virtual users, simulated users
  if (/synthetic\s+(user|participant|respondent|persona)|virtual\s+(user|participant|respondent)|simulated\s+(user|participant)|ai\s+(participant|persona|respondent)|llm\s+persona|fake\s+user|digital\s+twin.*(user|participant|research)/.test(text)) return 'Synthetic users';

  // AI summarization — transcript summaries, theme extraction, affinity mapping
  if (/summariz|summar.*(transcript|note|meeting|report)|theme\s+extraction|one-?click\s+summar|synthesis.*(ai|transcript|automat)|affinity.*ai|thematic.*(ai|analysis)|insight\s+extraction|pattern\s+recognition.*(ai|research)|opportunity\s+solution\s+tree|ai.*(note|recap|minute|digest)|auto.*(summariz|transcri)/.test(text)) return 'AI summarization';

  // Automated usability checks — accessibility, heuristic evaluation, UX audit
  if (/automated\s+usability|usability\s+issue|ai.*(a11y|accessibility|audit)|heuristic.*ai|flag.*usability|ux\s+analysis|instant\s+ux|scan\s+prototype|ai.*(evaluate|check|review).*(usability|ux|interface)|ux\s+audit/.test(text)) return 'Automated usability checks';

  // AI in user testing — usability testing, unmoderated testing, tool comparisons
  if (/usability\s+test|user\s+test|ux\s+test|\buxtweak\b|\buseberry\b|\bmaze\b.*test|ux\s+benchmark|unmoderated\s+test|remote\s+test.*ai|ai.*(test.*user|user.*test)|moderated.*ai/.test(text)) return 'AI in user testing';

  // Interview analysis — interviews, qualitative research, transcript coding
  if (/\binterview.*(ai|analysis|tool|automat|transcri)|qualitative\s+(research|insight|coding|analysis)|ai.*(interview|qualitative)|\blooppanel\b|\bcondens\b|\bdovetail\b|stakeholder.*(report|ready)|insights?\s+editor|ai[- ]moderated|transcript.*(analysis|cod)/.test(text)) return 'Interview analysis';

  // AI for design & research — design tools with a research or testing connection
  if (/ai.*(design.*research|research.*design|design\s+tool.*test)|prototype.*(test|research|usability)|ai[- ]native\s+design.*(research|ux|test)/.test(text)) return 'AI for design & research';

  // Survey optimization — AI surveys, question optimization, response analysis
  if (/survey.*(ai|optimiz|design|question|tool|automat|generat)|questionnaire.*ai|ai.*(survey|poll|form)|clearer\s+survey|reduce\s+bias.*survey|adaptive\s+(survey|follow-?up)|\bwynter\b|message\s+testing|ai.*(question|response\s+analysis)/.test(text)) return 'Survey optimization';

  // Session replay + AI — behavioral analytics, heatmaps, click tracking
  if (/session\s+replay|behavioral\s+(pattern|analytics?).*ai|drop-?off.*detection|rage\s+click|heatmap.*ai|ai.*(replay|heatmap|click\s+track|behavior)|user\s+behavior.*ai/.test(text)) return 'Session replay + AI';

  // Conversational AI in research — chatbots, virtual assistants, voice AI
  if (/chatbot|conversational\s+ai|virtual\s+assistant|chat\s+bot|ai\s+sales\s+rep|voice.*ai|ai.*(chat|convers|dialog)|natural\s+language.*(process|understand)|nlu|nlp.*(research|ux|user)/.test(text)) return 'Conversational AI in research';

  // Sentiment & feedback analysis — NPS, VOC, opinion mining
  if (/sentiment|nps.*(ai|automat)|feedback\s+(analysis|loop|tool)|voice\s+of\s+(customer|user)|ai.*(sentiment|nps|feedback|opinion|review\s+analysis)|opinion\s+mining|text\s+analysis.*ai|customer\s+feedback.*ai/.test(text)) return 'Sentiment & feedback analysis';

  // AI ethics in research — bias, fairness, responsible AI, trust, privacy
  if (/ai.*(ethic|bias|fairness|trust|transparen|accountab|responsible|privacy|consent|harm)|bias.*(ai|algorithm|model)|ethical\s+ai|responsible\s+ai|ai\s+governance|algorithmic.*(bias|fairness|justice)/.test(text)) return 'AI ethics in research';

  // AI-powered data analysis — clustering, segmentation, pattern detection
  if (/ai.*(data\s+analysis|analytics|cluster|segment|pattern\s+detect|visualization|dashboard)|data.*(ai|machine\s+learn|automat.*analy)|machine\s+learning.*(analysis|data|cluster|predict)|automat.*(analysis|analytics|classify|cluster)/.test(text)) return 'AI-powered data analysis';

  // AI content generation — AI writing, report generation, UX copy
  if (/ai.*(writ|content\s+(creat|generat)|copywriting|report\s+generat|ux\s+copy|microcopy)|generat.*(content|report|copy|text|article)|llm.*(writ|generat|content)|gpt.*(writ|generat|content)/.test(text)) return 'AI content generation';

  // Predictive UX — personalization, recommendations, predictive analytics
  if (/predict.*(ux|user|experience|behavior|analytics|model)|ai.*(personali|recommend|predict)|personali.*(ai|machine|algorithm)|recommendation\s+(engine|system)|next\s+best\s+action|propensity|churn.*predict/.test(text)) return 'Predictive UX';

  // AI coding assistants — Copilot, Claude Code, Cursor, GPT for coding (split from AI strategy)
  if (/\b(copilot|claude\s+code|cursor\s+ai|codeium|tabnine|github\s+copilot)\b|ai.*(coding|code\s+assist|code\s+generat|programm|develop)|coding.*(ai|assist|copilot)/.test(text)) return 'AI coding assistants';

  // AI workforce impact — AI replacing roles, future of work, skills gap (split from AI strategy)
  if (/ai.*(replac|displac|job|career|workforce|hiring|talent|skill\s+gap|reskill|upskill|future\s+of\s+work|layoff)|future.*(work.*ai|ai.*work)|workforce.*ai|ai\s+(era|native|superpower|age\s+of)|age\s+of\s+ai/.test(text)) return 'AI workforce impact';

  // AI tool evaluation — comparing, selecting, reviewing AI tools (split from AI strategy)
  if (/ai\s+tool.*(review|compar|evaluat|select|best|top\s+\d|versus|vs|alternatives|roundup|list)|best\s+ai\s+tool|compar.*(ai|llm|gpt|claude)|ai.*(benchmark|leaderboard)|which\s+ai/.test(text)) return 'AI tool evaluation';

  // Agentic AI in research — AI agents running research tasks autonomously (split from Research automation)
  if (/agentic\s+(ai|research|ux)|ai\s+agent.*(research|ux|user|task|autonomous)|autonomous.*(research|ai\s+agent)|multi-?agent|agent.*(framework|orchestrat)|research\s+agent/.test(text)) return 'Agentic AI in research';

  // AI research tools — specific tool launches, reviews for research workflows (split from Research automation)
  if (/ai.*(research\s+tool|research\s+platform|research\s+software)|research.*(tool.*ai|platform.*ai|software.*ai)|ai\s+tools?.*(research|ux|lesson)|new\s+ai.*(tool|platform|launch)|ai\s+for\s+(ux|user)\s+research/.test(text)) return 'AI research tools';

  // AI for product management — AI in product decisions, discovery, prioritization
  if (/product.*(ai|machine\s+learn)|ai.*(product\s+(management|decision|leader|discover|backlog|priorit))|ai\s+product|product\s+manager.*ai/.test(text)) return 'AI for product management';

  // AI-assisted recruitment — participant recruitment, screener optimization
  if (/recruit.*(ai|automat)|ai.*(recruit|screener)|screener.*ai|participant\s+recruit|panel\s+management.*ai/.test(text)) return 'AI-assisted recruitment';

  // Second pass: targeted patterns for the new specific themes
  if (/\b(copilot|openai|anthropic|claude|chatgpt)\b.*(code|develop|engineer|programm)/.test(text)) return 'AI coding assistants';
  if (/\b(copilot|openai|anthropic|google\s+ai)\b.*(research|ux|user|test|study)/.test(text)) return 'AI research tools';
  if (/\b(gpt|claude|gemini|llama|chatgpt|bard|mistral)\b.*(compar|review|evaluat|benchmark|vs\b|versus)/.test(text)) return 'AI tool evaluation';
  if (/\b(gpt|claude|gemini|llama|chatgpt)\b.*(transform|chang|impact|future|replac)/.test(text)) return 'AI workforce impact';
  if (/ai.*(analys|analyz|data|metric|measure|evaluat|assess)/.test(text)) return 'AI-powered data analysis';
  if (/ai.*(generat|creat|writ|draft|produc).*(content|text|report|copy)/.test(text)) return 'AI content generation';
  if (/\b(automat|ai|machine\s+learn)\b.*(research|ux|insight|finding|discover)/.test(text)) return 'AI research tools';
  if (/\b(ai|ml|llm)\b.*(tool|platform|software|workflow|pipeline)/.test(text)) return 'AI research tools';

  return 'General AI in research';
}

/** Fix common XML issues: unescaped & that break parsers. */
function sanitizeXmlForRss(xml) {
  return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;|[a-zA-Z]+\d*;)/g, '&amp;');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch a URL using curl (different TLS fingerprint, handles edge cases). */
function fetchWithCurl(url) {
  try {
    const result = execSync(
      `curl -sS -L --max-time 15 -H "User-Agent: ${USER_AGENT}" -H "Accept: application/rss+xml, application/xml, text/xml, */*" -H "Accept-Language: en-US,en;q=0.9" "${url}"`,
      { encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 }
    );
    if (!result || !result.trim()) throw new Error('empty response');
    return result;
  } catch (e) {
    const stderr = (e.stderr || '').trim();
    throw new Error(`curl failed: ${stderr || e.message}`);
  }
}

/**
 * Fetch posts from Substack's JSON API (bypasses Cloudflare RSS blocking).
 * Returns an rss-parser-compatible feed object.
 */
function fetchSubstackApi(feedUrl) {
  const match = feedUrl.match(/https?:\/\/([^/]+\.substack\.com)/i);
  if (!match) return null;
  const domain = match[1];
  const apiUrl = `https://${domain}/api/v1/archive?sort=new&limit=12`;
  try {
    const raw = execSync(
      `curl -sS -L --max-time 15 -H "User-Agent: ${USER_AGENT}" -H "Accept: application/json" "${apiUrl}"`,
      { encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 }
    );
    const posts = JSON.parse(raw);
    if (!Array.isArray(posts) || posts.length === 0) return null;
    return {
      items: posts.map((p) => ({
        title: p.title || p.social_title || 'Untitled',
        pubDate: p.post_date,
        link: p.canonical_url || `https://${domain}/p/${p.slug}`,
        contentSnippet: p.subtitle || p.description || ''
      }))
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fetch feed via rss2json.com proxy (their servers aren't blocked by Cloudflare).
 * Free tier: 10,000 req/day — we need ~7/day.
 */
function fetchViaRss2Json(feedUrl) {
  try {
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
    const raw = execSync(
      `curl -sS -L --max-time 20 "${apiUrl}"`,
      { encoding: 'utf8', timeout: 25000, maxBuffer: 5 * 1024 * 1024 }
    );
    const data = JSON.parse(raw);
    if (data.status !== 'ok' || !data.items || data.items.length === 0) return null;
    return {
      items: data.items.map((item) => ({
        title: item.title || 'Untitled',
        pubDate: item.pubDate,
        link: item.link,
        contentSnippet: item.description || item.content || ''
      }))
    };
  } catch (e) {
    return null;
  }
}

function isSubstackUrl(url) {
  return /\.substack\.com\b/i.test(url);
}

async function fetchFeed(feedConfig) {
  // Step 1: Try rss-parser (Node.js HTTP client)
  try {
    const feed = await parser.parseURL(feedConfig.url);
    return { feed, name: feedConfig.name };
  } catch (nodeErr) {
    // Step 2 (Substack only): Try Substack JSON API — bypasses Cloudflare
    if (isSubstackUrl(feedConfig.url)) {
      const feed = fetchSubstackApi(feedConfig.url);
      if (feed) {
        console.log(`  ↳ ${feedConfig.name}: fetched via Substack API`);
        return { feed, name: feedConfig.name };
      }
      // Step 3 (Substack only): Try rss2json.com proxy — their IPs aren't blocked
      const proxyFeed = fetchViaRss2Json(feedConfig.url);
      if (proxyFeed) {
        console.log(`  ↳ ${feedConfig.name}: fetched via rss2json.com proxy`);
        return { feed: proxyFeed, name: feedConfig.name };
      }
      console.warn(`Skipping feed ${feedConfig.name}: RSS ${nodeErr.message}, Substack API and rss2json proxy also failed`);
      return null;
    }

    // Step 3: Try curl with XML sanitization (handles parse errors and slow responses)
    try {
      console.log(`  ↳ ${feedConfig.name}: retrying with curl…`);
      const raw = fetchWithCurl(feedConfig.url);
      const sanitized = sanitizeXmlForRss(raw);
      const feed = await parser.parseString(sanitized);
      return { feed, name: feedConfig.name };
    } catch (curlErr) {
      console.warn(`Skipping feed ${feedConfig.name}: ${nodeErr.message}`);
      return null;
    }
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

/**
 * Fetch a Google News RSS feed via curl. These are theme-only feeds —
 * they contribute to theme analysis but never add posts to the site.
 */
function fetchGoogleNewsFeed(feedConfig) {
  try {
    const raw = execSync(
      `curl -sS -L --max-time 15 -H "User-Agent: ${USER_AGENT}" -H "Accept: application/rss+xml, application/xml, text/xml, */*" "${feedConfig.url}"`,
      { encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 }
    );
    if (!raw || !raw.trim()) return null;
    const sanitized = sanitizeXmlForRss(raw);
    return parser.parseString(sanitized).then((feed) => ({
      feed,
      name: feedConfig.name
    }));
  } catch (e) {
    return Promise.resolve(null);
  }
}

/**
 * Collect article titles for theme analysis from all sources (curated + Google News).
 * Curated RSS blogs are capped at MAX_POSTS_PER_SOURCE to prevent one blog from
 * dominating. Google News feeds have no cap since they aggregate many sources.
 */
function collectThemeTitles(feedResults, themeResults, currentMonthKey) {
  const allTitles = [];
  const seenTitles = new Set();

  function processResults(results, cap) {
    for (const result of results) {
      if (!result) continue;
      const { feed, name } = result;
      const items = feed.items || [];
      let sourceCount = 0;

      for (const item of items) {
        if (cap && sourceCount >= cap) break;
        const pubDate = parseDate(item.pubDate);
        if (!pubDate) continue;

        const itemMonthKey = toISODate(pubDate).slice(0, 7);
        if (itemMonthKey !== currentMonthKey) continue;

        const title = (item.title && item.title.trim()) || '';
        const description = stripHtml(item.contentSnippet || item.content || item.summary || '');
        if (!title) continue;

        const titleLower = title.toLowerCase();
        if (seenTitles.has(titleLower)) continue;

        if (!hasAIRelevance(`${title} ${description}`)) continue;

        seenTitles.add(titleLower);
        allTitles.push({ title, description: truncate(description, 200), source: name });
        sourceCount++;
      }
    }
  }

  processResults(feedResults, MAX_POSTS_PER_SOURCE);
  processResults(themeResults, 0);
  return allTitles;
}

/**
 * Use Google Gemini API (free tier) to analyze collected article titles and
 * identify the top 10 trending themes about AI applications in UX/user research.
 * Returns an array of { name, count } objects, or null if the API is unavailable.
 */
async function analyzeThemesWithGemini(titles, currentMonthKey) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('No GEMINI_API_KEY set — falling back to regex theme analysis.');
    return null;
  }

  if (titles.length === 0) {
    console.log('No titles to analyze — skipping Gemini API call.');
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const titleList = titles
    .map((t, i) => `${i + 1}. "${t.title}" (${t.source})`)
    .join('\n');

  const prompt = `You are an analyst tracking trends in AI applied to UX and user research.

Below are ${titles.length} article titles published in ${currentMonthKey} from various sources across the internet (blogs, news sites, and industry publications). Each article is about AI applied to research, design, or product work.

ARTICLES:
${titleList}

Analyze these articles and identify the 10 most prominent themes about **specific AI applications**. Each theme must be actionable — a researcher reading the theme name should immediately understand what tools, techniques, or capabilities it refers to.

GOOD theme examples (use these exact names when they fit):
- Synthetic users
- AI summarization
- AI coding assistants
- Agentic AI in research
- AI tool evaluation
- AI workforce impact
- AI research tools
- Interview analysis
- AI-powered data analysis
- AI content generation
- Predictive UX
- Automated usability checks
- Survey optimization
- Session replay + AI
- Conversational AI in research
- Sentiment & feedback analysis
- AI for product management
- AI-assisted recruitment
- AI ethics in research
- AI for design & research

BANNED theme names (NEVER use these — they are too broad and not actionable):
- "General AI in research"
- "AI strategy & literacy"
- "AI strategy"
- "AI literacy"
- "Research automation"
- "AI trends"
- "AI adoption"
- "AI transformation"
- "Other"
- "Miscellaneous"
- Any name containing the word "general" or "other"

If an article doesn't fit any specific theme, skip it. It is better to have fewer well-categorized articles than to dump them into a vague bucket.

Rules:
- Each theme name should be short (2-5 words), describing a specific AI application
- Each theme must include a brief description (1 sentence) explaining what kind of content it covers
- Count how many articles relate to each theme (one article can match at most one theme)
- Sort by count descending
- Return ONLY valid JSON, no other text

Return this exact JSON format:
[
  { "name": "Theme name", "count": 3, "description": "Brief explanation of what this theme covers." },
  { "name": "Theme name", "count": 2, "description": "Brief explanation of what this theme covers." }
]`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in response');

      const themes = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(themes) || themes.length === 0) throw new Error('Empty themes array');

      const BANNED_NAMES = /general ai|ai strategy|ai literacy|research automation|ai trends|ai adoption|ai transformation|other|miscellaneous/i;
      const validated = themes
        .filter((t) => t.name && typeof t.count === 'number' && !BANNED_NAMES.test(t.name))
        .slice(0, 10);

      if (validated.length === 0) throw new Error('No valid themes after validation');

      console.log(`Gemini identified ${validated.length} themes from ${titles.length} articles.`);
      return validated;
    } catch (e) {
      const is429 = /429|too many|quota/i.test(e.message);
      if (is429 && attempt < 2) {
        const wait = (attempt + 1) * 30000;
        console.warn(`  Theme analysis rate-limited, waiting ${wait / 1000}s before retry (attempt ${attempt + 1}/3)…`);
        await sleep(wait);
        continue;
      }
      console.warn(`Gemini API theme analysis failed: ${e.message} — falling back to regex.`);
      return null;
    }
  }
  return null;
}

/**
 * Use Gemini to generate a richer content summary and a "How to use at Nubank"
 * analysis for a single post. Returns { content, analysis } or null on failure.
 * Retries up to 2 times on 429 rate-limit errors with exponential backoff.
 */
async function enrichPostWithGemini(model, post, attempt = 0) {
  const prompt = `You are a senior UX researcher at Nubank, a large digital bank in Brazil. You help the research team stay current on AI applications in UX research.

Article title: "${post.title}"
Source: ${post.source.name}
Snippet: "${post.summary}"

Generate two sections in English:

1. CONTENT: Write a 3-5 sentence summary expanding on this article. Explain the key idea, why it matters for UX researchers, and any practical implications. Do NOT repeat the snippet verbatim — add depth and context.

2. ANALYSIS: Write a practical "How to use at Nubank" guide (2-3 short paragraphs). Cover: where this fits in Nubank's research workflow, how researchers should apply it, and any guardrails or limitations. Reference Nubank products and flows where relevant (e.g. PIX, loans, card activation, onboarding, insurance). Be specific and actionable.

Return ONLY valid JSON with no other text:
{ "content": "...", "analysis": "..." }`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    // Remove control characters that break JSON.parse
    const sanitized = jsonMatch[0].replace(/[\x00-\x1f\x7f]/g, (ch) =>
      ch === '\n' || ch === '\r' || ch === '\t' ? ch : ' '
    );
    const parsed = JSON.parse(sanitized);
    if (!parsed.content || !parsed.analysis) return null;

    return {
      content: parsed.content.trim(),
      analysis: parsed.analysis.trim()
    };
  } catch (e) {
    const is429 = /429|too many|quota/i.test(e.message);
    if (is429 && attempt < 2) {
      const wait = (attempt + 1) * 30000;
      console.warn(`  Rate-limited, waiting ${wait / 1000}s before retry…`);
      await sleep(wait);
      return enrichPostWithGemini(model, post, attempt + 1);
    }
    console.warn(`  Gemini enrichment failed for "${post.title.slice(0, 50)}…": ${e.message}`);
    return null;
  }
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
      return hasAIRelevance(postText) && hasResearchRelevance(postText);
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
      if (!hasAIRelevance(postText) || !hasResearchRelevance(postText)) continue;
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

  const today = toISODate(now);
  const currentMonthKey = today.slice(0, 7); // e.g. "2026-02"
  const seenLinks = new Set();

  // Fetch curated RSS feeds and Google News theme feeds in parallel.
  const themeFeeds = sources.themeFeeds || [];
  const [feedResults, ...themeResults] = await Promise.all([
    Promise.all(sources.feeds.map((fc) => fetchFeedWithTimeout(fc))),
    ...themeFeeds.map((tf) => fetchGoogleNewsFeed(tf).catch(() => null))
  ]);

  const successfulThemeFeeds = themeResults.filter(Boolean).length;
  console.log(`Fetched ${successfulThemeFeeds}/${themeFeeds.length} Google News theme feeds.`);

  // Process curated feeds for site posts (same as before).
  for (const result of feedResults) {
    if (!result) continue;

    const { feed, name } = result;
    const items = feed.items || [];

    for (const item of items) {
      const pubDate = parseDate(item.pubDate);
      if (!pubDate) continue;

      const title = (item.title && item.title.trim()) || 'Untitled';
      const description = item.contentSnippet || item.content || item.summary || '';

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

  // --- Theme analysis (runs BEFORE enrichment to get API quota priority) ---
  const themeTitles = collectThemeTitles(feedResults, themeResults, currentMonthKey);
  console.log(`Collected ${themeTitles.length} AI-relevant article titles for theme analysis (${currentMonthKey}).`);

  let topThemes = await analyzeThemesWithGemini(themeTitles, currentMonthKey);

  if (!topThemes) {
    console.log('Using regex fallback for theme analysis.');
    const themeCountsAcrossSources = {};
    for (const t of themeTitles) {
      const theme = inferCategory(t.title, t.description);
      themeCountsAcrossSources[theme] = (themeCountsAcrossSources[theme] || 0) + 1;
    }

    const THEME_DESCRIPTIONS = {
      'Synthetic users': 'AI-generated participants and virtual personas for early-stage concept testing.',
      'AI summarization': 'Automated transcript summaries, theme extraction, and affinity mapping.',
      'Automated usability checks': 'AI-powered accessibility audits, heuristic evaluations, and UX analysis.',
      'Survey optimization': 'AI tools for designing better surveys, reducing bias, and analyzing responses.',
      'Session replay + AI': 'AI-enhanced session replays, heatmaps, and behavioral pattern detection.',
      'Interview analysis': 'AI-assisted interview transcription, coding, and qualitative analysis.',
      'Conversational AI in research': 'Chatbots, virtual assistants, and voice AI in research contexts.',
      'Sentiment & feedback analysis': 'AI for NPS analysis, opinion mining, and customer feedback processing.',
      'AI for design & research': 'Design tools and prototyping with a research or usability testing connection.',
      'AI in user testing': 'AI-powered usability testing, remote testing tools, and benchmark comparisons.',
      'AI for product management': 'AI in product decisions, discovery, prioritization, and roadmapping.',
      'AI ethics in research': 'Bias, fairness, responsible AI, privacy, and trust in research.',
      'AI-powered data analysis': 'Automated data analysis, clustering, segmentation, and pattern detection.',
      'AI content generation': 'AI writing, report generation, UX copy, and content creation.',
      'Predictive UX': 'Personalization, recommendation engines, and predictive user analytics.',
      'AI-assisted recruitment': 'AI for participant recruitment, screener optimization, and panel management.',
      'AI coding assistants': 'Copilot, Claude Code, Cursor, and other AI tools for code generation and development.',
      'AI workforce impact': 'AI replacing roles, future of work, skills gap, reskilling, and organizational change.',
      'AI tool evaluation': 'Comparing, benchmarking, and selecting AI tools and LLMs for specific use cases.',
      'Agentic AI in research': 'Autonomous AI agents running research tasks, multi-agent frameworks, and orchestration.',
      'AI research tools': 'New AI tool launches, reviews, and platforms built for research workflows.',
    };

    const EXCLUDED_THEMES = ['General AI in research'];
    const APPLICATION_THEMES = Object.keys(THEME_DESCRIPTIONS);
    topThemes = Object.entries(themeCountsAcrossSources)
      .filter(([name]) => !EXCLUDED_THEMES.includes(name))
      .map(([name, count]) => ({
        name,
        count,
        description: THEME_DESCRIPTIONS[name] || ''
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    if (topThemes.length < 10) {
      const seen = new Set(topThemes.map((t) => t.name));
      for (const themeName of APPLICATION_THEMES) {
        if (seen.has(themeName)) continue;
        topThemes.push({ name: themeName, count: 0, description: THEME_DESCRIPTIONS[themeName] || '' });
        if (topThemes.length >= 10) break;
      }
      topThemes = topThemes.sort((a, b) => b.count - a.count).slice(0, 10);
    }
  }

  const themesPayload = {
    month: currentMonthKey,
    updated: today,
    themes: topThemes,
    note: 'Themes identified by analyzing articles from curated sources and Google News this month.'
  };
  fs.writeFileSync(THEMES_PATH, JSON.stringify(themesPayload, null, 2), 'utf8');
  console.log(`Updated ${THEMES_PATH} with top ${topThemes.length} themes for ${currentMonthKey} (from ${themeTitles.length} articles analyzed).`);

  // --- Enrich posts with Gemini (content summary + Nubank analysis) ---
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const enrichModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const MAX_ENRICH_PER_RUN = 20;

    const toEnrich = finalUpdates.filter((u) => {
      const needsContent = !u.content || u.content === u.summary;
      const needsAnalysis = !u.analysis || u.analysis.trim() === '';
      return needsContent || needsAnalysis;
    });

    const batch = toEnrich.slice(0, MAX_ENRICH_PER_RUN);
    if (batch.length > 0) {
      console.log(`Enriching ${batch.length} of ${toEnrich.length} posts with Gemini (content + Nubank analysis)…`);
      let enriched = 0;
      for (const post of batch) {
        const result = await enrichPostWithGemini(enrichModel, post);
        if (result) {
          if (result.content) post.content = result.content;
          if (result.analysis) {
            post.analysis = result.analysis;
            const url = post.source && post.source.url;
            if (url) analysesByUrl[url] = result.analysis;
          }
          enriched++;
        }
        await sleep(5000);
      }
      console.log(`Enriched ${enriched}/${batch.length} posts.${toEnrich.length > MAX_ENRICH_PER_RUN ? ` ${toEnrich.length - MAX_ENRICH_PER_RUN} remaining for next run.` : ''}`);
    }
  } else {
    console.log('No GEMINI_API_KEY set — skipping post enrichment.');
  }

  // Persist analyses so they survive across runs.
  try {
    fs.writeFileSync(ANALYSES_PATH, JSON.stringify(analysesByUrl, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not write analyses.json:', e.message);
  }

  const output = {
    title: siteTitle,
    subtitle: siteSubtitle,
    lastUpdated: new Date().toISOString(),
    updates: finalUpdates
  };

  fs.writeFileSync(UPDATES_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Updated ${UPDATES_PATH} with ${finalUpdates.length} items.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
