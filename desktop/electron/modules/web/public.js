/**
 * The embedded Web UI page, served at `/` by server.js.
 *
 * Kept as an exported string (instead of a static file) so it bundles into
 * the asar with the main process and needs zero packaging changes.
 *
 * CAUTION: this is a template literal — the page's own JavaScript must avoid
 * backticks and `${` (string concatenation only).
 */
export const WEB_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Escrcpy 网页版</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel2: #1e222b; --border: #2a2f3a;
    --text: #e6e9ef; --muted: #8b93a3; --accent: #4f7cff; --accent2: #3b62d9;
    --ok: #34c075; --warn: #e6a23c; --err: #f0564f; --radius: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: var(--bg); color: var(--text); font-size: 14px; overflow: hidden;
  }
  button { font: inherit; cursor: pointer; border: none; background: none; color: inherit; }
  input, textarea, select { font: inherit; color: var(--text); background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; outline: none; }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }

  /* ── login ── */
  #login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg); z-index: 50; }
  .login-card { width: 320px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; text-align: center; }
  .login-card h1 { font-size: 18px; margin-bottom: 6px; }
  .login-card p { color: var(--muted); font-size: 12px; margin-bottom: 18px; }
  .login-card input { width: 100%; margin-bottom: 12px; text-align: center; }
  .login-card button { width: 100%; background: var(--accent); border-radius: 8px; padding: 10px; color: #fff; font-weight: 600; }
  .login-error { color: var(--err); font-size: 12px; margin-top: 10px; min-height: 16px; }

  /* ── layout ── */
  #app { display: none; height: 100%; flex-direction: column; }
  header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--panel); }
  header .logo { font-weight: 700; font-size: 15px; }
  header .tabs { display: flex; gap: 4px; margin-left: 8px; }
  header .tabs button { padding: 6px 14px; border-radius: 8px; color: var(--muted); }
  header .tabs button.active { background: var(--panel2); color: var(--text); }
  header .spacer { flex: 1; }
  .chip { font-size: 11px; color: var(--muted); background: var(--panel2); border: 1px solid var(--border); padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .chip b { color: var(--text); font-weight: 600; }

  main { flex: 1; min-height: 0; display: flex; }

  /* ── sidebar ── */
  aside { width: 230px; border-right: 1px solid var(--border); background: var(--panel); display: flex; flex-direction: column; }
  aside .side-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; }
  aside .side-head span { font-size: 12px; color: var(--muted); }
  .icon-btn { padding: 4px 8px; border-radius: 6px; color: var(--muted); font-size: 16px; line-height: 1; }
  .icon-btn:hover { background: var(--panel2); color: var(--text); }
  #session-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
  .session-item { padding: 8px 10px; border-radius: 8px; margin-bottom: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .session-item:hover { background: var(--panel2); }
  .session-item.active { background: var(--panel2); box-shadow: inset 2px 0 0 var(--accent); }
  .session-item .s-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .session-item .s-meta { font-size: 10px; color: var(--muted); }
  .session-item .s-del { visibility: hidden; color: var(--muted); }
  .session-item:hover .s-del { visibility: visible; }

  /* ── chat column ── */
  .chat-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .chat-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .chat-toolbar select { max-width: 180px; }
  .switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; user-select: none; }
  .switch .track { width: 32px; height: 18px; border-radius: 999px; background: var(--panel2); border: 1px solid var(--border); position: relative; transition: background .15s; }
  .switch .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--muted); transition: all .15s; }
  .switch.on .track { background: var(--accent2); border-color: var(--accent2); }
  .switch.on .track::after { left: 16px; background: #fff; }

  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 82%; padding: 10px 12px; border-radius: var(--radius); line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; background: var(--accent2); color: #fff; border-bottom-right-radius: 4px; }
  .msg.assistant { align-self: flex-start; background: var(--panel2); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
  .msg.tool { align-self: flex-start; background: transparent; border: 1px dashed var(--border); color: var(--muted); font-size: 12px; padding: 6px 10px; }
  .msg .label { font-size: 10px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: .4px; }
  .msg.user .label { color: rgba(255,255,255,.7); }
  .msg .status-run { color: var(--warn); }
  .msg .status-ok { color: var(--ok); }
  .msg .status-fail { color: var(--err); }
  .streaming-note { align-self: center; color: var(--muted); font-size: 12px; display: flex; gap: 8px; align-items: center; }
  .spinner { width: 12px; height: 12px; border: 2px solid var(--muted); border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border); background: var(--panel); }
  .composer textarea { flex: 1; resize: none; max-height: 140px; min-height: 42px; }
  .btn { background: var(--accent); color: #fff; padding: 10px 18px; border-radius: 8px; font-weight: 600; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btn.stop { background: var(--err); }
  .btn.ghost { background: var(--panel2); color: var(--text); border: 1px solid var(--border); font-weight: 400; }
  .btn.small { padding: 5px 10px; font-size: 12px; font-weight: 400; border-radius: 6px; }

  /* ── tasks page ── */
  #tasks-page { flex: 1; overflow-y: auto; padding: 16px; }
  .task-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .task-card .t-main { flex: 1; min-width: 200px; }
  .task-card .t-name { font-weight: 600; }
  .task-card .t-sub { color: var(--muted); font-size: 12px; margin-top: 3px; display: flex; gap: 10px; flex-wrap: wrap; }
  .tag { font-size: 10px; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
  .tag.ok { color: var(--ok); border-color: var(--ok); }
  .tag.err { color: var(--err); border-color: var(--err); }
  .tag.warn { color: var(--warn); border-color: var(--warn); }
  .tag.info { color: var(--accent); border-color: var(--accent); }
  #run-history { margin-top: 18px; }
  #run-history h3 { font-size: 13px; color: var(--muted); margin-bottom: 8px; font-weight: 600; }
  .run-row { display: flex; gap: 10px; padding: 7px 4px; border-bottom: 1px solid var(--border); font-size: 12px; align-items: center; }
  .run-row .r-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .run-row .r-out { color: var(--muted); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .empty { color: var(--muted); text-align: center; padding: 40px 0; font-size: 13px; }
  .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); background: var(--panel2); border: 1px solid var(--border); padding: 9px 16px; border-radius: 8px; font-size: 13px; z-index: 60; display: none; max-width: 86vw; }
  @media (max-width: 720px) {
    aside { position: fixed; left: 0; top: 49px; bottom: 0; z-index: 20; transform: translateX(-100%); transition: transform .2s; width: 78vw; max-width: 300px; }
    aside.open { transform: none; }
    .msg { max-width: 94%; }
  }
</style>
</head>
<body>

<div id="login" style="display:none">
  <div class="login-card">
    <h1>Escrcpy 网页版</h1>
    <p>请输入访问密码</p>
    <input id="login-password" type="password" placeholder="密码" autocomplete="current-password">
    <button id="login-btn">进入</button>
    <div class="login-error" id="login-error"></div>
  </div>
</div>

<div id="app">
  <header>
    <button class="icon-btn" id="menu-btn" title="会话列表" style="display:none">☰</button>
    <span class="logo">Escrcpy 网页版</span>
    <nav class="tabs">
      <button id="tab-chat" class="active">对话</button>
      <button id="tab-tasks">自动任务</button>
    </nav>
    <span class="spacer"></span>
    <span class="chip" id="chip-devices">设备 <b>—</b></span>
    <span class="chip" id="chip-model">模型 <b>—</b></span>
  </header>

  <main>
    <!-- chat -->
    <section id="chat-page" style="display:flex;flex:1;min-width:0">
      <aside id="sidebar">
        <div class="side-head">
          <span>会话</span>
          <button class="icon-btn" id="new-chat" title="新对话">＋</button>
        </div>
        <div id="session-list"></div>
      </aside>

      <div class="chat-col">
        <div class="chat-toolbar">
          <label class="switch" id="agent-switch"><span class="track"></span>智能体模式（可操作设备）</label>
          <select id="device-select" title="目标设备"><option value="">选择设备…</option></select>
          <select id="vendor-select" title="AI 模型"></select>
        </div>
        <div id="messages"><div class="empty">开始一段新对话，或从左侧选择已有会话</div></div>
        <div class="composer">
          <textarea id="composer-input" rows="1" placeholder="输入消息，Enter 发送（Shift+Enter 换行）"></textarea>
          <button class="btn" id="send-btn">发送</button>
          <button class="btn stop" id="stop-btn" style="display:none">停止</button>
        </div>
      </div>
    </section>

    <!-- tasks -->
    <section id="tasks-page" style="display:none">
      <div id="task-list"></div>
      <div id="run-history"><h3>运行历史</h3><div id="run-list"></div></div>
    </section>
  </main>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  'use strict';
  var state = {
    authed: false,
    authRequired: false,
    sessionId: '',
    sessions: [],
    devices: [],
    vendors: [],
    vendorId: '',
    agentMode: false,
    streaming: false,
    streamAbort: null,
  };

  // ── tiny helpers ──────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2600);
  }
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { showLogin(); throw new Error('未授权，请重新登录'); }
        if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : (data.error || ('HTTP ' + res.status)));
        return data;
      });
    });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return iso; }
  }

  // ── login ─────────────────────────────────────────────
  function showLogin() {
    state.authed = false;
    $('login').style.display = 'flex';
    $('app').style.display = 'none';
    setTimeout(function () { $('login-password').focus(); }, 50);
  }
  function tryLogin() {
    var password = $('login-password').value;
    $('login-error').textContent = '';
    fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password }) })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) enterApp();
        else $('login-error').textContent = data.error || '密码错误';
      })
      .catch(function () { $('login-error').textContent = '网络错误'; });
  }
  $('login-btn').addEventListener('click', tryLogin);
  $('login-password').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });

  function enterApp() {
    state.authed = true;
    $('login').style.display = 'none';
    $('app').style.display = 'flex';
    refreshStatus();
    refreshSessions();
    refreshTasks();
    setInterval(refreshStatus, 20000);
  }

  // ── status / devices / vendors ────────────────────────
  function refreshStatus() {
    api('GET', '/api/status').then(function (data) {
      state.devices = data.devices || [];
      state.vendors = (data.vendors || []).filter(function (v) { return v.configured; });
      state.authRequired = !!data.authRequired;

      var online = state.devices.filter(function (d) { return d.status === 'device'; }).length;
      $('chip-devices').innerHTML = '设备 <b>' + online + '/' + state.devices.length + '</b>';

      var sel = $('device-select');
      var prev = sel.value;
      sel.innerHTML = '<option value="">选择设备…</option>' + state.devices.map(function (d) {
        var status = d.status === 'device' ? '在线' : d.status;
        return '<option value="' + esc(d.id) + '">' + esc(d.id) + '（' + status + '）</option>';
      }).join('');
      if (prev) sel.value = prev;

      var vsel = $('vendor-select');
      var vprev = vsel.value || state.vendorId;
      vsel.innerHTML = state.vendors.map(function (v) {
        return '<option value="' + esc(v.id) + '">' + esc(v.name) + (v.model ? ' · ' + esc(v.model) : '') + '</option>';
      }).join('');
      if (vprev) vsel.value = vprev;
      var active = state.vendors.find(function (v) { return v.id === vsel.value; });
      $('chip-model').innerHTML = '模型 <b>' + esc(active && active.model ? active.model : '—') + '</b>';
      if (vsel.value) state.vendorId = vsel.value;
    }).catch(function (e) { toast(e.message); });
  }
  $('device-select').addEventListener('change', function () { renderMessages(); });
  $('vendor-select').addEventListener('change', function () { refreshStatus(); });
  $('agent-switch').addEventListener('click', function () {
    state.agentMode = !state.agentMode;
    $('agent-switch').classList.toggle('on', state.agentMode);
  });

  // ── sessions ──────────────────────────────────────────
  function refreshSessions(keepSelection) {
    api('GET', '/api/sessions').then(function (data) {
      state.sessions = data.sessions || [];
      if (!keepSelection && state.sessions.length && !state.sessionId)
        state.sessionId = '';
      renderSessionList();
    }).catch(function () {});
  }
  function renderSessionList() {
    var list = $('session-list');
    if (!state.sessions.length) {
      list.innerHTML = '<div class="empty" style="padding:20px 0">暂无会话</div>';
      return;
    }
    list.innerHTML = state.sessions.map(function (s) {
      var label = s.name || (s.id.slice(0, 18) + '…');
      return '<div class="session-item' + (s.id === state.sessionId ? ' active' : '') + '" data-id="' + esc(s.id) + '">'
        + '<span class="s-name">' + esc(label) + '</span>'
        + '<span class="s-meta">' + (s.messageCount || 0) + '条</span>'
        + '<button class="s-del" title="删除">✕</button>'
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('.session-item'), function (item) {
      item.addEventListener('click', function (e) {
        if (e.target.classList.contains('s-del')) {
          var id = item.getAttribute('data-id');
          if (!confirm('删除该会话？')) return;
          api('DELETE', '/api/sessions/' + encodeURIComponent(id)).then(function () {
            if (state.sessionId === id) { state.sessionId = ''; $('messages').innerHTML = '<div class="empty">开始一段新对话</div>'; }
            refreshSessions();
          });
          return;
        }
        state.sessionId = item.getAttribute('data-id');
        renderSessionList();
        loadSession(state.sessionId);
        if (window.innerWidth <= 720) $('sidebar').classList.remove('open');
      });
    });
  }
  function loadSession(id) {
    api('GET', '/api/sessions/' + encodeURIComponent(id)).then(function (data) {
      renderSessionMessages(data.session && data.session.messages ? data.session.messages : []);
    }).catch(function (e) { toast(e.message); });
  }
  $('new-chat').addEventListener('click', function () {
    state.sessionId = '';
    $('messages').innerHTML = '<div class="empty">开始一段新对话</div>';
    renderSessionList();
    $('composer-input').focus();
    if (window.innerWidth <= 720) $('sidebar').classList.remove('open');
  });
  $('menu-btn').addEventListener('click', function () { $('sidebar').classList.toggle('open'); });
  function syncMenuButton() { $('menu-btn').style.display = window.innerWidth <= 720 ? '' : 'none'; }
  window.addEventListener('resize', syncMenuButton);
  syncMenuButton();

  // ── chat ──────────────────────────────────────────────
  function renderMessages() { if (state.sessionId) loadSession(state.sessionId); }
  function renderSessionMessages(messages) {
    var box = $('messages');
    if (!messages.length) { box.innerHTML = '<div class="empty">（空会话）</div>'; return; }
    var html = messages.map(function (m) {
      if (m.role === 'user') return '<div class="msg user"><div class="label">我</div>' + esc(typeof m.content === 'string' ? m.content : '[图片消息]') + '</div>';
      if (m.role === 'assistant') {
        var calls = '';
        if (m.tool_calls && m.tool_calls.length) {
          calls = '<div class="label">调用工具: ' + m.tool_calls.map(function (c) { return esc(c.function && c.function.name); }).join(', ') + '</div>';
        }
        return '<div class="msg assistant">' + calls + esc(m.content || '') + '</div>';
      }
      if (m.role === 'tool') {
        var status = m.status === 'completed' ? 'status-ok' : m.status === 'failed' ? 'status-fail' : 'status-run';
        var brief = String(m.content || '');
        if (brief.length > 140) brief = brief.slice(0, 140) + '…';
        return '<div class="msg tool"><span class="' + status + '">●</span> ' + esc(m.name) + ' → ' + esc(brief) + '</div>';
      }
      return '';
    }).join('');
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  function appendStreamBlock() {
    var box = $('messages');
    var emptyEl = box.querySelector('.empty');
    if (emptyEl) emptyEl.remove();
    var note = document.createElement('div');
    note.className = 'streaming-note';
    note.id = 'stream-note';
    note.innerHTML = '<span class="spinner"></span><span id="stream-status">正在生成…</span>';
    var bubble = document.createElement('div');
    bubble.className = 'msg assistant';
    bubble.id = 'stream-bubble';
    bubble.style.display = 'none';
    box.appendChild(note);
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  }

  function send() {
    var input = $('composer-input');
    var text = input.value.trim();
    if (!text || state.streaming) return;
    input.value = '';
    autoGrow(input);

    var userMsg = document.createElement('div');
    userMsg.className = 'msg user';
    userMsg.innerHTML = '<div class="label">我</div>' + esc(text);
    var box = $('messages');
    var emptyEl = box.querySelector('.empty');
    if (emptyEl) emptyEl.remove();
    box.appendChild(userMsg);
    appendStreamBlock();

    state.streaming = true;
    $('send-btn').style.display = 'none';
    $('stop-btn').style.display = '';

    var controller = new AbortController();
    state.streamAbort = controller;
    var bubbleText = '';
    var currentStep = 0;

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({
        sessionId: state.sessionId,
        content: text,
        agentMode: state.agentMode,
        deviceId: $('device-select').value || '',
        vendorId: state.vendorId || '',
        name: text.slice(0, 24),
        stream: true,
      }),
    }).then(function (res) {
      if (res.status === 401) { showLogin(); throw new Error('请重新登录'); }
      if (!res.ok || !res.body) throw new Error('请求失败 (HTTP ' + res.status + ')');
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, { stream: true });
          var index;
          while ((index = buffer.indexOf('\\n\\n')) !== -1) {
            var frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            if (frame.indexOf('data:') === 0) {
              try { handleEvent(JSON.parse(frame.slice(5))); } catch (e) {}
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (error) {
      if (error && error.name === 'AbortError') return;
      finishStream(false, (error && error.message) || '发送失败');
    });

    function handleEvent(event) {
      var bubble = $('stream-bubble');
      var note = $('stream-status');
      if (event.type === 'text-delta') {
        bubbleText += event.text || '';
        bubble.style.display = '';
        bubble.textContent = bubbleText;
        box.scrollTop = box.scrollHeight;
      } else if (event.type === 'step') {
        currentStep = event.step || currentStep + 1;
        if (note) note.textContent = '第 ' + currentStep + ' 步…';
      } else if (event.type === 'tool-call') {
        bubbleText += (bubbleText ? '\\n' : '') + '🔧 ' + ((event.toolCall && event.toolCall.name) || 'tool') + '\\n';
        bubble.style.display = '';
        bubble.textContent = bubbleText;
      } else if (event.type === 'tool-result') {
        if (note) note.textContent = event.name + ' 完成';
      } else if (event.type === 'done') {
        if (event.sessionId) state.sessionId = event.sessionId;
        finishStream(true);
      } else if (event.type === 'error') {
        finishStream(false, event.message || '出错了', event.code);
      }
    }

    function finishStream(ok, errorText, code) {
      state.streaming = false;
      state.streamAbort = null;
      $('send-btn').style.display = '';
      $('stop-btn').style.display = 'none';
      var note = $('stream-note');
      var bubble = $('stream-bubble');
      if (ok) {
        if (note) note.remove();
        refreshSessions(true);
        if (state.sessionId) loadSession(state.sessionId);
        else if (bubble && bubbleText) { bubble.removeAttribute('id'); }
      } else {
        if (note) { note.remove(); }
        if (bubble) { bubble.remove(); }
        var errorEl = document.createElement('div');
        errorEl.className = 'msg tool';
        errorEl.innerHTML = '<span class="status-fail">●</span> 出错了：' + esc(errorText) + (code ? ' <span class="tag err">' + esc(code) + '</span>' : '') + '（本次失败不会影响下一轮对话）';
        box.appendChild(errorEl);
        box.scrollTop = box.scrollHeight;
      }
    }
  }

  $('send-btn').addEventListener('click', send);
  $('stop-btn').addEventListener('click', function () {
    if (state.streamAbort) state.streamAbort.abort();
    if (state.sessionId) api('POST', '/api/chat/abort', { sessionId: state.sessionId }).catch(function () {});
  });
  var composer = $('composer-input');
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }
  composer.addEventListener('input', function () { autoGrow(composer); });
  composer.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  // ── tabs ──────────────────────────────────────────────
  function switchTab(tab) {
    $('tab-chat').classList.toggle('active', tab === 'chat');
    $('tab-tasks').classList.toggle('active', tab === 'tasks');
    $('chat-page').style.display = tab === 'chat' ? 'flex' : 'none';
    $('tasks-page').style.display = tab === 'tasks' ? 'block' : 'none';
    if (tab === 'tasks') refreshTasks();
  }
  $('tab-chat').addEventListener('click', function () { switchTab('chat'); });
  $('tab-tasks').addEventListener('click', function () { switchTab('tasks'); });

  // ── tasks ─────────────────────────────────────────────
  function refreshTasks() {
    api('GET', '/api/tasks').then(function (data) {
      var tasks = data.tasks || [];
      var list = $('task-list');
      if (!tasks.length) {
        list.innerHTML = '<div class="empty">还没有自动任务，在桌面端创建后即可在此查看和运行</div>';
      } else {
        list.innerHTML = tasks.map(function (t) {
          var statusTag = '';
          if (t.lastStatus === 'SUCCESS') statusTag = '<span class="tag ok">上次成功</span>';
          else if (t.lastStatus === 'FAILED') statusTag = '<span class="tag err">上次失败</span>';
          else if (t.lastStatus === 'SKIPPED') statusTag = '<span class="tag warn">上次跳过</span>';
          else if (t.lastStatus === 'RUNNING') statusTag = '<span class="tag info">运行中</span>';
          return '<div class="task-card">'
            + '<div class="t-main">'
            + '<div class="t-name">' + esc(t.name) + ' <span class="tag">' + esc(t.type) + '</span>'
            + (t.agentMode ? ' <span class="tag info">智能体</span>' : '')
            + ' <span class="tag">' + esc(t.sessionMode === 'shared' ? '共用上下文' : t.sessionMode === 'existing' ? '指定会话' : t.sessionMode === 'continue' ? '任务会话' : '全新上下文') + '</span></div>'
            + '<div class="t-sub"><span>⏰ ' + esc(t.cronExpr) + '</span>'
            + (t.enabled ? '<span>下次: ' + fmtTime(t.nextRunAt) + '</span>' : '<span style="color:var(--warn)">已停用</span>')
            + (t.lastRunAt ? '<span>上次: ' + fmtTime(t.lastRunAt) + '</span>' : '')
            + statusTag + '</div>'
            + '</div>'
            + '<label class="switch' + (t.enabled ? ' on' : '') + '" data-toggle="' + esc(t.id) + '"><span class="track"></span>' + (t.enabled ? '已启用' : '已停用') + '</label>'
            + '<button class="btn ghost small" data-run="' + esc(t.id) + '">立即运行</button>'
            + '</div>';
        }).join('');

        Array.prototype.forEach.call(list.querySelectorAll('[data-toggle]'), function (el) {
          el.addEventListener('click', function () {
            var id = el.getAttribute('data-toggle');
            var task = tasks.find(function (t) { return t.id === id; });
            if (!task) return;
            api('POST', '/api/tasks/' + encodeURIComponent(id) + '/toggle', { enabled: !task.enabled })
              .then(function () { refreshTasks(); })
              .catch(function (e) { toast(e.message); });
          });
        });
        Array.prototype.forEach.call(list.querySelectorAll('[data-run]'), function (el) {
          el.addEventListener('click', function () {
            var id = el.getAttribute('data-run');
            el.disabled = true;
            el.textContent = '运行中…';
            api('POST', '/api/tasks/' + encodeURIComponent(id) + '/run')
              .then(function (data) {
                var run = data.run || {};
                var text = run.status === 'SUCCESS' ? '✅ 运行成功' : (run.status === 'SKIPPED' ? '⚠️ 已跳过' : '❌ 运行失败');
                toast(text + (run.error ? '：' + run.error : ''));
                refreshTasks();
              })
              .catch(function (e) { toast('运行失败：' + e.message); refreshTasks(); });
          });
        });
      }
      refreshRuns();
    }).catch(function (e) { toast(e.message); });
  }
  function refreshRuns() {
    api('GET', '/api/runs?limit=30').then(function (data) {
      var runs = data.runs || [];
      var list = $('run-list');
      if (!runs.length) { list.innerHTML = '<div class="empty">暂无运行记录</div>'; return; }
      list.innerHTML = runs.map(function (r) {
        var cls = r.status === 'SUCCESS' ? 'ok' : r.status === 'RUNNING' ? 'info' : r.status === 'SKIPPED' ? 'warn' : 'err';
        var label = r.status === 'SUCCESS' ? '成功' : r.status === 'RUNNING' ? '运行中' : r.status === 'SKIPPED' ? '跳过' : '失败';
        return '<div class="run-row">'
          + '<span>' + fmtTime(r.startedAt) + '</span>'
          + '<span class="r-name">' + esc(r.refName) + '</span>'
          + '<span class="r-out">' + esc(String(r.error || r.output || '').slice(0, 80)) + '</span>'
          + '<span class="tag ' + cls + '">' + label + '</span>'
          + '</div>';
      }).join('');
    }).catch(function () {});
  }

  // ── boot ──────────────────────────────────────────────
  fetch('/api/status', { credentials: 'same-origin' }).then(function (res) {
    if (res.status === 401) { showLogin(); return; }
    return res.json().then(function (data) {
      if (data.authRequired) { showLogin(); return; }
      enterApp();
    });
  }).catch(function () {
    $('login').style.display = 'flex';
    $('login-error').textContent = '无法连接服务器';
  });
})();
</script>
</body>
</html>
`
