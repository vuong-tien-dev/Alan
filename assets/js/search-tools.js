/* ==========================================
   Search Tool - Google Custom Search API + HTML Fallback
   ========================================== */

/* ==========================================
   Search Hint Configuration
   ========================================== */
const ENABLE_SEARCH_HINT = true; // Set to true to hint model to use openUrl() for deeper content
const SEARCH_HINT_MESSAGE = "Remember: search result snippets are limited. Use openUrl() to fetch full content from the most relevant links to provide a comprehensive answer.";

const ENABLE_READINESS_HINT = true; // Set to true to hint model to check if they can answer before calling more tools

/**
 * Get readiness check hint for model
 * @param {string} userQuestion - The original user question
 * @returns {string} Hint message
 */
function getReadinessHint(userQuestion) {
    if (!userQuestion) return '';
    return `Can you answer the user's question "${userQuestion}" now? If yes, provide a comprehensive answer. If you need more information, continue using available tools.`;
}

/* ==========================================
   Google Custom Search API Configuration
   ========================================== */

// Hardcoded fallback keys (each gets 100 free queries/day)
const GOOGLE_SEARCH_DEFAULT_KEYS = [
    { key: 'AIzaSyDVfZpVKPGg_KpMdn2zFJ-EFRpo_hrXCpo', cx: 'f50a50cea301c4041' },
];

// Load combined keys: user config + fallback
function getGoogleSearchKeys() {
    const keys = [...GOOGLE_SEARCH_DEFAULT_KEYS];

    // Load user config from localStorage
    try {
        const config = JSON.parse(localStorage.getItem('google_search_config') || '{}');
        if (config.key && config.cx) {
            // User config takes priority (add at beginning)
            keys.unshift({ key: config.key, cx: config.cx });
        }
    } catch (e) {
        console.warn('Failed to load Google Search config:', e);
    }

    return keys;
}

// Rate limit storage key
const RATE_LIMIT_STORAGE_KEY = 'google_search_rate_limits';

/**
 * Get rate limited keys (blocked for today)
 */
function getRateLimitedKeys() {
    try {
        const data = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
        if (!data) return {};
        const limits = JSON.parse(data);
        const today = new Date().toDateString();
        // Clean up old entries
        const cleaned = {};
        for (const [key, date] of Object.entries(limits)) {
            if (date === today) cleaned[key] = date;
        }
        return cleaned;
    } catch {
        return {};
    }
}

/**
 * Mark a key as rate limited for today
 */
function markKeyRateLimited(apiKey) {
    const limits = getRateLimitedKeys();
    limits[apiKey] = new Date().toDateString();
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(limits));
    console.log(`⚠️ API key rate limited for today:`, apiKey.substring(0, 10) + '...');
}

/**
 * Get available API keys (not rate limited)
 */
function getAvailableApiKeys() {
    const rateLimited = getRateLimitedKeys();
    return getGoogleSearchKeys().filter(k => !rateLimited[k.key]);
}

/**
 * Search using Google Custom Search JSON API
 * @returns {Array|null} Results or null if failed
 */
