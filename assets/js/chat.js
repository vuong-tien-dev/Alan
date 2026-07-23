/* ==========================================
   Gemini Chat - OpenAI Compatible Format
   Note: API logic is in api-providers.js
   ========================================== */

/* Constants */
const BREAKPOINT_MD = 768;
const CONFIG_KEY = 'gemini_chat_config';

/* Chat State */
var allowSearch = true;
var conversationEl = document.querySelector('.chat-conversation');
var chatInputWrapperEl = document.querySelector('.chat-input-wrapper');
var chatInputEl = chatInputWrapperEl.querySelector('.chat-input');
var chatSendStopWrapper = document.querySelector('.send-stop-btn-wrapper');
var uploadedImageListEl = document.querySelector('.uploaded-image-list-wrapper');
var conversationObj = createNewConversation();
var conversationHistory = []; // OpenAI format messages
var isProcessing = false;
var shouldAutoScroll = true;
var userClickStop = false;
var isCollapseWhenResize = false;
var currentAbortController = null; // For canceling requests
var systemPrompt = null; // Cached system prompt

// Load system prompt from file
async function loadSystemPrompt() {
    if (systemPrompt) return systemPrompt;

    try {
        const response = await fetch('./system_instructions.txt');
        if (response.ok) {
            let text = await response.text();
            // Replace {{currentDateTime}} placeholder
            const now = new Date();
            const dateStr = now.toLocaleDateString('vi-VN', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
            text = text.replace(/\{\{currentDateTime\}\}/g, dateStr);
            systemPrompt = text;
            console.log('✅ System prompt loaded');
            return systemPrompt;
        }
    } catch (e) {
        console.warn('⚠️ Could not load system_instructions.txt:', e.message);
    }
    return null;
}

// Load system prompt on startup
loadSystemPrompt();

// Stop current request
function stopCurrentRequest() {
    userClickStop = true;
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
    isProcessing = false;
    chatSendStopWrapper.classList.remove('stop-state');
    console.log('🛑 Request stopped by user');
}

/* ==========================================
   API Stats UI (logic is in api-providers.js)
   ========================================== */

// Clear all API stats
function clearApiStats() {
    localStorage.removeItem(API_STATS_KEY);
    renderApiStatsTab();
    console.log('📊 API stats cleared');
}

// Render stats tab content
function renderApiStatsTab() {
    const container = document.querySelector('.api-stats-list');
    if (!container) return;

    const stats = getSortedApiStats();

    if (stats.length === 0) {
        container.innerHTML = '<div class="stats-empty">Chưa có dữ liệu thống kê</div>';
        return;
    }

    container.innerHTML = stats.map(s => {
        const health = getHealthStatus(s.rate);
        // Get rate limit info for this combo
        const limits = getRateLimits();
        const limitInfo = limits[s.id] || { count: 0, limit: DEFAULT_DAILY_LIMIT };
        const usageText = `${limitInfo.count}/${limitInfo.limit}`;
        const isLimited = limitInfo.count >= limitInfo.limit;

        return `
            <div class="stats-item ${health.class} ${isLimited ? 'rate-limited' : ''}">
                <div class="stats-item-header">
                    <span class="health-icon">${health.icon}</span>
                    <span class="stats-combo-id">${s.id}</span>
                    ${isLimited ? '<span class="limited-badge">HẾT QUOTA</span>' : ''}
                </div>
                <div class="stats-item-details">
                    <span>Hôm nay: ${usageText}</span>
                    <span>Fail: ${s.fail}</span>
                    <span>Rate: ${s.rate}%</span>
                </div>
                ${s.lastError ? `<div class="stats-item-error">${s.lastError}</div>` : ''}
            </div>
        `;
    }).join('');
}

// Initialize
window.initialHeight = window.innerHeight;
updateChatHeader(conversationObj);

/* ==========================================
   Tools Definition - OpenAI Format
   ========================================== */

const TOOLS = [
    {
        type: "function",
        function: {
            name: "webSearch",
            description: "Search the web for current information, news, or facts. Use this when the user asks about recent events, needs up-to-date information, or wants to find something online.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query to find information"
                    },
                    num: {
                        type: "integer",
                        description: "Number of results to return (8-20). Choose based on query complexity: simple facts = 8, comparisons/lists = 10-15, comprehensive research = 15-20."
                    }
                },
                required: ["query", "num"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "openUrl",
            description: "Open and read content from URL(s). Fetches in parallel and merges results. IMPORTANT: After webSearch, use this with relevant URLs instead of searching again.",
            parameters: {
                type: "object",
                properties: {
                    urls: {
                        type: "array",
                        items: { type: "string" },
                        description: "URLs to open (1-5 URLs)"
                    }
                },
                required: ["urls"]
            }
        }
    }
];

const toolIcons = {
    "webSearch": { icon: "ph ph-magnifying-glass", name: "Tìm kiếm web" },
    "openUrl": { icon: "ph ph-globe", name: "Mở URL" }
};

/* ==========================================
   Theme & Layout
   ========================================== */

document.body.addEventListener('theme-change', (e) => {
    let currentThemeOptionEl = document.querySelector('.theme-option.active');
    if (currentThemeOptionEl) currentThemeOptionEl.classList.remove('active');
    let themeOptionEl = document.querySelector(`.theme-option.theme-${e.detail.newTheme}`);
    if (themeOptionEl) themeOptionEl.classList.add('active');
});

const chatHeadingEl = document.querySelector('.chat-heading');
const headingHeight = chatHeadingEl ? chatHeadingEl.offsetHeight : 0;
const chatBodyEl = document.querySelector('.chat-body');
if (chatBodyEl) {
    chatBodyEl.style.height = headingHeight > 0 ? `calc(100% - ${headingHeight}px)` : '100%';
}

window.addEventListener('resize', () => {
    if (window.innerWidth <= BREAKPOINT_MD && !isCollapseWhenResize) {
        document.querySelector('.sidebar-wrapper').classList.remove('mobile-show');
        document.querySelector('.content-container.chat-container').classList.add('expanded');
        isCollapseWhenResize = true;
    } else if (window.innerWidth > BREAKPOINT_MD && isCollapseWhenResize) {
        isCollapseWhenResize = false;
    }
});

chatInputEl.addEventListener('input', adjustHeight);
adjustHeight();

function adjustHeight() {
    chatInputEl.style.height = 'auto';
    chatInputEl.style.height = chatInputEl.scrollHeight + 'px';
}

// Accent Color Management
function setAccentColor(el) {
    const color = el.dataset.color;
    if (!color) return;

    // Apply colors to CSS variables
    document.documentElement.style.setProperty('--accent-color', color);
    document.documentElement.style.setProperty('--accent-color-light', color + '1a');  // 10% opacity
    document.documentElement.style.setProperty('--accent-color-medium', color + '4d'); // 30% opacity
    document.documentElement.style.setProperty('--accent-color-dark', color + 'b3');   // 70% opacity

    // Save to localStorage
    localStorage.setItem('accent_color', color);

    // Update active state
    document.querySelectorAll('.accent-color-option').forEach(opt => opt.classList.remove('active'));
    el.classList.add('active');
}

