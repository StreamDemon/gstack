/**
 * Terminal sidebar tab — interactive Claude Code PTY in xterm.js.
 *
 * Lifecycle (per plan + codex review):
 *   1. Sidebar opens. Terminal is the default-active tab.
 *   2. Bootstrap card shows "Press any key to start Claude Code."
 *   3. On first keystroke (lazy spawn — codex finding #8): the extension
 *      a) POSTs /pty-session on the browse server with the AUTH_TOKEN to
 *         mint a short-lived HttpOnly cookie scoped to the terminal-agent.
 *      b) Opens ws://127.0.0.1:<terminalPort>/ws — the cookie travels
 *         automatically. Terminal-agent validates the cookie + the
 *         chrome-extension:// Origin (codex finding #9), then spawns
 *         claude in a PTY.
 *   4. Bytes pump both ways. Resize observer sends {type:"resize"} text
 *      frames; tab-switch hooks send {type:"tabSwitch"} frames.
 *   5. PTY exits or WS closes -> we show "Session ended" with a restart
 *      button. We do NOT auto-reconnect (codex finding #8: auto-reconnect
 *      = burn fresh claude session every time).
 *
 * Keep this file dependency-free. xterm.js + xterm-addon-fit are loaded
 * via <script src> tags in sidepanel.html (window.Terminal, window.FitAddon).
 */
