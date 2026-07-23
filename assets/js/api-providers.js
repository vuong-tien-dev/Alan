/* ==========================================
   API Providers - Reusable Library
   Contains: Providers, Stats, Rate Limits, API Calls
   ========================================== */

/* ==========================================
   API Providers Configuration
   ========================================== */

const API_PROVIDERS = {
    gemini: {
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
        requestDelay: 1000 // 1s delay between requests
    },
    groq: {
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
        requestDelay: 1000 // 1s delay between requests
    },
    openrouter: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
        requestDelay: 1000 // 1s delay for free tier
    },
    mistral: {
        name: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
        requestDelay: 1000 // 1s delay between requests
    },
    local: {
        name: 'Local',
        baseUrl: 'http://localhost:1234/v1',
        authHeader: (key) => ({ 'Authorization': `Bearer ${key}` }),
        requestDelay: 0
    }
};

// Track last request time per provider for rate limiting
let lastRequestTime = {};

/* Configuration - shared state */
let apiKeys = [];
let models = [];
let combinations = [];
let currentComboIndex = 0;
let currentProvider = 'gemini';

/* ==========================================
   API Statistics Tracking (with localStorage)
   ========================================== */

const API_STATS_KEY = 'api_stats';

// Load stats from localStorage
function loadApiStats() {
    try {
        const data = localStorage.getItem(API_STATS_KEY);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
}

// Save stats to localStorage
function saveApiStats(stats) {
    try {
        localStorage.setItem(API_STATS_KEY, JSON.stringify(stats));
    } catch (e) {
        console.warn('Failed to save API stats:', e);
    }
}

// Get combo ID for tracking
function getComboId(combo) {
    const keyPrefix = combo.key.substring(0, 8);
    return `${keyPrefix}...${combo.model}`;
}

// Record API call result
function recordApiCall(combo, success, errorMsg = null) {
    const stats = loadApiStats();
    const comboId = getComboId(combo);

    if (!stats[comboId]) {
        stats[comboId] = { success: 0, fail: 0, streak: 0, lastError: null, lastTime: null };
    }

    const s = stats[comboId];
    s.lastTime = new Date().toISOString();

    if (success) {
        s.success++;
        s.streak = 0;
    } else {
        s.fail++;
        s.streak++;
        s.lastError = errorMsg ? errorMsg.substring(0, 100) : 'Unknown error';
    }

    saveApiStats(stats);
}

// Get sorted stats (worst first)
function getSortedApiStats() {
    const stats = loadApiStats();
    return Object.entries(stats)
        .map(([id, s]) => ({
            id,
            ...s,
            total: s.success + s.fail,
            rate: s.success + s.fail > 0 ? Math.round((s.success / (s.success + s.fail)) * 100) : 100
        }))
        .sort((a, b) => a.rate - b.rate || b.fail - a.fail);
}

// Get health status indicator
function getHealthStatus(rate) {
    if (rate >= 80) return { icon: '🟢', class: 'health-good' };
    if (rate >= 50) return { icon: '🟡', class: 'health-warn' };
    return { icon: '🔴', class: 'health-bad' };
}

/* ==========================================
   Daily Rate Limit Tracking
   ========================================== */

const RATE_LIMIT_KEY = 'api_rate_limits';
const DEFAULT_DAILY_LIMIT = 50; // Default for free models

// Get today's date string
function getTodayString() {
    return new Date().toISOString().split('T')[0]; // "2026-01-03"
}

// Load rate limits from localStorage
function getRateLimits() {
    try {
        const data = localStorage.getItem(RATE_LIMIT_KEY);
        if (!data) return {};
        const limits = JSON.parse(data);
        const today = getTodayString();
        // Clean up old entries (from previous days)
        const cleaned = {};
        for (const [key, val] of Object.entries(limits)) {
            if (val.date === today) {
                cleaned[key] = val;
            }
        }
        return cleaned;
    } catch {
        return {};
    }
}

// Save rate limits to localStorage
function saveRateLimits(limits) {
    try {
        localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(limits));
    } catch (e) {
        console.warn('Failed to save rate limits:', e);
    }
}

// Check if combo is rate limited today
function isRateLimited(combo) {
    const limits = getRateLimits();
    const comboId = getComboId(combo);
    const entry = limits[comboId];
    if (!entry) return false;
    return entry.count >= (entry.limit || DEFAULT_DAILY_LIMIT);
}

// Increment rate limit count for combo
function incrementRateLimit(combo) {
    const limits = getRateLimits();
    const comboId = getComboId(combo);
    const today = getTodayString();

    if (!limits[comboId] || limits[comboId].date !== today) {
        limits[comboId] = { count: 0, date: today, limit: DEFAULT_DAILY_LIMIT };
    }

    limits[comboId].count++;
    saveRateLimits(limits);

    const remaining = limits[comboId].limit - limits[comboId].count;
    if (remaining <= 5) {
        console.warn(`⚠️ ${comboId}: ${remaining} requests remaining today`);
    }
}