function loadAccentColor() {
    const savedColor = localStorage.getItem('accent_color');
    if (savedColor) {
        document.documentElement.style.setProperty('--accent-color', savedColor);
        document.documentElement.style.setProperty('--accent-color-light', savedColor + '1a');
        document.documentElement.style.setProperty('--accent-color-medium', savedColor + '4d');
        document.documentElement.style.setProperty('--accent-color-dark', savedColor + 'b3');

        // Mark active option
        const activeOpt = document.querySelector(`.accent-color-option[data-color="${savedColor}"]`);
        if (activeOpt) activeOpt.classList.add('active');
    } else {
        // Default color is active
        const defaultOpt = document.querySelector('.accent-color-option[data-color="#1a9b8c"]');
        if (defaultOpt) defaultOpt.classList.add('active');
    }
}

// Load accent color on startup
document.addEventListener('DOMContentLoaded', loadAccentColor);

/* ==========================================
   Markdown Renderer
   ========================================== */

const md = window.markdownit();

md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const code = token.content.trim();
    const lang = token.info.trim() || 'text';
    return createCodeBlockHTML(code, lang);
};

function createCodeBlockHTML(code, lang) {
    const encodedCode = encodeURIComponent(code);
    let highlighted = code;
    if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
        try {
            highlighted = hljs.highlight(code, { language: lang }).value;
        } catch (e) { }
    }
    return `
        <div class="code-block">
            <div class="code-header d-flex justify-content-between align-items-center py-2 px-3">
                <div class="left">${lang}</div>
                <div class="right">
                    <div class="copy-code-btn d-flex align-items-center gap-2" onclick="copyToClipboard(decodeURIComponent('${encodedCode}'), this)">
                        <i class="ph ph-copy mt-1"></i>
                        <span>Sao chép</span>
                    </div>
                </div>
            </div>
            <pre class="rounded-2"><code class="language-${lang}">${highlighted}</code></pre>
        </div>`;
}

function renderMarkdown(text) {
    try {
        return md.render(text);
    } catch (e) {
        return text.replace(/\n/g, '<br>');
    }
}

/* ==========================================
   Configuration Management (Per Provider)
   ========================================== */

// Store config per provider: { gemini: { apiKeys: '', models: '' }, openai: {...}, groq: {...} }
let providerConfigs = {};

function loadAllProviderConfigs() {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) {
        providerConfigs = JSON.parse(saved);
    }

    // Load values into UI for each provider
    document.querySelectorAll('.provider-panel').forEach(panel => {
        const providerId = panel.dataset.provider;
        const config = providerConfigs[providerId] || {};
        const apiKeysInput = panel.querySelector('.provider-api-keys');
        const modelsInput = panel.querySelector('.provider-models');

        if (apiKeysInput) apiKeysInput.value = config.apiKeys || '';
        if (modelsInput) modelsInput.value = config.models || '';

        // Update status
        updateProviderStatus(providerId);
    });

    // Apply current provider's config
    applyCurrentProviderConfig();

    // Load Google Search config
    loadGoogleSearchConfig();

    // Load saved provider selection
    const savedProvider = localStorage.getItem('selected_provider');
    if (savedProvider && API_PROVIDERS[savedProvider]) {
        currentProvider = savedProvider;
        applyCurrentProviderConfig();
        updateProviderUI();
    }
}

