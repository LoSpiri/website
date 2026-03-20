/**
 * Client-side RAG Chatbot
 * 
 * Architecture:
 *   1. On page load: starts downloading SmolLM2-360M via WebGPU in background
 *   2. Loads pre-built Orama index (full-text search on chunked website content)
 *   3. For each question: search → retrieve top chunks → build prompt → generate answer
 * 
 * No server, no API calls. Everything runs in the browser via WebGPU.
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  const ORAMA_INDEX_URL = 'chatbot/orama-index.json';
  const KNOWLEDGE_URL = 'chatbot/knowledge.json';
  const LLM_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
  const TOP_K = 3;

  // ── State ───────────────────────────────────────────────────────────────
  let panelOpen = false;
  let oramaDb = null;
  let knowledgeChunks = null;
  let generator = null;
  let modelLoading = false;
  let modelReady = false;
  let modelFailed = false;
  let loadProgress = 0; // 0-100
  let loadStatusText = 'Preparing AI model...';

  // ── SVG Icons ───────────────────────────────────────────────────────────
  const CHAT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const CLOSE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const SEND_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  // ── Build DOM ───────────────────────────────────────────────────────────
  function createWidget() {
    // FAB button
    const fab = document.createElement('button');
    fab.className = 'chatbot-fab';
    fab.id = 'chatbot-fab';
    fab.setAttribute('aria-label', 'Open chat');
    fab.innerHTML = CHAT_ICON;
    fab.addEventListener('click', togglePanel);

    // Panel
    const panel = document.createElement('div');
    panel.className = 'chatbot-panel';
    panel.id = 'chatbot-panel';
    panel.innerHTML = `
      <div class="chatbot-header">
        <div>
          <div class="chatbot-header-title">Ask about Lorenzo</div>
          <div class="chatbot-header-subtitle" id="chatbot-status">AI-powered · runs in your browser</div>
        </div>
        <button class="chatbot-close" id="chatbot-close" aria-label="Close chat">${CLOSE_ICON}</button>
      </div>
      <div class="chatbot-messages" id="chatbot-messages">
        <div class="chatbot-msg bot">Hi! Ask me anything about Lorenzo — his experience, projects, education, or skills. Everything runs locally in your browser via WebGPU. 🧠</div>
      </div>
      <div class="chatbot-input-area">
        <input type="text" class="chatbot-input" id="chatbot-input" placeholder="Ask about experience, projects..." autocomplete="off" />
        <button class="chatbot-send" id="chatbot-send" aria-label="Send message">${SEND_ICON}</button>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    // Event listeners
    document.getElementById('chatbot-close').addEventListener('click', togglePanel);
    document.getElementById('chatbot-send').addEventListener('click', handleSend);
    document.getElementById('chatbot-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  // ── Panel toggle ────────────────────────────────────────────────────────
  function togglePanel() {
    panelOpen = !panelOpen;
    const panel = document.getElementById('chatbot-panel');
    if (panelOpen) {
      panel.classList.add('open');
      document.getElementById('chatbot-input').focus();
      // Show progress bar if model is still loading
      if (modelLoading && !modelReady && !modelFailed) {
        showProgressInChat();
      }
    } else {
      panel.classList.remove('open');
    }
  }

  // ── Show progress bar inside chat (if panel is opened during download) ──
  function showProgressInChat() {
    const msgArea = document.getElementById('chatbot-messages');
    // Don't duplicate
    if (document.getElementById('chatbot-dl-progress')) return;

    const progressEl = document.createElement('div');
    progressEl.className = 'chatbot-progress visible';
    progressEl.id = 'chatbot-dl-progress';
    progressEl.innerHTML = `
      <div class="chatbot-progress-label" id="chatbot-dl-label">${loadStatusText}</div>
      <div class="chatbot-progress-bar"><div class="chatbot-progress-fill" id="chatbot-progress-fill" style="width:${loadProgress}%"></div></div>
    `;
    msgArea.appendChild(progressEl);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  // ── Update progress UI (works whether panel is open or not) ─────────────
  function updateProgress(pct, text) {
    loadProgress = pct;
    if (text) loadStatusText = text;

    // Update header subtitle
    const status = document.getElementById('chatbot-status');
    if (status && modelLoading && !modelReady) {
      status.textContent = text || `Downloading model... ${pct}%`;
    }

    // Update progress bar if visible in chat
    const fill = document.getElementById('chatbot-progress-fill');
    if (fill) fill.style.width = pct + '%';
    const label = document.getElementById('chatbot-dl-label');
    if (label && text) label.textContent = text;
  }

  // ── Load Orama index ────────────────────────────────────────────────────
  async function loadSearchIndex() {
    try {
      const [indexRes, knowledgeRes] = await Promise.all([
        fetch(ORAMA_INDEX_URL),
        fetch(KNOWLEDGE_URL),
      ]);

      if (!indexRes.ok || !knowledgeRes.ok) throw new Error('Failed to fetch index');

      const indexData = await indexRes.json();
      knowledgeChunks = await knowledgeRes.json();

      oramaDb = { loaded: true, data: indexData };
      console.log('[Chatbot] Search index loaded:', knowledgeChunks.length, 'chunks');
    } catch (err) {
      console.warn('[Chatbot] Failed to load search index:', err);
    }
  }

  // ── Simple text search (BM25-like) ──────────────────────────────────────
  function searchKnowledge(query) {
    if (!knowledgeChunks) return [];

    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (queryTerms.length === 0) return knowledgeChunks.slice(0, TOP_K);

    const scored = knowledgeChunks.map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        let idx = 0;
        while (true) {
          idx = text.indexOf(term, idx);
          if (idx === -1) break;
          score += 1;
          idx += term.length;
        }
        if (chunk.section.toLowerCase().includes(term)) score += 3;
        if (chunk.page.toLowerCase().includes(term)) score += 2;
      }

      return { chunk, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K)
      .map(s => s.chunk);
  }

  // ── Load LLM (called on page load, runs in background) ──────────────────
  async function loadModel() {
    if (modelReady || modelLoading) return;
    modelLoading = true;

    try {
      console.log('[Chatbot] Starting model download (WebGPU)...');

      // Dynamic import of transformers.js from CDN
      const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1');

      // Check WebGPU availability
      let device = 'webgpu';
      let dtype = 'q4';
      if (!navigator.gpu) {
        console.warn('[Chatbot] WebGPU not available, falling back to WASM');
        device = 'wasm';
        dtype = 'q4';
      }

      generator = await pipeline('text-generation', LLM_MODEL, {
        dtype: dtype,
        device: device,
        progress_callback: (progress) => {
          if (progress.status === 'progress' && progress.progress != null) {
            const pct = Math.round(progress.progress);
            updateProgress(pct, `Downloading AI model... ${pct}%`);
          } else if (progress.status === 'initiate') {
            updateProgress(0, 'Preparing AI model...');
          } else if (progress.status === 'ready') {
            updateProgress(100, 'Model ready!');
          }
        }
      });

      modelReady = true;
      modelLoading = false;

      // Clean up progress UI
      const progressEl = document.getElementById('chatbot-dl-progress');
      if (progressEl) progressEl.remove();

      // Update header
      const status = document.getElementById('chatbot-status');
      if (status) status.textContent = 'AI ready · runs in your browser';

      console.log('[Chatbot] Model loaded successfully via', device);
    } catch (err) {
      console.error('[Chatbot] Model load failed:', err);
      modelFailed = true;
      modelLoading = false;

      const progressEl = document.getElementById('chatbot-dl-progress');
      if (progressEl) progressEl.remove();

      const status = document.getElementById('chatbot-status');
      if (status) status.textContent = 'AI unavailable';

      // Only show error in chat if panel is open
      if (panelOpen) showError();
    }
  }

  // ── Show error ──────────────────────────────────────────────────────────
  function showError() {
    const msgArea = document.getElementById('chatbot-messages');
    const errorEl = document.createElement('div');
    errorEl.className = 'chatbot-msg bot';
    errorEl.textContent = "Sorry, the AI assistant isn't available right now. Your browser may not support WebGPU, or the model couldn't be downloaded. You can still browse the website to learn about Lorenzo!";
    msgArea.appendChild(errorEl);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  // ── Handle send ─────────────────────────────────────────────────────────
  async function handleSend() {
    const input = document.getElementById('chatbot-input');
    const query = input.value.trim();
    if (!query) return;

    input.value = '';
    addMessage(query, 'user');

    // Search for relevant context
    const results = searchKnowledge(query);
    const context = results.map(r => {
      const prefix = r.section ? `[${r.page} > ${r.section}]` : `[${r.page}]`;
      return `${prefix} ${r.text}`;
    }).join('\n\n');

    // If model failed, show error
    if (modelFailed) {
      showError();
      return;
    }

    // If model still loading, show a waiting message
    if (!modelReady) {
      addMessage("The AI model is still loading. Please wait a moment and try again...", 'bot');
      return;
    }

    // Show typing indicator
    const typingEl = showTyping();

    try {
      const systemPrompt = `You are a helpful assistant on Lorenzo Spiridioni's personal website. Answer questions about Lorenzo based ONLY on the provided context. Be concise, friendly, and accurate. If the context doesn't contain enough information, say so honestly. Do not make up information.`;

      const userPrompt = context
        ? `Context:\n${context}\n\nQuestion: ${query}`
        : `Question: ${query}\n\nNote: I don't have specific context for this question. Please let the user know you can answer questions about Lorenzo's experience, projects, education, and skills.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const output = await generator(messages, {
        max_new_tokens: 256,
        temperature: 0.3,
        do_sample: true,
        top_p: 0.9,
      });

      typingEl.remove();

      let response = '';
      if (output && output[0] && output[0].generated_text) {
        const genText = output[0].generated_text;
        if (Array.isArray(genText)) {
          const lastMsg = genText.filter(m => m.role === 'assistant').pop();
          response = lastMsg ? lastMsg.content : '';
        } else {
          response = genText;
        }
      }

      if (!response) {
        response = "I'm sorry, I couldn't generate a response. Please try rephrasing your question.";
      }

      addMessage(response.trim(), 'bot');
    } catch (err) {
      console.error('[Chatbot] Generation error:', err);
      typingEl.remove();
      addMessage("Sorry, something went wrong while generating a response. Please try again.", 'bot');
    }
  }

  // ── UI Helpers ──────────────────────────────────────────────────────────
  function addMessage(text, role) {
    const msgArea = document.getElementById('chatbot-messages');
    const msg = document.createElement('div');
    msg.className = `chatbot-msg ${role}`;
    msg.textContent = text;
    msgArea.appendChild(msg);
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  function showTyping() {
    const msgArea = document.getElementById('chatbot-messages');
    const typing = document.createElement('div');
    typing.className = 'chatbot-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgArea.appendChild(typing);
    msgArea.scrollTop = msgArea.scrollHeight;
    return typing;
  }

  // ── Init ────────────────────────────────────────────────────────────────
  function init() {
    createWidget();
    loadSearchIndex();  // Load search index immediately
    loadModel();        // Start model download immediately on page load
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