async function searchWithGoogleAPI(query, num) {
    const availableKeys = getAvailableApiKeys();
    if (availableKeys.length === 0) {
        console.log('⚠️ No available Google API keys (all rate limited)');
        return null;
    }

    // Try each available key
    for (const { key, cx } of availableKeys) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(query)}&num=${num}`;
            const response = await fetch(url);

            if (response.status === 429 || response.status === 403) {
                // Rate limited or quota exceeded
                markKeyRateLimited(key);
                continue;
            }

            if (response.ok) {
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                    const results = data.items.map(item => ({
                        title: item.title || 'Result',
                        snippet: item.snippet || '',
                        url: item.link || ''
                    }));
                    console.log(`✅ Google API: ${results.length} results`);
                    return results;
                }
            }
        } catch (e) {
            console.log(`❌ Google API failed:`, e.message);
        }
    }
    return null;
}

/* ==========================================
   HTML Parsers (Fallback)
   ========================================== */

/**
 * Parse DuckDuckGo HTML search results
 * @param {string} html - Raw HTML from DuckDuckGo
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseDuckDuckGoHTML(html, maxResults) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const resultNodes = doc.querySelectorAll('.result');

    for (const node of Array.from(resultNodes).slice(0, maxResults)) {
        const titleNode = node.querySelector('a.result__a');
        const snippetNode = node.querySelector('a.result__snippet');

        if (titleNode) {
            let url = titleNode.getAttribute('href') || '';
            if (url.includes('uddg=')) {
                const match = url.match(/uddg=([^&]+)/);
                if (match) url = decodeURIComponent(match[1]);
            }
            results.push({
                title: titleNode.textContent?.trim() || 'Result',
                snippet: snippetNode?.textContent?.trim() || '',
                url: url
            });
        }
    }
    return results;
}

/**
 * Parse Bing HTML search results
 * @param {string} html - Raw HTML from Bing
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseBingHTML(html, maxResults) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Bing uses li.b_algo for organic results
    const resultNodes = doc.querySelectorAll('li.b_algo');

    for (const node of Array.from(resultNodes).slice(0, maxResults)) {
        const titleNode = node.querySelector('h2 a');
        const snippetNode = node.querySelector('.b_caption p') || node.querySelector('p');

        if (titleNode) {
            results.push({
                title: titleNode.textContent?.trim() || 'Result',
                snippet: snippetNode?.textContent?.trim() || '',
                url: titleNode.getAttribute('href') || ''
            });
        }
    }
    return results;
}

/**
 * Parse Google HTML search results
 * @param {string} html - Raw HTML from Google
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseGoogleHTML(html, maxResults) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Google uses div.g for organic results
    const resultNodes = doc.querySelectorAll('div.g');

    for (const node of Array.from(resultNodes).slice(0, maxResults)) {
        const titleNode = node.querySelector('h3');
        const linkNode = node.querySelector('a');
        const snippetNode = node.querySelector('div[data-sncf]') ||
            node.querySelector('.VwiC3b') ||
            node.querySelector('span.st');

        if (titleNode && linkNode) {
            const url = linkNode.getAttribute('href') || '';
            if (url.startsWith('http')) {
                results.push({
                    title: titleNode.textContent?.trim() || 'Result',
                    snippet: snippetNode?.textContent?.trim() || '',
                    url: url
                });
            }
        }
    }
    return results;
}

/**
 * Parse Brave Search HTML results
 * @param {string} html - Raw HTML from Brave Search
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseBraveHTML(html, maxResults) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Brave uses div.snippet for results
    const resultNodes = doc.querySelectorAll('div.snippet');

    for (const node of Array.from(resultNodes).slice(0, maxResults)) {
        const titleNode = node.querySelector('a.result-header');
        const snippetNode = node.querySelector('p.snippet-description');

        if (titleNode) {
            results.push({
                title: titleNode.textContent?.trim() || 'Result',
                snippet: snippetNode?.textContent?.trim() || '',
                url: titleNode.getAttribute('href') || ''
            });
        }
    }
    return results;
}

/**
 * Parse Qwant HTML search results
 * @param {string} html - Raw HTML from Qwant
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseQwantHTML(html, maxResults) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Qwant uses data-testid for web results
    const resultNodes = doc.querySelectorAll('[data-testid="webResult"]');

    for (const node of Array.from(resultNodes).slice(0, maxResults)) {
        const linkNode = node.querySelector('a');
        const titleNode = node.querySelector('h2') || node.querySelector('span');
        const snippetNode = node.querySelector('p');

        if (linkNode && titleNode) {
            const url = linkNode.getAttribute('href') || '';
            if (url.startsWith('http')) {
                results.push({
                    title: titleNode.textContent?.trim() || 'Result',
                    snippet: snippetNode?.textContent?.trim() || '',
                    url: url
                });
            }
        }
    }
    return results;
}

/**
 * Parse Startpage HTML search results (uses Google results)
 * @param {string} html - Raw HTML from Startpage
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Array<{title: string, snippet: string, url: string}>}
 */
function parseStartpageHTML(html, maxResults) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Startpage uses .w-gl__result for results
    const resultNodes = doc.querySelectorAll('.w-gl__result');

    for (const node of Array.from(resultNodes).slice(0, maxResults)) {
        const titleNode = node.querySelector('a.w-gl__result-title');
        const snippetNode = node.querySelector('p.w-gl__description');

        if (titleNode) {
            results.push({
                title: titleNode.textContent?.trim() || 'Result',
                snippet: snippetNode?.textContent?.trim() || '',
                url: titleNode.getAttribute('href') || ''
            });
        }
    }
    return results;
}

/**
 * Perform web search using Google API (primary) or HTML scraping (fallback)
 * @param {string} query - Search query
 * @param {number} num - Maximum number of results (default 5, max 10)
 * @param {string} userQuestion - Original user question for readiness hint
 * @returns {Promise<{success: boolean, query: string, results: Array, source: string}>}
 */
async function webSearch(query, num = 5, userQuestion = '') {
    num = Math.min(num || 5, 10);
    console.log('🔍 Searching:', query);

    // 1. Try Google Custom Search API first (if keys configured)
    if (getGoogleSearchKeys().length > 0) {
        const apiResults = await searchWithGoogleAPI(query, num);
        if (apiResults && apiResults.length > 0) {
            const response = { success: true, query, results: apiResults, source: 'Google API' };
            const hints = [];
            if (ENABLE_SEARCH_HINT) hints.push(SEARCH_HINT_MESSAGE);
            if (ENABLE_READINESS_HINT) hints.push(getReadinessHint(userQuestion));
            if (hints.length > 0) response._system_instruction_ = hints.join(' ');
            return response;
        }
        console.log('⚠️ Google API failed, falling back to HTML scraping...');
    }

    // 2. Fallback: HTML scraping with CORS proxies

    // CORS proxies
    const corsProxies = [
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    // Search engines
    const searchEngines = [
        {
            name: 'DuckDuckGo',
            getUrl: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
            parse: (html, max) => parseDuckDuckGoHTML(html, max)
        },
        {
            name: 'Brave',
            getUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
            parse: (html, max) => parseBraveHTML(html, max)
        },
        {
            name: 'Google',
            getUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}&num=${num}`,
            parse: (html, max) => parseGoogleHTML(html, max)
        },
        {
            name: 'Qwant',
            getUrl: (q) => `https://www.qwant.com/?q=${encodeURIComponent(q)}&t=web`,
            parse: (html, max) => parseQwantHTML(html, max)
        },
        {
            name: 'Startpage',
            getUrl: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
            parse: (html, max) => parseStartpageHTML(html, max)
        }
    ];

    // Helper: fetch and parse one engine with one proxy
    async function tryEngine(engine, getProxyUrl) {
        try {
            const searchUrl = engine.getUrl(query);
            const proxyUrl = getProxyUrl(searchUrl);
            const response = await fetch(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });

            if (response.ok) {
                let html = await response.text();
                try {
                    const json = JSON.parse(html);
                    html = json.contents || json.data || html;
                } catch { }

                const results = engine.parse(html, num * 2); // Get more for merging
                if (results.length > 0) {
                    console.log(`✅ ${engine.name}: ${results.length} results`);
                    return { engine: engine.name, results };
                }
            }
        } catch (e) {
            console.log(`❌ ${engine.name} failed:`, e.message);
        }
        return null;
    }

    // Pick first 3 engines to search in parallel
    const primaryEngines = searchEngines.slice(0, 3);
    const primaryProxy = corsProxies[0];

    // Search 3 engines in parallel
    console.log('🚀 Searching 3 engines in parallel...');
    const promises = primaryEngines.map(engine => tryEngine(engine, primaryProxy));
    const results = await Promise.allSettled(promises);

    // Collect all successful results
    const allResults = [];
    const sources = [];

    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            sources.push(result.value.engine);
            allResults.push(...result.value.results);
        }
    }

    // If we got results, dedupe and return
    if (allResults.length > 0) {
        // Dedupe by URL
        const seenUrls = new Set();
        const uniqueResults = [];
        for (const r of allResults) {
            const normalizedUrl = r.url.replace(/\/$/, '').toLowerCase();
            if (!seenUrls.has(normalizedUrl)) {
                seenUrls.add(normalizedUrl);
                uniqueResults.push(r);
            }
        }

        const finalResults = uniqueResults.slice(0, num);
        console.log(`✅ Merged ${allResults.length} → ${finalResults.length} unique results from: ${sources.join(', ')}`);
        const response = { success: true, query, results: finalResults, source: sources.join('+') };
        const hints = [];
        if (ENABLE_SEARCH_HINT) hints.push(SEARCH_HINT_MESSAGE);
        if (ENABLE_READINESS_HINT) hints.push(getReadinessHint(userQuestion));
        if (hints.length > 0) response._system_instruction_ = hints.join(' ');
        return response;
    }

    // Fallback: try remaining engines sequentially with all proxies
    console.log('⚠️ Primary search failed, trying fallback...');
    for (const getProxyUrl of corsProxies) {
        for (const engine of searchEngines) {
            const result = await tryEngine(engine, getProxyUrl);
            if (result) {
                const response = { success: true, query, results: result.results.slice(0, num), source: result.engine };
                const hints = [];
                if (ENABLE_SEARCH_HINT) hints.push(SEARCH_HINT_MESSAGE);
                if (ENABLE_READINESS_HINT) hints.push(getReadinessHint(userQuestion));
                if (hints.length > 0) response._system_instruction_ = hints.join(' ');
                return response;
            }
        }
    }

    // Ultimate fallback
    console.log('⚠️ All engines failed, returning fallback links');
    const response = {
        success: true,
        query,
        results: [
            {
                title: `DuckDuckGo: ${query}`,
                snippet: 'Nhấp để xem kết quả tìm kiếm',
                url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
            },
            {
                title: `Google: ${query}`,
                snippet: 'Nhấp để xem kết quả tìm kiếm',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
            }
        ],
        source: 'Fallback'
    };
    const hints = [];
    if (ENABLE_SEARCH_HINT) hints.push(SEARCH_HINT_MESSAGE);
    if (ENABLE_READINESS_HINT) hints.push(getReadinessHint(userQuestion));
    if (hints.length > 0) response._system_instruction_ = hints.join(' ');
    return response;
}