// Export all config (for backup)
function exportConfig() {
    const config = {
        providerConfigs: providerConfigs,
        selectedProvider: currentProvider,
        googleSearchConfig: JSON.parse(localStorage.getItem('google_search_config') || '{}'),
        apiStats: JSON.parse(localStorage.getItem(API_STATS_KEY) || '{}')
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `alan-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Import config (from backup)
function importConfig() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const config = JSON.parse(await file.text());

            if (config.providerConfigs) {
                providerConfigs = config.providerConfigs;
                localStorage.setItem(CONFIG_KEY, JSON.stringify(providerConfigs));
            }
            if (config.selectedProvider && API_PROVIDERS[config.selectedProvider]) {
                currentProvider = config.selectedProvider;
                localStorage.setItem('selected_provider', config.selectedProvider);
            }
            if (config.googleSearchConfig) {
                localStorage.setItem('google_search_config', JSON.stringify(config.googleSearchConfig));
            }
            if (config.apiStats) {
                localStorage.setItem(API_STATS_KEY, JSON.stringify(config.apiStats));
            }

            alert('✅ Import thành công! Đang reload...');
            location.reload();
        } catch (err) {
            alert('❌ Import thất bại: ' + err.message);
        }
    };
    input.click();
}

function saveProviderConfig(providerId) {
    const panel = document.querySelector(`.provider-panel[data-provider="${providerId}"]`);
    if (!panel) return;

    const apiKeysInput = panel.querySelector('.provider-api-keys');
    const modelsInput = panel.querySelector('.provider-models');

    providerConfigs[providerId] = {
        apiKeys: apiKeysInput ? apiKeysInput.value.trim() : '',
        models: modelsInput ? modelsInput.value.trim() : ''
    };

    localStorage.setItem(CONFIG_KEY, JSON.stringify(providerConfigs));

    // Update status
    updateProviderStatus(providerId);

    // If this is current provider, apply config
    if (providerId === currentProvider) {
        applyCurrentProviderConfig();
    }

    console.log('✅ Saved config for', providerId);
}

// Google Search config (separate from providers)
function saveGoogleSearchConfig() {
    const panel = document.querySelector('.provider-panel[data-provider="google-search"]');
    if (!panel) return;

    const keyInput = panel.querySelector('.google-search-key');
    const cxInput = panel.querySelector('.google-search-cx');

    const config = {
        key: keyInput ? keyInput.value.trim() : '',
        cx: cxInput ? cxInput.value.trim() : ''
    };

    localStorage.setItem('google_search_config', JSON.stringify(config));

    // Update status
    const status = panel.querySelector('.provider-status');
    if (status) {
        status.textContent = config.key && config.cx ? '✓' : '';
    }

    console.log('✅ Saved Google Search config');
}

function loadGoogleSearchConfig() {
    try {
        const config = JSON.parse(localStorage.getItem('google_search_config') || '{}');
        const panel = document.querySelector('.provider-panel[data-provider="google-search"]');
        if (!panel) return;

        const keyInput = panel.querySelector('.google-search-key');
        const cxInput = panel.querySelector('.google-search-cx');

        if (keyInput) keyInput.value = config.key || '';
        if (cxInput) cxInput.value = config.cx || '';

        // Update status
        const status = panel.querySelector('.provider-status');
        if (status) {
            status.textContent = config.key && config.cx ? '✓' : '';
        }
    } catch (e) {
        console.warn('Failed to load Google Search config:', e);
    }
}

function applyCurrentProviderConfig() {
    const config = providerConfigs[currentProvider] || {};
    const apiKeysStr = config.apiKeys || '';
    const modelsStr = config.models || '';

    apiKeys = apiKeysStr ? apiKeysStr.split(',').map(k => k.trim()).filter(k => k) : [];
    models = modelsStr ? modelsStr.split(',').map(m => m.trim()).filter(m => m) : [];

    combinations = [];
    for (const key of apiKeys) {
        for (const model of models) {
            combinations.push({ key, model });
        }
    }
    currentComboIndex = 0;
    console.log('📋', currentProvider, '- Combinations:', combinations.map(c => c.model));
}

function updateProviderStatus(providerId) {
    const panel = document.querySelector(`.provider-panel[data-provider="${providerId}"]`);
    if (!panel) return;

    const config = providerConfigs[providerId] || {};
    const hasKeys = config.apiKeys && config.apiKeys.trim();
    const hasModels = config.models && config.models.trim();
    const statusEl = panel.querySelector('.provider-status');

    if (statusEl) {
        if (hasKeys && hasModels) {
            statusEl.textContent = '✓ Configured';
            statusEl.style.color = 'var(--text-color)';
        } else {
            statusEl.textContent = '';
        }
    }
}

function toggleProviderPanel(headerEl) {
    const panel = headerEl.closest('.provider-panel');
    const content = panel.querySelector('.provider-panel-content');
    const isExpanded = panel.classList.contains('expanded');

    if (isExpanded) {
        panel.classList.remove('expanded');
        content.style.display = 'none';
    } else {
        panel.classList.add('expanded');
        content.style.display = 'block';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    loadAllProviderConfigs();
    updateProviderUI();

    // Load saved conversations for sidebar
    await renderConversationList();

    // Try to load last active conversation
    const lastConvId = localStorage.getItem('last_conversation_id');
    if (lastConvId) {
        await loadConversationById(lastConvId);
    }
});

/* ==========================================
   Provider Selector Functions
   ========================================== */

function toggleProviderDropdown() {
    const dropdown = document.querySelector('.provider-dropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
}

function selectProvider(providerId) {
    if (isProcessing) {
        console.warn('⚠️ Cannot switch provider while processing. Stop current request first.');
        toggleProviderDropdown();
        return;
    }
    if (API_PROVIDERS[providerId]) {
        currentProvider = providerId;
        localStorage.setItem('selected_provider', providerId); // Save selection
        applyCurrentProviderConfig();  // Apply new provider's config
        updateProviderUI();
        toggleProviderDropdown();
        console.log('🔌 Switched to provider:', API_PROVIDERS[providerId].name);
    }
}

function updateProviderUI() {
    // Update button text
    const providerNameEl = document.querySelector('.provider-name');
    if (providerNameEl && API_PROVIDERS[currentProvider]) {
        providerNameEl.textContent = API_PROVIDERS[currentProvider].name;
    }

    // Update checkmarks
    document.querySelectorAll('.provider-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.provider === currentProvider);
    });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const wrapper = document.querySelector('.provider-selector-wrapper');
    const dropdown = document.querySelector('.provider-dropdown');
    if (wrapper && dropdown && !wrapper.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

/* ==========================================
   Tool Implementations
   ========================================== */

// NOTE: webSearch and openUrl functions are in search-tools.js

async function executeTool(name, args, userQuestion = '') {
    console.log('🔧 Executing tool:', name, args);
    if (name === 'webSearch') {
        return await webSearch(args.query, args.num, userQuestion);
    } else if (name === 'openUrl') {
        return await openUrl(args.urls, userQuestion);
    }
    return { success: false, error: 'Unknown tool' };
}

/* Note: callAPI and callAPIWithCombo are in api-providers.js */

/* ==========================================
   Chat Logic with Tool Loop
   ========================================== */

function addUserMessageAndSend(contentText) {
    if (!contentText.trim() || isProcessing) return;

    // Clear welcome message
    const welcome = conversationEl.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    // Generate unique ID for this message
    const messageId = 'msg-' + Date.now();

    // Add user message to UI
    const userMsgHtml = createUserMessageHTML(contentText, messageId);
    conversationEl.insertAdjacentHTML('beforeend', userMsgHtml);

    // Reset auto-scroll and scroll to bottom when user sends message
    shouldAutoScroll = true;
    scrollToBottom();

    // Add to conversation history with ID
    conversationHistory.push({
        id: messageId,
        role: 'user',
        content: contentText
    });

    // Start processing
    processChat();
}

async function processChat() {
    if (isProcessing) return;
    isProcessing = true;
    chatSendStopWrapper.classList.add('stop-state');

    // Generate ID for this assistant response turn
    const assistantMsgId = 'msg-' + Date.now();

    // Create assistant message element with ID
    const assistantEl = createAssistantMessageElement(assistantMsgId);
    conversationEl.appendChild(assistantEl);

    const messageText = assistantEl.querySelector('.message-text');
    const timeline = assistantEl.querySelector('.tool-timeline');
    const toggleBtn = assistantEl.querySelector('.timeline-toggle');
    const finalTextArea = assistantEl.querySelector('.final-text');
    const bottomTools = assistantEl.querySelector('.bottom-tools-wrapper');

    // Show loading and scroll to show it
    const statusDiv = createStatusIndicator();
    assistantEl.insertBefore(statusDiv, messageText);
    scrollToBottom();

    let stepCount = 0;
    let hadThinkingStep = false;
    let isFirstAPICall = true; // determine where streaming text show: message-text or timeline text or final-text
    let textBuffer = '';

    try {
        let continueLoop = true;

        while (continueLoop) {
            // Check if user clicked stop
            if (userClickStop) {
                continueLoop = false;
                break;
            }

            const tools = allowSearch ? TOOLS : null;
            textBuffer = '';
            let visibleTextBuffer = '';
            let thinkingBuffer = '';
            const thinkState = {
                inThink: false,
                carry: '',
                activeStepEl: null,
                activeStepTextEl: null,
                activeStepBuffer: ''
            };

            // For first call: stream to messageText
            // For subsequent calls: stream to pending element in timeline
            let streamTarget;
            if (isFirstAPICall) {
                streamTarget = messageText;
            } else {
                // Wrap in group-step for consistent timeline styling (dot + vertical line)
                const stepWrapper = document.createElement('div');
                stepWrapper.className = 'group-step active text-step';
                stepWrapper.innerHTML = `
                    <div class="tool-indicator"></div>
                    <div class="step-content">
                        <div class="pending-stream-text"></div>
                    </div>`;
                timeline.appendChild(stepWrapper);
                streamTarget = stepWrapper.querySelector('.pending-stream-text');
            }

            const renderVisibleStream = () => {
                streamTarget.innerHTML = renderMarkdown(visibleTextBuffer);

                // Apply fade-in only for Gemini (other providers send small tokens = flickering)
                if (isFirstAPICall && currentProvider === 'gemini') {
                    const textTags = ['P', 'SPAN', 'STRONG', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'A'];
                    const excludeParents = ['TABLE', 'PRE', 'CODE'];

                    // Check if element is inside excluded parent (table, code block)
                    const isInsideExcluded = (el) => {
                        let parent = el.parentElement;
                        while (parent && parent !== streamTarget) {
                            if (excludeParents.includes(parent.tagName)) return true;
                            parent = parent.parentElement;
                        }
                        return false;
                    };

                    // Remove all existing fade classes
                    streamTarget.querySelectorAll('.chunk-fade-in').forEach(el => {
                        el.classList.remove('chunk-fade-in');
                    });

                    // Find last text element that's not in table/code
                    const allElements = streamTarget.querySelectorAll('*');
                    for (let i = allElements.length - 1; i >= 0; i--) {
                        const el = allElements[i];
                        if (textTags.includes(el.tagName) && !isInsideExcluded(el)) {
                            el.classList.add('chunk-fade-in');
                            break;
                        }
                    }
                }

                scrollToBottom();
            };

            const createThinkingStep = () => {
                // Avoid double spinner: close/remove pending text-step before creating thinking step.
                if (streamTarget && streamTarget.classList && streamTarget.classList.contains('pending-stream-text')) {
                    const pendingStepWrapper = streamTarget.closest('.group-step.text-step');
                    if (pendingStepWrapper) {
                        if (!visibleTextBuffer.trim()) {
                            pendingStepWrapper.remove();
                        } else {
                            pendingStepWrapper.classList.remove('active');
                            pendingStepWrapper.classList.add('completed');
                        }
                    }
                    streamTarget = finalTextArea;
                }

                if (isFirstAPICall && streamTarget === messageText) {
                    // Once thinking appears, keep visible answer below timeline.
                    finalTextArea.innerHTML = renderMarkdown(visibleTextBuffer);
                    messageText.innerHTML = '';
                    streamTarget = finalTextArea;
                }

                const stepEl = createThinkingTimelineStep();
                timeline.appendChild(stepEl);
                stepCount++;
                hadThinkingStep = true;
                toggleBtn.querySelector('.step-count').textContent = stepCount;
                thinkState.activeStepEl = stepEl;
                thinkState.activeStepTextEl = stepEl.querySelector('.step-text');
                thinkState.activeStepBuffer = '';
                setStatusIndicatorMode(statusDiv, 'thinking');
                scrollToBottom();
            };

            const appendThinkingText = (text) => {
                if (!text) return;
                if (!thinkState.activeStepEl) createThinkingStep();
                thinkingBuffer += text;
                thinkState.activeStepBuffer += text;
                thinkState.activeStepTextEl.innerHTML = renderMarkdown(thinkState.activeStepBuffer);
                scrollToBottom();
            };

            const completeThinkingStep = () => {
                if (!thinkState.activeStepEl) return;
                thinkState.activeStepEl.classList.remove('active');
                thinkState.activeStepEl.classList.add('completed');
                thinkState.activeStepEl = null;
                thinkState.activeStepTextEl = null;
                thinkState.activeStepBuffer = '';
                setStatusIndicatorMode(statusDiv, 'working');
            };

            // Streaming callback - split normal text and <think> blocks
            const onChunk = (chunk) => {
                textBuffer += chunk;
                const parsed = parseThinkChunk(chunk, thinkState);

                if (parsed.visibleText) {
                    visibleTextBuffer += parsed.visibleText;
                    renderVisibleStream();
                }

                if (parsed.startedThinking) {
                    createThinkingStep();
                }

                if (parsed.thinkingTexts.length > 0) {
                    for (const thinkText of parsed.thinkingTexts) {
                        appendThinkingText(thinkText);
                    }
                }

                if (parsed.endedThinking) {
                    completeThinkingStep();
                }
            };

            // Call API with streaming
            const result = await callAPI(conversationHistory, tools, onChunk);

            // Flush any remaining partial tokens and close dangling thinking step.
            const flush = flushThinkParser(thinkState);
            if (flush.visibleText) {
                visibleTextBuffer += flush.visibleText;
                renderVisibleStream();
            }
            if (flush.thinkingText) {
                appendThinkingText(flush.thinkingText);
            }
            if (flush.closedDanglingThink) {
                completeThinkingStep();
            }

            const responseContent = visibleTextBuffer !== ''
                ? visibleTextBuffer
                : stripThinkTags(result.content || '');

            // Remove pending group-step if it was used (for subsequent calls)
            if (!isFirstAPICall && streamTarget && streamTarget.classList && streamTarget.classList.contains('pending-stream-text')) {
                // Remove the parent group-step wrapper
                streamTarget.closest('.group-step.text-step')?.remove();
            }

            const hasToolCalls = result.tool_calls && result.tool_calls.length > 0;

            if (isFirstAPICall) {
                if (hasToolCalls) {
                    // First call with tools: messageText already has streamed intro
                    // Just add to history and execute tools

                    // Add to history with ID
                    conversationHistory.push({
                        id: assistantMsgId,
                        role: 'assistant',
                        content: responseContent || null,
                        thinking: thinkingBuffer || null,
                        tool_calls: result.tool_calls
                    });

                    // Execute tools (no stepText for first batch)
                    for (const toolCall of result.tool_calls) {
                        if (userClickStop) break;
                        stepCount++;
                        await executeAndRenderTool(toolCall, null, timeline, toggleBtn, stepCount);
                    }
                    if (userClickStop) continueLoop = false;
                } else {
                    // No tools - final response, move text from messageText to finalTextArea
                    if (responseContent && responseContent.trim()) {
                        finalTextArea.innerHTML = renderMarkdown(responseContent);
                        finalTextArea.classList.add('fade-in');
                        messageText.innerHTML = ''; // Clear messageText
                    }
                    conversationHistory.push({
                        id: assistantMsgId,
                        role: 'assistant',
                        content: responseContent,
                        thinking: thinkingBuffer || null
                    });
                    continueLoop = false;
                }
            } else {
                // Subsequent API calls
                if (hasToolCalls) {
                    // Text goes to timeline step (passed via stepText)
                    conversationHistory.push({
                        role: 'assistant',
                        content: responseContent || null,
                        thinking: thinkingBuffer || null,
                        tool_calls: result.tool_calls
                    });

                    // First tool gets the preceding text
                    for (let i = 0; i < result.tool_calls.length; i++) {
                        if (userClickStop) break;
                        stepCount++;
                        const stepText = (i === 0) ? responseContent : null;
                        await executeAndRenderTool(result.tool_calls[i], stepText, timeline, toggleBtn, stepCount);
                    }
                    if (userClickStop) continueLoop = false;
                } else {
                    // FINAL response - no more tools
                    // Now we need to re-stream or just render
                    if (responseContent && responseContent.trim()) {
                        finalTextArea.innerHTML = renderMarkdown(responseContent);
                        finalTextArea.classList.add('fade-in');
                    }
                    if (hadThinkingStep) {
                        // Keep final answer only in final-text when thinking timeline exists.
                        messageText.innerHTML = '';
                    }
                    conversationHistory.push({
                        role: 'assistant',
                        content: responseContent,
                        thinking: thinkingBuffer || null
                    });
                    continueLoop = false;
                }
            }

            isFirstAPICall = false;
            if (!hasToolCalls) continueLoop = false;
        }

        finalizeActiveTimelineSteps(timeline);

        // Setup toggle - show only after all processing complete
        if (stepCount > 0) {
            toggleBtn.style.display = 'flex';
            toggleBtn.querySelector('.step-count').textContent = stepCount;
            setupTimelineToggle(toggleBtn, timeline);
            // Start collapsed with animation
            timeline.classList.add('collapsed');
            toggleBtn.classList.add('collapsed');
        }

        bottomTools.classList.add('shown');

    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('User stopped the request');
        } else {
            messageText.innerHTML = `<span style="color: var(--error-status-text-color);">❌ Lỗi: ${e.message}</span>`;
            console.error('Chat error:', e);
        }
    } finally {
        statusDiv.remove();
        isProcessing = false;
        chatSendStopWrapper.classList.remove('stop-state');

        // Safety net: if thinking existed and final-text is still empty,
        // move visible text down to final-text to keep a single final answer area.
        if (hadThinkingStep && !finalTextArea.innerHTML.trim() && messageText.innerHTML.trim()) {
            finalTextArea.innerHTML = messageText.innerHTML;
            finalTextArea.classList.add('fade-in');
            messageText.innerHTML = '';
        }

        scrollToBottom();

        // Cleanup: If user stopped and there's NO content and NO tools, remove the element
        if (userClickStop && !conversationHistory[conversationHistory.length - 1]?.content && stepCount === 0) {
            // Remove from UI
            assistantEl.remove();
            // Remove from history
            if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'assistant') {
                conversationHistory.pop();
            }
        }

        // Auto-save conversation to IndexedDB
        saveCurrentConversation();
        renderConversationList();
    }
}

// Helper function to execute tool and render in timeline
async function executeAndRenderTool(toolCall, stepText, timeline, toggleBtn, stepCount) {
    const funcName = toolCall.function.name;
    let funcArgs = {};

    try {
        funcArgs = JSON.parse(toolCall.function.arguments);
    } catch (e) {
        console.error('Failed to parse args:', toolCall.function.arguments);
    }

    // Extract user question from conversation history (last user message)
    let userQuestion = '';
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'user') {
            userQuestion = conversationHistory[i].content;
            break;
        }
    }

    // Create step element with optional text and initial tool state
    const stepEl = createTimelineStep(stepText, funcName, funcArgs);
    timeline.appendChild(stepEl);
    scrollToBottom();

    // Update step count (toggle visibility is set after all processing)
    toggleBtn.querySelector('.step-count').textContent = stepCount;

    let toolResult;
    try {
        // Execute tool with user question
        toolResult = await executeTool(funcName, funcArgs, userQuestion);
    } catch (e) {
        toolResult = {
            success: false,
            error: e?.message || 'Tool execution failed'
        };
    }

    // Update function-call with complete rendered HTML
    const functionCallEl = stepEl.querySelector('.function-call');
    functionCallEl.innerHTML = renderToolHTML(funcName, funcArgs, toolResult);

    // Always close step state after tool execution (success or fail)
    stepEl.classList.remove('active');
    stepEl.classList.add('completed');

    // Add tool response to history
    conversationHistory.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult)
    });

    scrollToBottom();
}

function finalizeActiveTimelineSteps(timeline) {
    if (!timeline) return;
    timeline.querySelectorAll('.group-step.active').forEach(stepEl => {
        stepEl.classList.remove('active');
        stepEl.classList.add('completed');
    });
}

// Render complete tool HTML (header + content + result)
function renderToolHTML(toolName, args, result = null) {
    const toolInfo = toolIcons[toolName] || { icon: 'ph ph-wrench', name: toolName };

    // Special rendering for specific tools
    switch (toolName) {
        case 'webSearch':
            return renderWebSearchToolHTML(toolInfo, args, result);
        default:
            return renderDefaultToolHTML(toolInfo, toolName, args, result);
    }
}

// Default tool HTML with header + description + result
function renderDefaultToolHTML(toolInfo, toolName, args, result) {
    const description = getToolDescription(toolName, args);

    let resultHtml = '';
    if (result) {
        if (!result.success) {
            resultHtml = `<div class="function-result"><i class="ph ph-arrow-right result-icon"></i><span class="tool-error">Lỗi: ${escapeHtml(result.error)}</span></div>`;
        } else if (toolName === 'openUrl') {
            // Handle both single and multiple URLs
            if (result.urlCount && result.urlCount > 1) {
                const successCount = result.urlCount;
                const failedCount = result.failedCount || 0;
                const totalChars = result.results?.reduce((sum, r) => sum + (r.contentLength || 0), 0) || 0;
                let statusText = `Đã đọc ${successCount} URL (${totalChars} ký tự)`;
                if (failedCount > 0) {
                    statusText += ` - ${failedCount} thất bại`;
                }
                resultHtml = `<div class="function-result"><i class="ph ph-arrow-right result-icon"></i><span class="tool-success">${statusText}</span></div>`;
            } else {
                const chars = result.content?.length || 0;
                resultHtml = `<div class="function-result"><i class="ph ph-arrow-right result-icon"></i><span class="tool-success">Đã đọc ${chars} ký tự</span></div>`;
            }
        } else {
            resultHtml = `<div class="function-result"><i class="ph ph-arrow-right result-icon"></i><span class="tool-success">Thành công</span></div>`;
        }
    }

    return `
        <div class="function-header">
            <i class="${toolInfo.icon} function-icon"></i>
            <span class="function-name">${toolInfo.name}</span>
        </div>
        <div class="function-description">${escapeHtml(description)}</div>
        ${resultHtml}
    `;
}

// Render complete web search tool HTML (header + tags + results)
function renderWebSearchToolHTML(toolInfo, args, result) {
    const query = args?.query || '';

    // If no query, don't render anything
    if (!query) {
        return '';
    }

    // Keyword tag (used in both loading and success states)
    const keywordTag = `
        <div class="search-keywords">
            <span class="search-tag">
                <i class="ph ph-magnifying-glass"></i>
                ${escapeHtml(query)}
            </span>
        </div>
    `;

    // Header for error state only
    const headerHtml = `
        <div class="function-header">
            <i class="${toolInfo.icon} function-icon"></i>
            <span class="function-name">${toolInfo.name}</span>
        </div>
    `;

    // If no result yet, show tag only (loading state)
    if (!result) {
        return keywordTag;
    }

    // Error state - show header + error
    if (!result.success) {
        return headerHtml + `<div class="function-result"><i class="ph ph-arrow-right result-icon"></i><span class="tool-error">Lỗi: ${escapeHtml(result.error)}</span></div>`;
    }

    const results = result.results || [];

    // Success: No header, just tags + results

    // Results list
    let resultsHtml = '';
    if (results.length > 0) {
        const resultItems = results.map(r => {
            const domain = getDomainFromUrl(r.url);
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
            return `
                <div class="search-result-item">
                    <div class="result-title-row">
                        <img class="result-favicon" src="${faviconUrl}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><text y=%2212%22 font-size=%2212%22>🔗</text></svg>'">
                        <a href="${escapeHtml(r.url)}" target="_blank" class="result-title">${escapeHtml(r.title)}</a>
                    </div>
                    <span class="result-domain">${escapeHtml(domain)}</span>
                </div>
            `;
        }).join('');

        resultsHtml = `
            <div class="search-results-header">
                <span>Nguồn tham khảo · ${results.length}</span>
            </div>
            <div class="search-results-list no-scrollbar">
                ${resultItems}
            </div>
        `;
    }

    return keywordTag + resultsHtml;
}

// Helper: Get domain from URL
function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return url;
    }
}

// Helper: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Create timeline step with optional text and initial tool state
function createTimelineStep(stepText, toolName, args) {
    const step = document.createElement('div');
    step.className = 'group-step active';

    let stepTextHtml = '';
    if (stepText && stepText.trim()) {
        stepTextHtml = `<div class="step-text">${renderMarkdown(stepText)}</div>`;
    }

    // Use renderToolHTML for initial state (null result = loading state)
    const initialToolHtml = renderToolHTML(toolName, args, null);

    step.innerHTML = `
        <div class="tool-indicator"></div>
        <div class="step-content">
            ${stepTextHtml}
            <div class="step-tools">
                <div class="function-call">
                    ${initialToolHtml}
                </div>
            </div>
        </div>`;
    return step;
}

function createThinkingTimelineStep() {
    const step = document.createElement('div');
    step.className = 'group-step active thinking';
    step.innerHTML = `
        <div class="tool-indicator"></div>
        <div class="step-content">
            <div class="step-text"></div>
        </div>`;
    return step;
}

function parseThinkChunk(chunk, state) {
    const THINK_OPEN = '<think>';
    const THINK_CLOSE = '</think>';
    const input = state.carry + (chunk || '');
    let cursor = 0;

    const out = {
        visibleText: '',
        thinkingTexts: [],
        startedThinking: false,
        endedThinking: false
    };

    while (cursor < input.length) {
        if (state.inThink) {
            const closeIdx = input.indexOf(THINK_CLOSE, cursor);
            if (closeIdx === -1) {
                const safeEnd = Math.max(cursor, input.length - (THINK_CLOSE.length - 1));
                if (safeEnd > cursor) {
                    out.thinkingTexts.push(input.slice(cursor, safeEnd));
                }
                cursor = safeEnd;
                break;
            }

            if (closeIdx > cursor) {
                out.thinkingTexts.push(input.slice(cursor, closeIdx));
            }
            out.endedThinking = true;
            state.inThink = false;
            cursor = closeIdx + THINK_CLOSE.length;
            continue;
        }

        const openIdx = input.indexOf(THINK_OPEN, cursor);
        if (openIdx === -1) {
            const safeEnd = Math.max(cursor, input.length - (THINK_OPEN.length - 1));
            if (safeEnd > cursor) {
                out.visibleText += input.slice(cursor, safeEnd);
            }
            cursor = safeEnd;
            break;
        }

        if (openIdx > cursor) {
            out.visibleText += input.slice(cursor, openIdx);
        }
        out.startedThinking = true;
        state.inThink = true;
        cursor = openIdx + THINK_OPEN.length;
    }

    state.carry = input.slice(cursor);
    return out;
}

function flushThinkParser(state) {
    const out = {
        visibleText: '',
        thinkingText: '',
        closedDanglingThink: false
    };

    if (state.carry) {
        if (state.inThink) {
            out.thinkingText = state.carry;
        } else {
            out.visibleText = state.carry;
        }
    }

    state.carry = '';

    if (state.inThink) {
        state.inThink = false;
        out.closedDanglingThink = true;
    }

    return out;
}

function stripThinkTags(text) {
    if (!text) return '';
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '');
}

/* ==========================================
   UI Element Creation
   ========================================== */

function createUserMessageHTML(content, messageId = null) {
    const id = messageId || ('msg-' + Date.now());
    // Escape content for data attribute
    const escapedContent = content.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
        <div data-msg-id="${id}" data-original-content="${escapedContent}" class="chat-message user-message d-flex flex-column align-items-end justify-content-center p-3 message-slide-in">
            <div class="content p-3 rounded-2">${renderMarkdown(content)}</div>
            <div class="bottom-tools-wrapper px-3 d-flex align-items-center justify-content-end gap-3 pt-2">
                <span class="edit-message-btn active-effect tool-btn" onclick="startEditMessage(this)">
                    <i class="ph ph-pencil-simple message-tool-btn"></i>
                </span>
                <span class="copy-message-btn active-effect tool-btn" onclick="copyMessageContent(this)">
                    <i class="ph ph-copy message-tool-btn"></i>
                </span>
            </div>
        </div>`;
}

function createAssistantMessageElement(messageId = null) {
    const id = messageId || ('msg-' + Date.now());
    const div = document.createElement('div');
    div.className = 'chat-message assistant-message d-flex flex-column gap-2 align-items-start p-4 message-slide-in';
    div.dataset.msgId = id;
    div.innerHTML = `
        <div class="message-text content pb-1 rounded-2"></div>
        <div class="timeline-wrapper">
            <div class="timeline-toggle" style="display: none;">
                <span class="toggle-icon">▶</span>
                <span class="toggle-text"><span class="step-count">0</span> steps completed</span>
            </div>
            <div class="tool-timeline"></div>
        </div>
        <div class="final-text content"></div>
        <div class="bottom-tools-wrapper px-3 align-items-center justify-content-start gap-3">
            <span class="copy-message-btn active-effect tool-btn" onclick="copyMessageContent(this)">
                <i class="ph ph-copy message-tool-btn"></i>
            </span>
            <span class="regenerate-message-btn active-effect tool-btn" onclick="regenerateLastMessage(this)">
                <i class="ph ph-arrows-clockwise message-tool-btn"></i>
            </span>
        </div>`;
    return div;
}

function getToolDescription(toolName, args) {
    if (toolName === 'webSearch') return `Tìm kiếm: "${args.query || ''}"`;
    if (toolName === 'openUrl') {
        if (args.urls && Array.isArray(args.urls)) {
            const count = args.urls.length;
            if (count === 1) {
                return `Mở: ${truncateUrl(args.urls[0])}`;
            }
            const truncatedUrls = args.urls.slice(0, 2).map(u => truncateUrl(u)).join(', ');
            return count > 2
                ? `Mở ${count} URLs: ${truncatedUrls}...`
                : `Mở ${count} URLs: ${truncatedUrls}`;
        }
        return 'Mở URLs';
    }
    return '';
}

function truncateUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.length > 20
            ? parsed.pathname.substring(0, 20) + '...'
            : parsed.pathname;
        return parsed.hostname + path;
    } catch {
        return url.length > 40 ? url.substring(0, 40) + '...' : url;
    }
}