(function () {
  'use strict';

  const Terminal = window.Terminal;
  const FitAddonModule = window.FitAddon;
  if (!Terminal) {
    console.error('[gstack terminal] xterm not loaded');
    return;
  }

  const els = {
    bootstrap: document.getElementById('terminal-bootstrap'),
    bootstrapStatus: document.getElementById('terminal-bootstrap-status'),
    installCard: document.getElementById('terminal-install-card'),
    installRetry: document.getElementById('terminal-install-retry'),
    mount: document.getElementById('terminal-mount'),
    ended: document.getElementById('terminal-ended'),
    restart: document.getElementById('terminal-restart'),
  };

  /** State machine. */
  const STATE = { IDLE: 'idle', CONNECTING: 'connecting', LIVE: 'live', ENDED: 'ended', NO_CLAUDE: 'no-claude' };
  let state = STATE.IDLE;

  let term = null;
  let fitAddon = null;
  let ws = null;

  function show(el) { el.style.display = ''; }
  function hide(el) { el.style.display = 'none'; }

  function setState(next, opts = {}) {
    state = next;
    switch (next) {
      case STATE.IDLE:
        show(els.bootstrap);
        hide(els.installCard);
        hide(els.mount);
        hide(els.ended);
        els.bootstrapStatus.textContent = opts.message || 'Press any key to start Claude Code.';
        break;
      case STATE.CONNECTING:
        show(els.bootstrap);
        hide(els.installCard);
        hide(els.mount);
        hide(els.ended);
        els.bootstrapStatus.textContent = 'Connecting...';
        break;
      case STATE.LIVE:
        hide(els.bootstrap);
        hide(els.installCard);
        show(els.mount);
        hide(els.ended);
        break;
      case STATE.ENDED:
        hide(els.bootstrap);
        hide(els.installCard);
        hide(els.mount);
        show(els.ended);
        break;
      case STATE.NO_CLAUDE:
        show(els.bootstrap);
        show(els.installCard);
        hide(els.mount);
        hide(els.ended);
        els.bootstrapStatus.textContent = '';
        break;
    }
  }

  /**
   * Read auth + terminalPort from the server's /health. We don't fetch this
   * here — sidepanel.js already polls /health for connection state and
   * exposes the relevant fields on window.gstackHealth (set below in init()).
   * If terminalPort is missing, the agent isn't ready yet.
   */
  function getHealth() {
    return window.gstackHealth || {};
  }

  function getServerPort() {
    return window.gstackServerPort || null;
  }

  function getAuthToken() {
    return window.gstackAuthToken || null;
  }

  /**
   * POST /pty-session to mint the HttpOnly cookie. Returns { terminalPort,
   * expiresAt } on success, or null with reason on failure. Note: we do
   * NOT receive the cookie value; it lives in the browser's HttpOnly jar
   * and travels with the next same-origin request automatically.
   */
  async function mintSession() {
    const serverPort = getServerPort();
    const token = getAuthToken();
    if (!serverPort || !token) {
      return { error: 'browse server not ready' };
    }
    try {
      const resp = await fetch(`http://127.0.0.1:${serverPort}/pty-session`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return { error: `${resp.status} ${body || resp.statusText}` };
      }
      return await resp.json();
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  }

  async function checkClaudeAvailable(terminalPort) {
    try {
      const resp = await fetch(`http://127.0.0.1:${terminalPort}/claude-available`, {
        credentials: 'include',
      });
      if (!resp.ok) return { available: false };
      return await resp.json();
    } catch {
      return { available: false };
    }
  }

  function ensureXterm() {
    if (term) return;
    term = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0a0a0a', foreground: '#e5e5e5' },
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: false,
      convertEol: false,
    });
    if (FitAddonModule && FitAddonModule.FitAddon) {
      fitAddon = new FitAddonModule.FitAddon();
      term.loadAddon(fitAddon);
    }
    term.open(els.mount);
    fitAddon && fitAddon.fit();

    const ro = new ResizeObserver(() => {
      try {
        fitAddon && fitAddon.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {}
    });
    ro.observe(els.mount);

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });
  }

  async function connect() {
    if (state !== STATE.IDLE) return; // already connecting/live
    setState(STATE.CONNECTING);

    const minted = await mintSession();
    if (minted.error) {
      setState(STATE.IDLE, { message: `Cannot start: ${minted.error}` });
      return;
    }
    const { terminalPort } = minted;

    // Pre-flight: does claude even exist on PATH?
    const claudeStatus = await checkClaudeAvailable(terminalPort);
    if (!claudeStatus.available) {
      setState(STATE.NO_CLAUDE);
      return;
    }

    ensureXterm();
    setState(STATE.LIVE);
    fitAddon && fitAddon.fit();

    ws = new WebSocket(`ws://127.0.0.1:${terminalPort}/ws`);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {}
      // Send a single byte to nudge the agent to spawn claude (lazy-spawn trigger).
      try { ws.send(new TextEncoder().encode('\n')); } catch {}
    });

    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        // Agent control message (rare). Treat as JSON; error frames carry code.
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'error' && msg.code === 'CLAUDE_NOT_FOUND') {
            setState(STATE.NO_CLAUDE);
            try { ws.close(); } catch {}
          }
        } catch {}
        return;
      }
      // Binary: feed to xterm.
      const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data;
      term.write(buf);
    });

    ws.addEventListener('close', () => {
      ws = null;
      if (state !== STATE.NO_CLAUDE) setState(STATE.ENDED);
    });

    ws.addEventListener('error', (err) => {
      console.error('[gstack terminal] ws error', err);
    });
  }

  function teardown() {
    try { ws && ws.close(); } catch {}
    ws = null;
    if (term) {
      try { term.dispose(); } catch {}
      term = null;
      fitAddon = null;
    }
    setState(STATE.IDLE);
  }

  // ─── Wiring ───────────────────────────────────────────────────

  function init() {
    // First-keystroke trigger on the bootstrap card.
    document.addEventListener('keydown', onAnyKey, { once: false, capture: true });

    els.installRetry?.addEventListener('click', async () => {
      // Re-probe and try connecting again.
      const minted = await mintSession();
      if (!minted.error) {
        const claudeStatus = await checkClaudeAvailable(minted.terminalPort);
        if (claudeStatus.available) {
          setState(STATE.IDLE);
          // Auto-trigger reconnect on next key
        }
      }
    });

    els.restart?.addEventListener('click', () => {
      // Clean restart. Drop xterm state too — codex 1C: each session is fresh.
      if (term) {
        try { term.dispose(); } catch {}
        term = null;
        fitAddon = null;
      }
      setState(STATE.IDLE);
    });

    // Tab switching: tell the agent which browser tab is active so claude's
    // active-tab.json stays in sync. sidepanel.js owns the active-tab state;
    // we listen for its "tab activated" event.
    document.addEventListener('gstack:active-tab-changed', (ev) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            type: 'tabSwitch',
            tabId: ev.detail?.tabId,
            url: ev.detail?.url,
            title: ev.detail?.title,
          }));
        } catch {}
      }
    });

    // Initial state
    setState(STATE.IDLE);
  }

  function onAnyKey(ev) {
    // Only trigger if Terminal pane is the active one and we're idle.
    const terminalActive = document.getElementById('tab-terminal')?.classList.contains('active');
    if (!terminalActive) return;
    if (state !== STATE.IDLE) return;
    // Ignore pure modifier keys.
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(ev.key)) return;
    connect();
  }

  // Wait for sidepanel.js to populate window.gstackServerPort + window.gstackAuthToken.
  // sidepanel.js already polls /health and resolves the connection; we just need
  // to wait for it. If those globals aren't available within 10s, surface a
  // "browse server not ready" message — user can reload sidebar.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