/* ==========================================
   Open URL Tool - Fetch and Extract Content
   ========================================== */

// Extract text content from HTML
function extractTextFromHtml(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    temp.querySelectorAll('script, style, nav, header, footer, aside, noscript').forEach(el => el.remove());
    return (temp.textContent || temp.innerText || '').replace(/\s+/g, ' ').trim();
}

// Fetch with timeout helper
async function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

// Fetch single URL - race all proxies (fastest wins)
async function fetchSingleUrl(url) {
    const proxyUrls = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        `https://thingproxy.freeboard.io/fetch/${url}`
    ];

    // Race all proxies - first successful response wins
    const fetchPromises = proxyUrls.map(async (proxyUrl) => {
        const response = await fetchWithTimeout(proxyUrl, 8000);
        if (!response.ok) throw new Error('Response not ok');

        let content = await response.text();
        try {
            const json = JSON.parse(content);
            content = json.contents || json.data || content;
        } catch { }

        const textContent = extractTextFromHtml(content);
        const truncated = textContent.length > 6000
            ? textContent.substring(0, 6000) + '...[truncated]'
            : textContent;
        return { success: true, url, content: truncated };
    });

    try {
        // Promise.any returns first fulfilled promise
        return await Promise.any(fetchPromises);
    } catch (e) {
        // All proxies failed
        return { success: false, url, error: 'Không thể truy cập URL' };
    }
}