function createStatusIndicator() {
    const accentColor = (localStorage.getItem('accent_color') || '#1a9b8c').replace('#', '');
    const lottiePath = `./assets/lotties/is-working-${accentColor}.json`;

    const div = document.createElement('div');
    div.className = 'status-indicator working';
    div.innerHTML = `
        <lottie-player 
            src="${lottiePath}"
            background="transparent"
            speed="1"
            style="width: 2.5rem; height: 2.5rem;"
            loop
            autoplay>
        </lottie-player>
        <span class="shimmer-text status-text">Working...</span>`;
    return div;
}

function setStatusIndicatorMode(statusDiv, mode) {
    if (!statusDiv) return;
    const textEl = statusDiv.querySelector('.status-text');

    statusDiv.classList.remove('working', 'thinking');

    if (mode === 'thinking') {
        statusDiv.classList.add('thinking');
        if (textEl) textEl.textContent = 'Thinking...';
        return;
    }

    statusDiv.classList.add('working');
    if (textEl) textEl.textContent = 'Working...';
}

function setupTimelineToggle(toggleBtn, timeline) {
    const newBtn = toggleBtn.cloneNode(true);
    toggleBtn.parentNode.replaceChild(newBtn, toggleBtn);

    newBtn.addEventListener('click', () => {
        const isCollapsed = timeline.classList.contains('collapsed');
        if (isCollapsed) {
            timeline.classList.remove('collapsed');
            newBtn.querySelector('.toggle-icon').textContent = '▼';
            newBtn.classList.remove('collapsed');
        } else {
            timeline.classList.add('collapsed');
            newBtn.querySelector('.toggle-icon').textContent = '▶';
            newBtn.classList.add('collapsed');
        }
    });
}

