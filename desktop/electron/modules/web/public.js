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

  /* ── workflows (visual chain) ── */
  #tasks-page { padding: 14px; overflow-y: auto; display: block; }
  #workflow-panel { margin-bottom: 18px; }
  .panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .panel-head h3 { font-size: 14px; font-weight: 600; }
  .wf-card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 10px; }
  .wf-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .wf-name { font-size: 13px; font-weight: 600; }
  .wf-desc { font-size: 11px; color: var(--muted); }
  .flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .flow .node { padding: 5px 10px; border-radius: 8px; font-size: 11px; border: 1px solid var(--border); background: var(--panel2); }
  .flow .node.ai { border-color: rgba(59,130,246,.5); color: #93b4ff; }
  .flow .node.action { border-color: rgba(245,158,11,.5); color: #f0c078; }
  .flow .node.delay { border-color: rgba(16,185,129,.5); color: #7fd8b4; }
  .flow .node.start, .flow .node.end { color: var(--muted); }
  .flow .arrow { color: var(--muted); font-size: 12px; }
  .wf-run { margin-top: 8px; }

  /* ── mirror ── */
  #mirror-page { flex: 1; min-width: 0; }
  .mirror-wrap { height: 100%; display: flex; flex-direction: column; }
  .mirror-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--panel); flex-wrap: wrap; }
  .mirror-body { flex: 1; min-height: 0; display: flex; }
  .mirror-stage { flex: 1; min-width: 0; position: relative; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .mirror-video-wrap { position: relative; background: #000; touch-action: none; }
  .mirror-video-wrap video, .mirror-video-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  #mirror-overlay { position: absolute; inset: 0; }
  #mirror-overlay .km-dot { position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; background: rgba(79,124,255,.45); border: 1px solid rgba(255,255,255,.75); display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; cursor: pointer; }
  #mirror-overlay .km-dot.active { border: 2px solid #fff; background: rgba(79,124,255,.75); }
  .mirror-empty { position: absolute; color: var(--muted); font-size: 13px; pointer-events: none; }
  .mirror-keymap { width: 230px; border-left: 1px solid var(--border); background: var(--panel); display: flex; flex-direction: column; }
  .keymap-actions { display: flex; gap: 6px; padding: 8px; }
  .keymap-hint { padding: 8px 10px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--border); }
  #keymap-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
  .km-row { padding: 8px 10px; border-radius: 8px; margin-bottom: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
  .km-row:hover { background: var(--panel2); }
  .km-row.active { background: var(--panel2); box-shadow: inset 2px 0 0 var(--accent); }
  .km-row .km-name { flex: 1; font-size: 12px; }
  .km-row .km-key { font-size: 10px; color: var(--muted); }
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
      <button id="tab-mirror">镜像</button>
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
          <select id="device-select" title="目标设备可多选（群控）" multiple size="1" style="min-width:150px"><option value="">选择设备…</option></select>
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
      <div id="workflow-panel">
        <div class="panel-head">
          <h3>工作流</h3>
          <button class="btn ghost small" id="workflow-refresh">刷新</button>
        </div>
        <div id="workflow-list"></div>
      </div>
      <div id="task-list"></div>
      <div id="run-history"><h3>运行历史</h3><div id="run-list"></div></div>
    </section>

    <!-- mirror (内嵌镜像) -->
    <section id="mirror-page" style="display:none">
      <div class="mirror-wrap">
        <div class="mirror-toolbar">
          <select id="mirror-device" style="min-width:170px"><option value="">选择设备…</option></select>
          <button class="btn" id="mirror-start">连接</button>
          <button class="btn ghost" id="mirror-stop">断开</button>
          <span class="chip" id="mirror-status">未连接</span>
          <span class="chip" id="mirror-fps">— fps</span>
          <span class="spacer"></span>
          <button class="btn ghost" id="mirror-keymap-toggle">键位映射</button>
        </div>
        <div class="mirror-body">
          <div class="mirror-stage" id="mirror-stage">
            <div class="mirror-video-wrap" id="mirror-video-wrap">
              <video id="mirror-video" autoplay muted playsinline></video>
              <canvas id="mirror-canvas"></canvas>
              <div id="mirror-overlay"></div>
            </div>
            <div class="mirror-empty" id="mirror-empty">选择设备并点击「连接」开始镜像</div>
          </div>
          <aside class="mirror-keymap" id="mirror-keymap" style="display:none">
            <div class="side-head"><span>键盘映射</span><button class="icon-btn" id="keymap-add">＋</button></div>
            <div class="keymap-actions">
              <button class="btn ghost small" id="keymap-capture">绑定按键</button>
              <button class="btn ghost small" id="keymap-del">删除选中</button>
            </div>
            <div id="keymap-list"></div>
            <div class="keymap-hint">点「＋」后在画面上点击添加映射；选中后点「绑定按键」并按下键盘。</div>
          </aside>
        </div>
      </div>
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
      var prev = Array.from(sel.selectedOptions || []).map(function (o) { return o.value; });
      sel.innerHTML = state.devices.map(function (d) {
        var status = d.status === 'device' ? '在线' : d.status;
        return '<option value="' + esc(d.id) + '">' + esc(d.id) + '（' + status + '）</option>';
      }).join('');
      Array.prototype.forEach.call(sel.options, function (o) { o.selected = prev.indexOf(o.value) !== -1; });

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
        deviceIds: Array.from($('device-select').selectedOptions || []).map(function (o) { return o.value; }).filter(Boolean),
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
    $('tab-mirror').classList.toggle('active', tab === 'mirror');
    $('chat-page').style.display = tab === 'chat' ? 'flex' : 'none';
    $('tasks-page').style.display = tab === 'tasks' ? 'block' : 'none';
    $('mirror-page').style.display = tab === 'mirror' ? 'flex' : 'none';
    if (tab === 'tasks') { refreshTasks(); refreshWorkflows(); }
    if (tab === 'mirror') initMirrorTab();
  }
  $('tab-chat').addEventListener('click', function () { switchTab('chat'); });
  $('tab-tasks').addEventListener('click', function () { switchTab('tasks'); });
  $('tab-mirror').addEventListener('click', function () { switchTab('mirror'); });

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

  // ── workflows (visual chain) ─────────────────────────
  var STEP_LABELS = { ai: 'AI', action: '动作', delay: '延时' };
  function refreshWorkflows() {
    api('GET', '/api/workflows').then(function (data) {
      var list = $('workflow-list');
      if (!list) return;
      var items = data.workflows || [];
      if (!items.length) {
        list.innerHTML = '<div class="empty">还没有工作流，在桌面端创建后即可在此查看和运行</div>';
        return;
      }
      list.innerHTML = items.map(function (wf) {
        var nodes = ['<span class="node start">开始</span>'];
        (wf.steps || []).forEach(function (step) {
          nodes.push('<span class="arrow">→</span>');
          var label = step.name || STEP_LABELS[step.type] || step.type;
          if (step.type === 'delay') label = '等待 ' + (step.seconds || 1) + 's';
          nodes.push('<span class="node ' + esc(step.type) + '" title="' + esc(step.prompt || step.action || '') + '">' + esc(label) + '</span>');
        });
        nodes.push('<span class="arrow">→</span><span class="node end">结束</span>');
        return '<div class="wf-card">'
          + '<div class="wf-head"><span class="wf-name">' + esc(wf.name) + '</span>'
          + '<span class="wf-desc">' + esc(wf.description || '') + '</span></div>'
          + '<div class="flow">' + nodes.join('') + '</div>'
          + '<div class="wf-run"><button class="btn small" data-wf-run="' + esc(wf.id) + '">立即运行</button></div>'
          + '</div>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('[data-wf-run]'), function (el) {
        el.addEventListener('click', function () {
          el.disabled = true;
          el.textContent = '运行中…';
          api('POST', '/api/workflows/' + encodeURIComponent(el.getAttribute('data-wf-run')) + '/run')
            .then(function (res) {
              var run = res.run || {};
              toast(run.status === 'SUCCESS' ? '工作流执行成功' : (run.status === 'SKIPPED' ? '工作流已跳过' : '工作流执行失败'));
            })
            .catch(function (e) { toast('运行失败：' + e.message); })
            .finally(function () { el.disabled = false; el.textContent = '立即运行'; });
        });
      });
    }).catch(function () {});
  }
  var wfRefresh = $('workflow-refresh');
  if (wfRefresh) wfRefresh.addEventListener('click', refreshWorkflows);

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


  // ── mirror (内嵌镜像) ─────────────────────────────────
  var mirror = {
    deviceId: '',
    running: false,
    decoder: null,
    writer: null,
    source: null,
    config: null,
    awaitingKeyframe: true,
    width: 720,
    height: 1280,
    frames: 0,
    fps: 0,
    lastFpsAt: 0,
    pointers: {},
    keymap: { profiles: [], activeId: null },
    selectedId: null,
    adding: false,
    capturing: false,
  };

  var MIRROR_CODECS = { h264: 'avc1.4d001f', h265: 'hev1.1.6.L93.B0', av01: 'av01.0.01M.08' };

  function mirrorSetupDecoder() {
    try { mirror.decoder && mirror.decoder.close(); } catch (e) {}
    var Generator = window.MediaStreamTrackGenerator;
    if (Generator) {
      try {
        var track = new Generator({ kind: 'video' });
        $('mirror-video').srcObject = new MediaStream([track]);
        mirror.writer = track.writable.getWriter();
        $('mirror-video').style.display = 'block';
        $('mirror-canvas').style.display = 'none';
      } catch (e) { mirror.writer = null; }
    }
    mirror.decoder = new VideoDecoder({
      output: function (frame) {
        if (mirror.writer) {
          mirror.writer.write(frame).catch(function () { try { frame.close(); } catch (e) {} });
        } else {
          try {
            var canvas = $('mirror-canvas');
            var ctx = canvas.getContext('2d');
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            ctx.drawImage(frame, 0, 0);
          } catch (e) {}
          frame.close();
        }
        mirror.frames += 1;
      },
      error: function (err) {
        console.warn('[WebMirror] decoder error', err && err.message);
        mirror.decoder = null;
        mirror.awaitingKeyframe = true;
      },
    });
    mirror.decoder.configure({ codec: MIRROR_CODECS[mirror.codec] || MIRROR_CODECS.h264, optimizeForLatency: true });
    mirror.awaitingKeyframe = true;
  }

  function mirrorHandleEvent(event) {
    if (!event) return;
    if (event.type === 'metadata') {
      mirror.width = event.width || mirror.width;
      mirror.height = event.height || mirror.height;
      mirror.codec = event.codec || 'h264';
      mirrorResize();
      return;
    }
    if (event.type === 'close' || event.type === 'error') {
      setMirrorStatus(event.type === 'error' ? ('错误：' + (event.message || '')) : '已断开');
      return;
    }
    if (event.type === 'data' && event.stream === 'video') {
      if (!mirror.decoder) return;
      if (mirror.awaitingKeyframe && !event.keyframe) return;
      var raw = event.data ? base64ToBytes(event.data) : new Uint8Array(0);
      if (event.keyframe && mirror.config && mirror.config.length) {
        var merged = new Uint8Array(mirror.config.length + raw.length);
        merged.set(mirror.config, 0); merged.set(raw, mirror.config.length);
        raw = merged; mirror.config = null;
      }
      try {
        mirror.decoder.decode(new EncodedVideoChunk({
          type: event.keyframe ? 'key' : 'delta',
          timestamp: Number(event.pts || 0),
          data: raw,
        }));
        mirror.awaitingKeyframe = false;
      } catch (e) { mirror.awaitingKeyframe = true; }
      return;
    }
    if (event.type === 'configuration' && event.stream === 'video') {
      mirror.config = event.data ? base64ToBytes(event.data) : null;
      return;
    }
  }

  function base64ToBytes(value) {
    var bin = atob(value);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function setMirrorStatus(text) {
    var el = $('mirror-status');
    if (el) el.textContent = text;
  }

  function mirrorResize() {
    var wrap = $('mirror-video-wrap');
    var stage = $('mirror-stage');
    if (!wrap || !stage) return;
    var rect = stage.getBoundingClientRect();
    var ratio = (mirror.width || 9) / (mirror.height || 16);
    var w = rect.width;
    var h = w / ratio;
    if (h > rect.height) { h = rect.height; w = h * ratio; }
    wrap.style.width = Math.round(w) + 'px';
    wrap.style.height = Math.round(h) + 'px';
  }

  function mirrorControl(message) {
    return api('POST', '/api/mirror/control', { deviceId: mirror.deviceId, message: message }).catch(function () {});
  }

  function mirrorNormalized(e) {
    var rect = $('mirror-video-wrap').getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  function mirrorBindTouch() {
    var wrap = $('mirror-video-wrap');
    if (!wrap || wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    var nextId = 1;
    wrap.addEventListener('pointerdown', function (e) {
      if (!mirror.running) return;
      if (mirror.adding) { addKeymapAt(e); return; }
      e.preventDefault();
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
      var point = mirrorNormalized(e);
      var pointerId = -nextId; nextId += 1;
      mirror.pointers[e.pointerId] = pointerId;
      mirrorControl({ kind: 'touch', action: 'down', pointerId: pointerId, x: point.x, y: point.y, normalized: true });
    });
    wrap.addEventListener('pointermove', function (e) {
      var pointerId = mirror.pointers[e.pointerId];
      if (!pointerId) return;
      e.preventDefault();
      var point = mirrorNormalized(e);
      mirrorControl({ kind: 'touch', action: 'move', pointerId: pointerId, x: point.x, y: point.y, normalized: true });
    });
    function up(e) {
      var pointerId = mirror.pointers[e.pointerId];
      if (!pointerId) return;
      delete mirror.pointers[e.pointerId];
      var point = mirrorNormalized(e);
      mirrorControl({ kind: 'touch', action: 'up', pointerId: pointerId, x: point.x, y: point.y, normalized: true, pressure: 0 });
    }
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('wheel', function (e) {
      if (!mirror.running) return;
      e.preventDefault();
      var point = mirrorNormalized(e);
      mirrorControl({ kind: 'scroll', x: point.x, y: point.y, normalized: true, scrollX: e.deltaX / 800, scrollY: e.deltaY / 800 });
    }, { passive: false });
    window.addEventListener('resize', mirrorResize);
    mirrorResize();
  }

  function initMirrorTab() {
    mirrorBindTouch();
    api('GET', '/api/devices').then(function (data) {
      var devices = data.devices || [];
      var select = $('mirror-device');
      var current = select.value;
      select.innerHTML = '<option value="">选择设备…</option>' + devices.map(function (d) {
        return '<option value="' + esc(d.id) + '">' + esc(d.id) + ' (' + esc(d.status) + ')</option>';
      }).join('');
      select.value = current;
    }).catch(function () {});
    loadKeymap();
  }

  function startMirror() {
    var deviceId = $('mirror-device').value;
    if (!deviceId) { toast('请先选择设备'); return; }
    mirror.deviceId = deviceId;
    setMirrorStatus('连接中…');
    $('mirror-empty').style.display = 'none';
    api('POST', '/api/mirror/start', { deviceId: deviceId }).then(function (data) {
      mirror.running = true;
      mirror.width = data.width || 720;
      mirror.height = data.height || 1280;
      mirror.codec = data.codec || 'h264';
      mirrorResize();
      mirrorSetupDecoder();
      if (mirror.source) mirror.source.close();
      mirror.source = new EventSource('/api/mirror/stream?deviceId=' + encodeURIComponent(deviceId));
      mirror.source.onmessage = function (e) {
        try { mirrorHandleEvent(JSON.parse(e.data)); } catch (err) {}
      };
      mirror.source.onerror = function () { setMirrorStatus('连接中断'); };
      setMirrorStatus('已连接');
      mirror.lastFpsAt = Date.now();
      mirror.frames = 0;
      setInterval(function () {
        var now = Date.now();
        var elapsed = Math.max(1, now - mirror.lastFpsAt) / 1000;
        mirror.fps = Math.round(mirror.frames / elapsed);
        mirror.frames = 0;
        mirror.lastFpsAt = now;
        var fpsEl = $('mirror-fps');
        if (fpsEl) fpsEl.textContent = mirror.fps + ' fps';
      }, 1000);
    }).catch(function (e) {
      setMirrorStatus('连接失败');
      toast('镜像启动失败：' + e.message);
      $('mirror-empty').style.display = 'block';
    });
  }

  function stopMirror() {
    if (mirror.source) { mirror.source.close(); mirror.source = null; }
    try { mirror.decoder && mirror.decoder.close(); } catch (e) {}
    mirror.decoder = null;
    mirror.running = false;
    api('POST', '/api/mirror/stop', { deviceId: mirror.deviceId }).catch(function () {});
    setMirrorStatus('已断开');
    $('mirror-empty').style.display = 'block';
  }

  // ── web keymap (simplified editor) ────────────────────
  function loadKeymap() {
    api('GET', '/api/mirror/keymap?deviceId=' + encodeURIComponent(mirror.deviceId || $('mirror-device').value || ''))
      .then(function (data) {
        mirror.keymap.profiles = data.profiles || [];
        mirror.keymap.activeId = data.activeId || (mirror.keymap.profiles[0] && mirror.keymap.profiles[0].id) || null;
        renderKeymap();
      }).catch(function () {});
  }

  function activeProfile() {
    var id = mirror.keymap.activeId;
    for (var i = 0; i < mirror.keymap.profiles.length; i++) {
      if (mirror.keymap.profiles[i].id === id) return mirror.keymap.profiles[i];
    }
    return null;
  }

  function renderKeymap() {
    var list = $('keymap-list');
    if (!list) return;
    var profile = activeProfile();
    if (!profile || !profile.mappings.length) {
      list.innerHTML = '<div class="empty">暂无映射</div>';
      renderOverlay();
      return;
    }
    list.innerHTML = profile.mappings.map(function (m) {
      return '<div class="km-row' + (m.id === mirror.selectedId ? ' active' : '') + '" data-id="' + esc(m.id) + '">'
        + '<span class="km-name">点击</span>'
        + '<span class="km-key">' + esc((m.trigger && m.trigger.combo) || '未绑定') + '</span>'
        + '</div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-id]'), function (el) {
      el.addEventListener('click', function () {
        mirror.selectedId = el.getAttribute('data-id');
        renderKeymap();
      });
    });
    renderOverlay();
  }

  function renderOverlay() {
    var overlay = $('mirror-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    var profile = activeProfile();
    if (!profile) return;
    profile.mappings.forEach(function (m) {
      if (m.kind !== 'tap') return;
      var dot = document.createElement('div');
      dot.className = 'km-dot' + (m.id === mirror.selectedId ? ' active' : '');
      dot.style.left = (Number(m.position && m.position.x || 0) * 100) + '%';
      dot.style.top = (Number(m.position && m.position.y || 0) * 100) + '%';
      dot.textContent = (m.trigger && m.trigger.combo) || '点击';
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        mirror.selectedId = m.id;
        renderKeymap();
      });
      overlay.appendChild(dot);
    });
  }

  function addKeymapAt(event) {
    var profile = activeProfile();
    if (!profile) {
      profile = { id: 'profile_' + Date.now(), name: 'Default', mappings: [], settings: {} };
      mirror.keymap.profiles.push(profile);
      mirror.keymap.activeId = profile.id;
    }
    var point = mirrorNormalized(event);
    var mapping = {
      id: 'map_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      kind: 'tap',
      enabled: true,
      trigger: null,
      position: point,
      action: { type: 'tap' },
    };
    profile.mappings.push(mapping);
    mirror.selectedId = mapping.id;
    mirror.adding = false;
    saveKeymap();
    renderKeymap();
  }

  function saveKeymap() {
    var deviceId = mirror.deviceId || $('mirror-device').value;
    if (!deviceId) return;
    return api('POST', '/api/mirror/keymap', {
      deviceId: deviceId,
      profiles: mirror.keymap.profiles,
      activeId: mirror.keymap.activeId,
    }).catch(function () {});
  }

  function findMappingByCombo(combo) {
    var profile = activeProfile();
    if (!profile) return null;
    for (var i = 0; i < profile.mappings.length; i++) {
      var m = profile.mappings[i];
      if (m.enabled !== false && m.trigger && m.trigger.combo === combo) return m;
    }
    return null;
  }

  function comboFromEvent(e) {
    var parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    var code = e.code || '';
    var key = code.indexOf('Key') === 0 ? code.slice(3) : code.indexOf('Digit') === 0 ? code.slice(5) : code;
    if (key) parts.push(key);
    return parts.join('+');
  }

  function handleMirrorKeyDown(e) {
    if ($('mirror-page').style.display === 'none') return;
    if (mirror.capturing) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        var profile = activeProfile();
        var mapping = profile && profile.mappings.find(function (m) { return m.id === mirror.selectedId; });
        if (mapping) {
          mapping.trigger = { combo: comboFromEvent(e), code: e.code };
          saveKeymap();
          renderKeymap();
        }
      }
      mirror.capturing = false;
      setMirrorStatus('已连接');
      return;
    }
    if (!mirror.running) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;

    var combo = comboFromEvent(e);
    var hit = findMappingByCombo(combo);
    if (hit) {
      e.preventDefault();
      mirrorControl({ kind: 'touch', action: 'down', pointerId: -99, x: hit.position.x, y: hit.position.y, normalized: true });
      setTimeout(function () {
        mirrorControl({ kind: 'touch', action: 'up', pointerId: -99, x: hit.position.x, y: hit.position.y, normalized: true, pressure: 0 });
      }, 40);
      return;
    }
    // basic key passthrough
    if (e.code === 'Escape') { e.preventDefault(); mirrorControl({ kind: 'command', command: 'back' }); return; }
    if (e.key === 'Backspace') { e.preventDefault(); mirrorControl({ kind: 'key', action: 'down', keyCode: 67 }); return; }
    if (e.key === 'Enter') { e.preventDefault(); mirrorControl({ kind: 'key', action: 'down', keyCode: 66 }); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      mirrorControl({ kind: 'text', text: e.key });
    }
  }

  $('mirror-start').addEventListener('click', startMirror);
  $('mirror-stop').addEventListener('click', stopMirror);
  $('mirror-device').addEventListener('change', function () { mirror.deviceId = this.value; loadKeymap(); });
  $('mirror-keymap-toggle').addEventListener('click', function () {
    var panel = $('mirror-keymap');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });
  $('keymap-add').addEventListener('click', function () { mirror.adding = true; toast('在画面上点击以添加映射'); });
  $('keymap-capture').addEventListener('click', function () {
    if (!mirror.selectedId) { toast('请先选择一个映射'); return; }
    mirror.capturing = true;
    setMirrorStatus('请按下要绑定的按键（Esc 取消）');
  });
  $('keymap-del').addEventListener('click', function () {
    var profile = activeProfile();
    if (!profile || !mirror.selectedId) return;
    profile.mappings = profile.mappings.filter(function (m) { return m.id !== mirror.selectedId; });
    mirror.selectedId = null;
    saveKeymap();
    renderKeymap();
  });
  window.addEventListener('keydown', handleMirrorKeyDown, true);

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