/**
 * Open URL(s) - supports single or multiple URLs in parallel
 * @param {string|Array<string>} urlOrUrls - Single URL or array of URLs (max 5)
 * @param {string} userQuestion - Original user question for readiness hint
 * @returns {Promise<{success: boolean, content: string, ...}>}
 */
async function openUrl(urlOrUrls, userQuestion = '') {
    // Normalize to array
    let urls = [];
    if (typeof urlOrUrls === 'string') {
        urls = [urlOrUrls];
    } else if (Array.isArray(urlOrUrls)) {
        urls = urlOrUrls.slice(0, 5); // Max 5 URLs
    } else {
        return { success: false, error: 'Invalid URL parameter' };
    }

    console.log('🌐 Opening', urls.length, 'URL(s):', urls);

    if (urls.length === 1) {
        // Single URL - simple case
        const result = await fetchSingleUrl(urls[0]);
        const hints = [];
        if (ENABLE_READINESS_HINT) hints.push(getReadinessHint(userQuestion));
        if (hints.length > 0) result._system_instruction_ = hints.join(' ');
        return result;
    }

    // Multiple URLs - fetch in parallel
    const results = await Promise.allSettled(urls.map(url => fetchSingleUrl(url)));

    const successResults = [];
    const failedUrls = [];

    results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value.success) {
            successResults.push({
                url: urls[i],
                content: result.value.content
            });
        } else {
            failedUrls.push(urls[i]);
        }
    });

    console.log(`✅ Fetched ${successResults.length}/${urls.length} URLs`);

    if (successResults.length === 0) {
        return { success: false, error: 'Không thể truy cập các URL' };
    }

    // Merge results
    const mergedContent = successResults.map((r, i) =>
        `=== [${i + 1}] ${r.url} ===\n${r.content}`
    ).join('\n\n');

    const response = {
        success: true,
        urlCount: successResults.length,
        failedCount: failedUrls.length,
        results: successResults.map(r => ({ url: r.url, contentLength: r.content.length })),
        content: mergedContent
    };
    const hints = [];
    if (ENABLE_READINESS_HINT) hints.push(getReadinessHint(userQuestion));
    if (hints.length > 0) response._system_instruction_ = hints.join(' ');
    return response;
}