/* ==========================================
   Helper Functions
   ========================================== */

function createNewConversation() {
    return {
        id: `conv-${Date.now()}`,
        title: 'Cuộc trò chuyện mới',
        time_created: Date.now()
    };
}

function updateChatHeader(conv) {
    const titleEl = document.querySelector('.chat-heading .chat-title:not(.e-mobile)');
    if (titleEl) titleEl.textContent = conv.title;
    const timeEl = document.querySelector('.chat-heading .chat-time-created');
    if (timeEl) timeEl.textContent = formatDate(conv.time_created);
}

function requestNewChat() {
    conversationObj = createNewConversation();
    conversationHistory = [];
    localStorage.setItem('last_conversation_id', conversationObj.id);
    updateChatHeader(conversationObj);
    conversationEl.innerHTML = `
        <div class="welcome-message">
            <h2>Xin chào! 👋</h2>
            <p>Tôi là AI assistant với khả năng tìm kiếm web.</p>
            <p>Hãy cấu hình API key ở Settings để bắt đầu!</p>
        </div>`;
    // Refresh sidebar
    renderConversationList();
}

// Save current conversation to IndexedDB
function saveCurrentConversation() {
    if (!conversationHistory.length) return;

    // Auto-generate title from first user message if not set
    if (conversationObj.title === 'Cuộc trò chuyện mới') {
        const firstUserMsg = conversationHistory.find(m => m.role === 'user');
        if (firstUserMsg) {
            const content = typeof firstUserMsg.content === 'string'
                ? firstUserMsg.content
                : firstUserMsg.content?.[0]?.text || '';
            conversationObj.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
        }
    }

    const convData = {
        id: conversationObj.id,
        title: conversationObj.title,
        time_created: conversationObj.time_created,
        time_updated: new Date().toISOString(),
        messages: conversationHistory
    };

    autoSaveConversation(convData);
    localStorage.setItem('last_conversation_id', conversationObj.id);
}