// Set daily limit for a specific combo
function setComboLimit(combo, limit) {
    const limits = getRateLimits();
    const comboId = getComboId(combo);
    const today = getTodayString();

    if (!limits[comboId]) {
        limits[comboId] = { count: 0, date: today, limit: limit };
    } else {
        limits[comboId].limit = limit;
    }

    saveRateLimits(limits);
}

// Get rate limit info for a combo
function getRateLimitInfo(combo) {
    const limits = getRateLimits();
    const comboId = getComboId(combo);
    const entry = limits[comboId];
    if (!entry) return { count: 0, limit: DEFAULT_DAILY_LIMIT };
    return { count: entry.count, limit: entry.limit || DEFAULT_DAILY_LIMIT };
}

/* ==========================================
   OpenAI-Compatible API Call
   ========================================== */

async function callAPI(messages, tools = null, onChunk = null, onToolCall = null) {
    if (combinations.length === 0) {
        throw new Error('Chưa cấu hình API. Vào Settings để thêm API key và model.');
    }

    const startIndex = currentComboIndex;
    let lastError = null;

    do {
        const combo = combinations[currentComboIndex];
        const provider = API_PROVIDERS[currentProvider];

        // Enforce request delay if provider has one
        if (provider.requestDelay) {
            const lastTime = lastRequestTime[currentProvider] || 0;
            const elapsed = Date.now() - lastTime;
            if (elapsed < provider.requestDelay) {
                const waitTime = provider.requestDelay - elapsed;
                console.log(`⏳ Waiting ${waitTime}ms before next request...`);
                await new Promise(r => setTimeout(r, waitTime));
            }
        }

        try {
            const result = await callAPIWithCombo(combo, provider, messages, tools, onChunk, onToolCall);
            // Update last request time
            lastRequestTime[currentProvider] = Date.now();
            // Track success
            recordApiCall(combo, true);
            return result;
        } catch (e) {
            // Track failure
            recordApiCall(combo, false, e.message);

            lastError = e;
            console.warn(`⚠️ ${combo.model}: ${e.message.substring(0, 60)}`);
            currentComboIndex = (currentComboIndex + 1) % combinations.length;

            if (currentComboIndex === startIndex) {
                throw new Error(`Tất cả API đều thất bại: ${lastError.message}`);
            }
        }
    } while (true);
}

async function callAPIWithCombo(combo, provider, messages, tools, onChunk, onToolCall) {
    const url = `${provider.baseUrl}/chat/completions`;

    // Clean messages: remove internal fields and fold local thinking into assistant content.
    const cleanMessages = messages.map(msg => {
        const { id, thinking, ...cleanMsg } = msg;

        if (cleanMsg.content === null || cleanMsg.content === undefined) {
            cleanMsg.content = "";
        }

        if (cleanMsg.role === 'assistant' && typeof thinking === 'string' && thinking.trim()) {
            const contentText = typeof cleanMsg.content === 'string' ? cleanMsg.content : '';
            cleanMsg.content = `<think>${thinking}</think>${contentText ? `\n\n${contentText}` : ''}`;
        }

        return cleanMsg;
    });

    // Prepend system message if available
    let fullMessages = cleanMessages;
    if (typeof systemPrompt !== 'undefined' && systemPrompt) {
        fullMessages = [
            { role: 'system', content: systemPrompt },
            ...cleanMessages
        ];
    }

    const body = {
        model: combo.model,
        messages: fullMessages,
        stream: true
    };

    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
    }

    console.log('🚀 Request:', combo.model);
    console.log('🧾 Outbound messages JSON:\n' + JSON.stringify(fullMessages, null, 2));

    // Create abort controller for this request
    currentAbortController = new AbortController();

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...provider.authHeader(combo.key)
        },
        body: JSON.stringify(body),
        signal: currentAbortController.signal
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API ${response.status}: ${errorText.substring(0, 100)}`);
    }

    // Stream and call callbacks
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let currentToolCalls = {};

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta;
                if (!delta) continue;

                // Text content - stream immediately with delay for visual effect
                if (delta.content) {
                    fullContent += delta.content;
                    if (onChunk) {
                        onChunk(delta.content);
                        // Random delay only for Gemini (other providers send small tokens)
                        if (currentProvider === 'gemini') {
                            const delay = Math.floor(Math.random() * 60) + 10;
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }

                // Tool calls - accumulate
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!currentToolCalls[idx]) {
                            currentToolCalls[idx] = {
                                id: tc.id || `call_${Date.now()}_${idx}`,
                                type: 'function',
                                function: { name: '', arguments: '' }
                            };
                        }
                        if (tc.function?.name) {
                            currentToolCalls[idx].function.name = tc.function.name;
                        }
                        if (tc.function?.arguments) {
                            currentToolCalls[idx].function.arguments += tc.function.arguments;
                        }
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }

    // Call onToolCall for each completed tool
    const toolCalls = Object.values(currentToolCalls);
    for (const toolCall of toolCalls) {
        if (onToolCall) await onToolCall(toolCall);
    }

    return { content: fullContent, tool_calls: toolCalls };
}
