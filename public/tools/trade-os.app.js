/* ============================================================
   北极星外贸 OS · 应用控制器
   壳层：可收纳功能栏 + 工作区模块切换 + 报关/建联抽屉 + AI 对话坞。
   交互与动效：rail 折叠、模块 crossfade、抽屉滑入、漏斗生长、KPI 计数、
   对话流式打字。事件委托统一处理 data-act / data-drawer。
   ============================================================ */
(function () {
  "use strict";
  const T = window.TRADE, MOD = window.TRADE_MOD;
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");

  const state = {
    mod: "m0",
    railCollapsed: false,
    chatCollapsed: false,
    drawer: null, // {modId, itemId, tab, lang}
  };

  /* ─────────── 左：功能栏 ─────────── */
  function renderRail() {
    const scroll = $("#railScroll");
    const groups = [];
    T.MODULES.forEach((m) => {
      let g = groups.find((x) => x.name === m.group);
      if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
      g.items.push(m);
    });
    scroll.innerHTML = groups.map((g) => `
      <div class="rgroup-label">${g.name}</div>
      ${g.items.map((m) => `<button class="ritem ${m.id === state.mod ? "on" : ""}" data-mod="${m.id}" title="${m.no} ${m.name} — ${m.sub}">
        <span class="ico">${svg(m.icon)}</span>
        <span class="lbl">${m.name}</span>
        ${m.star ? '<span class="star">★</span>' : ""}
        ${m.pip ? `<span class="pip ${m.warn ? "warn" : ""}">${m.pip}</span>` : ""}
      </button>`).join("")}
    `).join("");
  }
  function svg(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  /* ─────────── 中：工作区 ─────────── */
  function renderWork() {
    const m = T.MODULES.find((x) => x.id === state.mod);
    const view = MOD.views[state.mod]();
    $("#crumbGroup").textContent = m.group;
    $("#crumbMod").textContent = m.name;
    $("#wTitle").innerHTML = `<span class="mno">${m.no}</span>${view.title}${view.star ? '<span class="star">★</span>' : ""}`;
    $("#wSub").textContent = view.sub || "";
    const body = $("#wBody");
    body.innerHTML = `<div class="view-anim">${view.body}</div>`;
    // 入场动效：KPI 计数 + 漏斗生长
    requestAnimationFrame(() => {
      body.querySelectorAll(".fn-fill").forEach((el) => { el.style.width = el.dataset.w + "%"; });
      body.querySelectorAll(".kv[data-count]").forEach(countUp);
    });
    updateChatCtx();
  }

  /* KPI 数字计数动画（仅纯数字/带前缀的） */
  function countUp(el) {
    const raw = el.dataset.count;
    const m = raw.match(/^(\$?)([\d.]+)(.*)$/);
    if (!m) return;
    const pre = m[1], target = parseFloat(m[2]), suf = m[3];
    if (isNaN(target)) return;
    const dur = 620, start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const val = target * e;
      el.textContent = pre + (target % 1 === 0 ? Math.round(val) : val.toFixed(2)) + suf;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = raw;
    }
    requestAnimationFrame(tick);
  }

  function switchMod(id) {
    if (id === state.mod) return;
    state.mod = id;
    closeDrawer(true);
    renderRail();
    renderWork();
    renderQuick();
    // 切模块给对话一条上下文提示
  }

  /* ─────────── 抽屉 ─────────── */
  function openDrawer(modId, itemId) {
    const d = MOD.getDrawer(modId, itemId);
    if (!d) return;
    state.drawer = { modId, itemId, tab: d.tabs[0].k, lang: "en" };
    renderDrawer();
  }
  function renderDrawer() {
    if (!state.drawer) return;
    const { modId, itemId, tab, lang } = state.drawer;
    const d = MOD.getDrawer(modId, itemId);
    let el = $("#drawerRoot");
    if (!el) {
      el = document.createElement("div");
      el.id = "drawerRoot";
      $(".work").appendChild(el);
    }
    el.innerHTML = `
      <div class="drawer-mask" data-close-drawer></div>
      <div class="drawer">
        <div class="drawer-head">
          <div class="dh-top">
            <div style="flex:1;min-width:0"><h3>${d.title}</h3><div class="dh-sub">${d.sub}</div></div>
            <button class="chat-x" data-close-drawer><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          <div class="dtabs">${d.tabs.map((t) => `<button class="dtab ${t.k === tab ? "on" : ""}" data-dtab="${t.k}">${t.label}</button>`).join("")}</div>
        </div>
        <div class="drawer-body">${d.body(tab, lang)}</div>
        <div class="drawer-foot">${d.foot || ""}</div>
      </div>`;
  }
  function closeDrawer(instant) {
    const el = $("#drawerRoot");
    if (!el) { state.drawer = null; return; }
    if (instant) { el.remove(); state.drawer = null; return; }
    const drawer = el.querySelector(".drawer");
    const mask = el.querySelector(".drawer-mask");
    if (drawer) { drawer.style.transition = "transform .26s cubic-bezier(.4,0,1,1)"; drawer.style.transform = "translateX(100%)"; }
    if (mask) mask.style.opacity = "0";
    setTimeout(() => { el.remove(); state.drawer = null; }, 250);
  }

  /* ─────────── 右：对话坞 ─────────── */
  function updateChatCtx() {
    const m = T.MODULES.find((x) => x.id === state.mod);
    $("#chatCtx").innerHTML = `上下文：<b>${m ? m.name : "工作台"}</b>`;
  }
  function renderQuick() {
    const qs = MOD.quick[state.mod] || [];
    $("#chatQuick").innerHTML = qs.map((q) => `<button class="qchip" data-msg="${q.msg}">${q.label}</button>`).join("");
  }

  /* ─────────── Claude Code 桥（→ 父窗口 useAgentRunner → claude CLI） ─────────── */
  const bridge = { ready: false, cbs: {} };
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__tradeos !== true) return;
    if (d.type === "ready") { bridge.ready = true; setEngineBadge(true); return; }
    const cb = bridge.cbs[d.reqId];
    if (!cb) return;
    if (d.type === "delta") cb.onDelta(d.full || "");
    else if (d.type === "tool") cb.onTool(d.tool, d.detail);
    else if (d.type === "done") { cb.onDone(d.full || ""); delete bridge.cbs[d.reqId]; }
    else if (d.type === "error") { cb.onError(d.message); delete bridge.cbs[d.reqId]; }
  });
  // 握手：若在 iframe 中，向父窗口打招呼；真后端（Tauri）会回 ready 接管。
  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage({ __tradeos: true, type: "hello" }, "*"); } catch (_) {}
  }
  function setEngineBadge(live) {
    const s = document.querySelector(".chat-head .ct .n .badge");
    if (s) { s.textContent = live ? "Claude Code · 已接入" : "Claude Code"; s.title = live ? "已连到 Polaris 后端，经 useAgentRunner 调用官方 claude CLI" : "浏览器演示"; }
  }
  function needKb(modId, text) {
    return /HS|归类|税则|ChAFTA|WET|GST|合规|产区|话术|检索|知识库/i.test(text) || ["m4", "m9", "m11"].includes(modId);
  }
  function buildPrompt(modId, text) {
    const m = T.MODULES.find((x) => x.id === modId);
    return `你是「北极星外贸 OS」的业务助手，服务澳洲进口分销商『澳鲸进口 / Orca Imports Pty Ltd』（葡萄酒/食品进口）。\n`
      + `当前功能模块：${m ? m.no + " " + m.name : "工作台"}（${m ? m.sub : ""}）。\n`
      + `边界原则：算自己做、报交出去；结构化产出 + 关键动作人工确认；不做群发骚扰、不直连海关。\n`
      + `请用中文、专业且简洁地作答；涉及报关/税费/HS/报价时给出要点式结构化结论。\n\n用户请求：${text}`;
  }
  function renderMd(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
  }

  let chatBusy = false;
  function pushMsg(role, html) {
    const log = $("#chatLog");
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.innerHTML = `<div class="av">${role === "ai" ? "★" : "你"}</div><div class="bubble">${html}</div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el.querySelector(".bubble");
  }
  function sendChat(text) {
    text = (text || "").trim();
    if (!text || chatBusy) return;
    pushMsg("me", esc(text));
    chatBusy = true;
    $("#chatSend").disabled = true;
    // typing 占位
    const bubble = pushMsg("ai", `<span class="typing"><i></i><i></i><i></i></span>`);
    if (bridge.ready) runViaBridge(bubble, text);
    else {
      const res = MOD.chat(state.mod, text);
      setTimeout(() => streamReply(bubble, res), 620);
    }
  }

  /* 走真后端：postMessage → useAgentRunner.run() → claude CLI，流式回填。 */
  function runViaBridge(bubble, text) {
    const reqId = "r" + Math.random().toString(36).slice(2, 9);
    const tools = [];
    let got = false;
    const done = (fn) => { clearTimeout(watchdog); fn(); chatBusy = false; $("#chatSend").disabled = false; };
    const watchdog = setTimeout(() => {
      if (got) return;
      delete bridge.cbs[reqId];
      // 迟迟无响应 → 回落本地演示，保证"稳定有效"不空转
      const res = MOD.chat(state.mod, text);
      bubble.innerHTML = `<span style="color:var(--amber);font-size:11.5px">· 后端响应超时，转本地演示 ·</span><br>`;
      streamReply(bubble, res);
    }, 120000);
    bridge.cbs[reqId] = {
      onDelta: (full) => {
        got = true;
        bubble.innerHTML = renderMd(full) + '<span style="opacity:.5">▍</span>';
        $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
      },
      onTool: (tool, detail) => { got = true; tools.push(detail ? `${tool} · ${detail}` : tool); },
      onDone: (full) => done(() => {
        let html = renderMd(full || "（无内容）");
        if (tools.length) html += `<div class="tools-trace"><div class="tt-head" data-toggle-trace><span class="dot"></span>AI 跑了什么 · ${tools.length} 个动作 ▾</div><div class="tt-body">${tools.map((t) => `<div><span class="tl">▸</span> ${esc(t)}</div>`).join("")}</div></div>`;
        bubble.innerHTML = html;
        $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
      }),
      onError: (msg) => done(() => {
        const res = MOD.chat(state.mod, text);
        bubble.innerHTML = `<span style="color:var(--amber);font-size:11.5px">· 后端不可用（${esc(msg || "")}），转本地演示 ·</span><br>`;
        streamReply(bubble, res);
      }),
    };
    try {
      window.parent.postMessage({ __tradeos: true, type: "run", reqId, prompt: buildPrompt(state.mod, text), useKb: needKb(state.mod, text) }, "*");
    } catch (err) {
      bridge.cbs[reqId].onError(String(err));
    }
  }
  function streamReply(bubble, res) {
    // 逐字流式主回复
    const full = res.reply;
    let i = 0;
    bubble.innerHTML = "";
    const speed = 12;
    function type() {
      if (i <= full.length) {
        // 避免把 HTML 标签打断：整体渲染到当前长度，标签用简单保护
        bubble.innerHTML = safeSlice(full, i) + '<span style="opacity:.5">▍</span>';
        $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
        i += 2;
        setTimeout(type, speed);
      } else {
        bubble.innerHTML = full;
        finishReply(bubble, res);
      }
    }
    type();
  }
  function finishReply(bubble, res) {
    let extra = "";
    if (res.tools) {
      extra += `<div class="tools-trace"><div class="tt-head" data-toggle-trace><span class="dot"></span>AI 跑了什么 · ${res.tools.length} 个动作 ▾</div>
        <div class="tt-body">${res.tools.map((t) => `<div><span class="tl">▸</span> ${esc(t)}</div>`).join("")}</div></div>`;
    }
    if (res.out) {
      extra += `<div class="out-card"><div class="oh">◆ ${esc(res.out.title)}</div><div class="ob">
        ${res.out.kv.map((kv) => `<div class="out-kv"><span class="k">${esc(kv[0])}</span><span class="v">${kv[1]}</span></div>`).join("")}
      </div></div>`;
    }
    if (res.tail) extra += `<div style="margin-top:9px">${res.tail}</div>`;
    bubble.innerHTML += extra;
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
    chatBusy = false;
    $("#chatSend").disabled = false;
  }
  // 从含 HTML 的字符串里安全取前 n 个"可见字符"（跳过标签整体）
  function safeSlice(html, n) {
    let out = "", count = 0, i = 0;
    while (i < html.length && count < n) {
      if (html[i] === "<") { const e = html.indexOf(">", i); if (e < 0) break; out += html.slice(i, e + 1); i = e + 1; }
      else { out += html[i]; i++; count++; }
    }
    // 补齐未闭合的标签片段（简单情形直接返回，浏览器容错）
    return out;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function greet() {
    pushMsg("ai", `你好，我是<b>北极星助手</b>（Claude Code 大脑）。左侧是澳鲸进口的全链路功能，中间是企业信息工作区。<br><br>我可以帮你：<span class="hl">生成报关草稿</span>、<span class="hl">写破冰开发信</span>、<span class="hl">HS 归类</span>、<span class="hl">三单校验</span>、<span class="hl">智能补货</span>、<span class="hl">AI 对账</span>——关键动作前都有人工闸。点下方快捷操作试试。`);
  }

  /* ─────────── 折叠控制 ─────────── */
  function toggleRail() {
    state.railCollapsed = !state.railCollapsed;
    app.classList.toggle("rail-collapsed", state.railCollapsed);
    $("#rail").classList.toggle("collapsed", state.railCollapsed);
  }
  function toggleChat(open) {
    state.chatCollapsed = open === undefined ? !state.chatCollapsed : !open;
    app.classList.toggle("chat-collapsed", state.chatCollapsed);
  }

  /* ─────────── toast ─────────── */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    $("#toastMsg").textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  /* ─────────── 事件委托 ─────────── */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-mod],[data-drawer],[data-dtab],[data-lang],[data-close-drawer],[data-act],[data-msg],[data-toggle-trace],#railToggle,#chatClose,#chatReopen,#chatSend");
    if (!el) return;

    if (el.id === "railToggle") return toggleRail();
    if (el.id === "chatClose") return toggleChat(false);
    if (el.id === "chatReopen") return toggleChat(true);
    if (el.id === "chatSend") return sendChat($("#chatText").value), ($("#chatText").value = ""), autoGrow();

    if (el.hasAttribute("data-mod")) return switchMod(el.dataset.mod);

    if (el.hasAttribute("data-close-drawer")) return closeDrawer();

    if (el.hasAttribute("data-dtab")) {
      if (state.drawer) { state.drawer.tab = el.dataset.dtab; renderDrawer(); }
      return;
    }
    if (el.hasAttribute("data-lang")) {
      if (state.drawer) { state.drawer.lang = el.dataset.lang; renderDrawer(); }
      return;
    }
    if (el.hasAttribute("data-toggle-trace")) {
      const body = el.parentElement.querySelector(".tt-body");
      if (body) body.classList.toggle("open");
      return;
    }

    // data-drawer 打开抽屉（行/按钮）
    const drawerRow = el.closest("[data-drawer]");
    if (drawerRow && drawerRow.hasAttribute("data-drawer") && drawerRow.hasAttribute("data-id")) {
      // 若行内又点了带 data-act 的按钮，优先按钮
      if (!el.hasAttribute("data-act") && !el.hasAttribute("data-msg")) {
        return openDrawer(drawerRow.dataset.drawer, drawerRow.dataset.id);
      }
    }

    // data-act
    const act = el.getAttribute("data-act");
    if (act === "toast") { toast(el.getAttribute("data-msg") || "已完成"); return; }
    if (act === "chat") {
      if (state.chatCollapsed) toggleChat(true);
      sendChat(el.getAttribute("data-msg"));
      return;
    }
    // 纯 data-msg 快捷 chip
    if (el.classList.contains("qchip") || (el.hasAttribute("data-msg") && !act)) {
      if (state.chatCollapsed) toggleChat(true);
      sendChat(el.getAttribute("data-msg"));
      return;
    }
  });

  // 行内点击（tr.clk）委托：整行可点开抽屉
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.clk[data-drawer][data-id]");
    if (!tr) return;
    if (e.target.closest("[data-act],[data-msg]")) return; // 行内按钮已处理
    openDrawer(tr.dataset.drawer, tr.dataset.id);
  });

  /* textarea 自增高 + 回车发送 */
  function autoGrow() {
    const ta = $("#chatText");
    ta.style.height = "auto";
    ta.style.height = Math.min(120, ta.scrollHeight) + "px";
  }
  $("#chatText").addEventListener("input", autoGrow);
  $("#chatText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat($("#chatText").value);
      $("#chatText").value = "";
      autoGrow();
    }
  });

  /* ─────────── 深链（#mod/itemId/tab · ?send=…） ─────────── */
  function applyDeepLink() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) return;
    const [modId, itemId, tab] = h.split("/");
    if (modId && T.MODULES.some((m) => m.id === modId)) {
      if (modId !== state.mod) { state.mod = modId; renderRail(); renderWork(); renderQuick(); }
      if (itemId) { openDrawer(modId, itemId); if (tab && state.drawer) { state.drawer.tab = tab; renderDrawer(); } }
    }
    const qp = new URLSearchParams(location.search);
    if (qp.get("rail") === "collapsed" && !state.railCollapsed) toggleRail();
    if (qp.get("chat") === "closed" && !state.chatCollapsed) toggleChat(false);
    const send = qp.get("send");
    if (send) setTimeout(() => sendChat(send), 400);
  }

  /* ─────────── 启动 ─────────── */
  renderRail();
  renderWork();
  renderQuick();
  greet();
  applyDeepLink();
  window.addEventListener("hashchange", applyDeepLink);
})();