// Load conversation by ID
async function loadConversationById(id) {
    try {
        const conv = await getConversation(id);
        if (!conv) return false;

        conversationObj = {
            id: conv.id,
            title: conv.title,
            time_created: conv.time_created
        };
        conversationHistory = conv.messages || [];

        // Render UI
        updateChatHeader(conversationObj);
        renderConversationUI();

        console.log('📂 Loaded conversation:', conv.id);
        return true;
    } catch (e) {
        console.error('Failed to load conversation:', e);
        return false;
    }
}

// Render conversation in UI from history
function renderConversationUI() {
    conversationEl.innerHTML = '';

    if (!conversationHistory.length) {
        conversationEl.innerHTML = `
            <div class="welcome-message">
                <h2>Xin chào! 👋</h2>
                <p>Tôi là AI assistant với khả năng tìm kiếm web.</p>
            </div>`;
        return;
    }

    // Group messages into turns using user message as separator
    // Each turn: { user: msg, responses: [assistant/tool messages] }
    let turns = [];
    let currentTurn = null;

    for (const msg of conversationHistory) {
        if (msg.role === 'user') {
            if (currentTurn) turns.push(currentTurn);
            currentTurn = { user: msg, responses: [] };
        } else if (currentTurn) {
            currentTurn.responses.push(msg);
        }
    }
    if (currentTurn) turns.push(currentTurn);

    // Render each turn
    for (const turn of turns) {
        // Render user message
        const userContent = typeof turn.user.content === 'string'
            ? turn.user.content
            : turn.user.content?.find(c => c.type === 'text')?.text || '';
        conversationEl.insertAdjacentHTML('beforeend', createUserMessageHTML(userContent, turn.user.id));

        // Render assistant response with timeline
        if (turn.responses.length > 0) {
            renderAssistantTurn(turn.responses);
        }
    }
    scrollToBottom();
}

// Render a complete assistant turn with timeline support
function renderAssistantTurn(responses) {
    // Find the assistant message ID (from first assistant message with id, or last one with content)
    let assistantId = null;
    let finalContent = '';
    let firstText = '';
    let stepCount = 0;

    // First pass: collect info
    for (const msg of responses) {
        if (msg.role === 'assistant') {
            if (msg.id) assistantId = msg.id;
            if (msg.content && !msg.tool_calls) {
                finalContent = msg.content; // Last assistant message without tool_calls is final
            }
            if (msg.content && msg.tool_calls && !firstText) {
                firstText = msg.content; // First text before tools
            }
        }
    }

    // Create assistant element
    const assistantEl = createAssistantMessageElement(assistantId);
    const messageText = assistantEl.querySelector('.message-text');
    const timeline = assistantEl.querySelector('.tool-timeline');
    const toggleBtn = assistantEl.querySelector('.timeline-toggle');
    const finalTextArea = assistantEl.querySelector('.final-text');
    const bottomTools = assistantEl.querySelector('.bottom-tools-wrapper');

    // Render first text if exists
    if (firstText) {
        messageText.innerHTML = renderMarkdown(firstText);
    }

    // Second pass: render thinking/tool steps in original order
    for (let i = 0; i < responses.length; i++) {
        const msg = responses[i];

        if (msg.role === 'assistant' && typeof msg.thinking === 'string' && msg.thinking.trim()) {
            stepCount++;
            const thinkingStepEl = createThinkingTimelineStep();
            const thinkingTextEl = thinkingStepEl.querySelector('.step-text');
            thinkingTextEl.innerHTML = renderMarkdown(msg.thinking);
            thinkingStepEl.classList.remove('active');
            thinkingStepEl.classList.add('completed');
            timeline.appendChild(thinkingStepEl);
        }

        if (msg.role === 'assistant' && msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                stepCount++;

                // Find corresponding tool result
                let toolResult = null;
                for (let j = i + 1; j < responses.length; j++) {
                    if (responses[j].role === 'tool' && responses[j].tool_call_id === tc.id) {
                        try {
                            toolResult = JSON.parse(responses[j].content);
                        } catch (e) {
                            toolResult = { success: false, error: 'Parse error' };
                        }
                        break;
                    }
                }

                // Parse tool args
                let args = {};
                try {
                    args = JSON.parse(tc.function.arguments);
                } catch (e) { }

                // Create timeline step (reuse existing function)
                const stepEl = createTimelineStep(null, tc.function.name, args);

                // Update with result (reuse renderToolHTML)
                const functionCallEl = stepEl.querySelector('.function-call');
                functionCallEl.innerHTML = renderToolHTML(tc.function.name, args, toolResult);

                stepEl.classList.remove('active');
                stepEl.classList.add('completed');
                timeline.appendChild(stepEl);
            }
        }
    }

    // Render final text
    if (finalContent) {
        finalTextArea.innerHTML = renderMarkdown(finalContent);
    }

    // Setup timeline toggle if there were tool steps
    if (stepCount > 0) {
        toggleBtn.style.display = 'flex';
        toggleBtn.querySelector('.step-count').textContent = stepCount;
        setupTimelineToggle(toggleBtn, timeline);
        // Start collapsed
        timeline.classList.add('collapsed');
        toggleBtn.classList.add('collapsed');
    }

    bottomTools.classList.add('shown');
    conversationEl.appendChild(assistantEl);
}

// Render conversation list in sidebar
async function renderConversationList() {
    const listEl = document.querySelector('.conversations.sidebar-chat-list');
    if (!listEl) return;

    try {
        const conversations = await getAllConversations();

        if (!conversations.length) {
            listEl.innerHTML = '<div class="empty-list text-center py-3 opacity-50">Chưa có cuộc trò chuyện</div>';
            return;
        }

        listEl.innerHTML = conversations.map(conv => `
            <div data-time-created="${conv.time_created}" data-id="${conv.id}" data-title="${escapeHtml(conv.title)}"
                class="conversation d-flex flex-column align-items-start gap-1 p-2 ${conv.id === conversationObj?.id ? 'active' : ''}" 
                onclick="loadConversationById('${conv.id}')">
                <div class="title-wrapper w-100 d-flex justify-content-between">
                    <h5 style="text-align: start;">${escapeHtml(conv.title)}</h5>
                    <div class="delete-wrapper py-2 px-4 active-effect tool-btn" onclick="event.stopPropagation(); deleteConv('${conv.id}')">
                        <i class="ph ph-trash"></i>
                    </div>
                </div>
                <span class="text-color-darker conv-time-created">${formatDate(conv.time_created)}</span>
            </div>
        `).join('');
    } catch (e) {
        console.error('Failed to render conversation list:', e);
    }
}

// Delete conversation
async function deleteConv(id) {
    if (!confirm('Xóa cuộc trò chuyện này?')) return;

    try {
        await deleteConversation(id);

        // If deleting current conversation, start new one
        if (id === conversationObj?.id) {
            requestNewChat();
        }

        await renderConversationList();
    } catch (e) {
        console.error('Failed to delete conversation:', e);
    }
}

function scrollToBottom() {
    if (shouldAutoScroll) {
        conversationEl.scrollTop = conversationEl.scrollHeight;
    }
}

conversationEl.addEventListener('scroll', () => {
    const threshold = 50; // pixels from bottom to consider "at bottom"
    shouldAutoScroll = conversationEl.scrollHeight - conversationEl.scrollTop - conversationEl.clientHeight < threshold;
});

function copyToClipboard(text, btn) {
    navigator.clipboard?.writeText(text) || fallbackCopy(text);
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) {
            icon.classList.replace('ph-copy', 'ph-check');
            setTimeout(() => icon.classList.replace('ph-check', 'ph-copy'), 1500);
        }
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

function copyMessageContent(btn) {
    const msg = btn.closest('.chat-message');
    const content = msg.querySelector('.content, .final-text');
    if (content) copyToClipboard(content.textContent, btn);
}

/**
 * Remove all messages from targetMsg onwards (including targetMsg if includeTarget=true)
 * Also trims conversationHistory accordingly using message ID
 * @param {HTMLElement} targetMsg - The message element to start removal from
 * @param {boolean} includeTarget - Whether to include the target message in removal
 */
function removeMessagesFrom(targetMsg, includeTarget = false) {
    const allMessages = Array.from(conversationEl.querySelectorAll('.chat-message'));
    const targetIndex = allMessages.indexOf(targetMsg);
    if (targetIndex === -1) return;

    // Get the message ID of the target
    const targetMsgId = targetMsg.dataset.msgId;

    // Remove from UI (from end to avoid index shift)
    const startIdx = includeTarget ? targetIndex : targetIndex + 1;
    for (let i = allMessages.length - 1; i >= startIdx; i--) {
        allMessages[i].remove();
    }

    // Trim history using ID-based lookup
    if (targetMsgId) {
        const historyIdx = conversationHistory.findIndex(m => m.id === targetMsgId);
        if (historyIdx !== -1) {
            // If includeTarget, remove from this index; otherwise keep this message
            conversationHistory = conversationHistory.slice(0, includeTarget ? historyIdx : historyIdx + 1);
        }
    }
}


function regenerateLastMessage(btn) {
    if (isProcessing) return;

    // Get the assistant message containing this retry button
    const assistantMsg = btn.closest('.assistant-message');
    if (!assistantMsg) return;

    // Remove this assistant message and all messages after it
    removeMessagesFrom(assistantMsg, true);

    // Reset flags and reprocess
    userClickStop = false;
    processChat();
}

/* ==========================================
   Edit Message Functions
   ========================================== */

function startEditMessage(btn) {
    const msgEl = btn.closest('.chat-message');
    const contentEl = msgEl.querySelector('.content');
    const originalContent = msgEl.dataset.originalContent
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

    // Hide content, show textarea
    contentEl.style.display = 'none';
    msgEl.querySelector('.bottom-tools-wrapper').style.display = 'none';

    // Create edit UI
    const editWrapper = document.createElement('div');
    editWrapper.className = 'edit-message-wrapper d-flex flex-column gap-2 w-100';
    editWrapper.innerHTML = `
        <textarea class="edit-textarea p-3 rounded-2 w-100" rows="3">${originalContent}</textarea>
        <div class="d-flex gap-2 justify-content-end">
            <button class="button-cancel px-3 py-2 rounded-2" onclick="cancelEditMessage(this)">Cancel</button>
            <button class="button-save px-3 py-2 rounded-2" onclick="saveEditMessage(this)">Save & Send</button>
        </div>
    `;
    msgEl.insertBefore(editWrapper, contentEl);

    // Focus textarea
    const textarea = editWrapper.querySelector('.edit-textarea');
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
}

function cancelEditMessage(btn) {
    const msgEl = btn.closest('.chat-message');
    const editWrapper = msgEl.querySelector('.edit-message-wrapper');
    const contentEl = msgEl.querySelector('.content');

    editWrapper.remove();
    contentEl.style.display = '';
    msgEl.querySelector('.bottom-tools-wrapper').style.display = '';
}

function saveEditMessage(btn) {
    if (isProcessing) return;

    const userMsg = btn.closest('.user-message');
    if (!userMsg) return;

    const textarea = userMsg.querySelector('.edit-textarea');
    const newContent = textarea.value.trim();
    if (!newContent) return;

    // Remove this message and all messages after it
    removeMessagesFrom(userMsg, true);

    // Generate new ID for edited message
    const newMsgId = 'msg-' + Date.now();

    // Add new user message to UI with ID
    const userMessageHTML = createUserMessageHTML(newContent, newMsgId);
    conversationEl.insertAdjacentHTML('beforeend', userMessageHTML);

    // Add to history with ID
    conversationHistory.push({
        id: newMsgId,
        role: 'user',
        content: newContent
    });

    // Reset flags and process (processChat will create assistant element)
    userClickStop = false;
    scrollToBottom();
    processChat();
}

/* ==========================================
   Sidebar Functions
   ========================================== */

let sidebar = document.querySelector('.sidebar-wrapper .sidebar');
// let sidebarChat = document.querySelector('.sidebar-chat');
// if (sidebarChat) onSideBarMenuItemClicked(sidebarChat);

function onSideBarMenuItemClicked(item) {
    const activeClass = 'active';
    const noneDisplayClass = 'd-none';
    if (item.classList.contains(activeClass)) return;

    item.classList.add(activeClass);
    const itemContent = item.querySelector('.item-content');

    sidebar.querySelectorAll('.sidebar-menu-item').forEach(it => {
        if (it === item) return;
        it.classList.remove(activeClass);
        const content = it.querySelector('.item-content');
        if (content) {
            content.classList.remove(activeClass);
            content.classList.add(noneDisplayClass);
        }
    });

    if (itemContent) {
        itemContent.classList.add(activeClass);
        itemContent.classList.remove(noneDisplayClass);
    }
}

function toggleSideBarContent(contentContainer) {
    document.querySelector('.sidebar-wrapper')?.classList.toggle('mobile-show');
    contentContainer?.classList.toggle('expanded');
}

function toggleChatInputExpand() {
    chatInputWrapperEl.classList.toggle('expanded');
    document.querySelector('.chat-body .chat-conversation')?.classList.toggle('hide');
}

/* ==========================================
   Mobile & Keyboard
   ========================================== */

if (window.innerWidth <= BREAKPOINT_MD) {
    document.querySelector('.sidebar-wrapper')?.classList.add('show');
    document.querySelector('.content-container.chat-container')?.classList.add('expanded');
    chatInputEl.addEventListener('focus', () => {
        setTimeout(() => chatInputWrapperEl.scrollIntoView({ behavior: 'smooth' }), 750);
    });
}

if (window.innerWidth > BREAKPOINT_MD) {
    chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addUserMessageAndSend(chatInputEl.value);
            chatInputEl.value = '';
            adjustHeight();
        }
    });
}

/* ==========================================
   Export & Loading
   ========================================== */

function exportChat() {
    const data = { conversation: conversationObj, history: conversationHistory };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (conversationObj.title || 'chat') + '.json';
    a.click();
    URL.revokeObjectURL(url);
}

setTimeout(() => {
    const overlay = document.querySelector('.loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }
}, 1500);
