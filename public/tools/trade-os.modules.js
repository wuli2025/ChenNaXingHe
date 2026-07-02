/* ============================================================
   北极星外贸 OS · 模块视图层
   每个模块渲染成企业信息工作区内容。深挖 M0 驾驶舱 / M2 建联★ / M4 报关★。
   导出：TRADE_MOD.views / getDrawer / quick / chat
   ============================================================ */
window.TRADE_MOD = (function () {
  "use strict";
  const T = window.TRADE;

  /* ── 通用小工具 ── */
  const fmt = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const confClass = (p) => (p >= 85 ? "hi" : p >= 60 ? "mid" : "lo");
  function conf(p) {
    if (!p && p !== 0) return "—";
    return `<span class="conf ${confClass(p)}"><span class="bar"><i style="width:${p}%"></i></span><span class="pct">${p}%</span></span>`;
  }
  function icon(path, size = 19) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }
  /* 迷你趋势 sparkline */
  function spark(series, color, fill) {
    const w = 260, h = 44, pad = 3;
    const min = Math.min(...series), max = Math.max(...series);
    const rng = max - min || 1;
    const pts = series.map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / (series.length - 1);
      const y = h - pad - ((v - min) / rng) * (h - pad * 2);
      return [x, y];
    });
    const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const area = `${pad},${h} ` + line + ` ${w - pad},${h}`;
    const id = "g" + Math.random().toString(36).slice(2, 7);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${fill ? `<polygon points="${area}" fill="url(#${id})"/>` : ""}
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.6" fill="${color}"/>
    </svg>`;
  }
  const statusBadge = {
    draft: '<span class="badge b-gray">草稿</span>', reviewing: '<span class="badge b-amber">复核中</span>',
    exported: '<span class="badge b-blue">已导出</span>', released: '<span class="badge b-green">已放行</span>',
    new: '<span class="badge b-gray">新线索</span>', contacted: '<span class="badge b-blue">已建联</span>',
    replied: '<span class="badge b-teal">有回复</span>', qualified: '<span class="badge b-purple">进比价</span>',
    converted: '<span class="badge b-green">已转化</span>', invalid: '<span class="badge b-gray">无效</span>',
    unsub: '<span class="badge b-red">退订</span>',
  };
  const checkIcon = { pass: '<span class="ci pass">✓</span>', hard: '<span class="ci hard">✕</span>', soft: '<span class="ci soft">△</span>' };

  /* ══════════════════ M0 经营驾驶舱 ══════════════════ */
  function m0() {
    const k = T.dashKpi.map((x) => `<div class="card kpi acc-${x.acc}">
      <div class="kico">${icon(x.ico, 34)}</div>
      <div class="kv" data-count="${x.v}">${x.v}</div>
      <div class="kl">${x.l}</div>
      <div class="kd">${x.up === true ? '<span class="up">▲</span>' : x.up === false ? '<span class="dn">▼</span>' : ""}<span>${x.d}</span></div>
    </div>`).join("");

    const tr = T.trends.map((t) => `<div class="card trend-card">
      <div class="th"><span class="tv">${t.v}</span><span class="tl">${t.l}</span>
        <span class="tdelta ${t.up ? "up" : "dn"}" style="color:${t.up ? "var(--green)" : "var(--red)"}">${t.delta}</span></div>
      ${spark(t.series, t.up ? "var(--green)" : "var(--gold2)", true)}
    </div>`).join("");

    const pipe = T.pipeline.map((p) => `<div class="pipe-node"><div class="pn-c">${p.c}</div><div class="pn-l">${p.l}</div>
      <span class="pn-a">›</span></div>`).join("");

    const brief = T.briefing.map((b) => `<div class="card tight" style="min-width:0">
      <div style="font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--gold2);text-transform:uppercase;margin-bottom:8px">${b.k}</div>
      <ul style="list-style:none;display:flex;flex-direction:column;gap:7px">
        ${b.items.map((i) => `<li style="font-size:12.5px;color:var(--ink2);display:flex;gap:7px"><span style="color:var(--ink4)">·</span><span>${i}</span></li>`).join("")}
      </ul></div>`).join("");

    const body = `
      <div class="grid g3" style="grid-template-columns:repeat(6,1fr)">${k}</div>
      <div class="sec-h"><h3>经营趋势</h3><span class="sh-sub">销售 · 毛利 · 现金转换周期</span>
        <div class="sh-r"><span class="pill">近 12 周</span></div></div>
      <div class="grid g3">${tr}</div>
      <div class="sec-h"><h3>端到端流水线</h3><span class="sh-sub">选品 → 建联 → 采购 → 报关 → 物流 → 分销 → 对账</span></div>
      <div class="card pad"><div class="pipe">${pipe}</div></div>
      <div class="sec-h"><h3>今日晨报</h3><span class="sh-sub">Claude Code 聚合各模块当日状态生成</span>
        <div class="sh-r"><button class="btn sm" data-act="chat" data-msg="重新生成今日晨报">${icon(T.I.workflow, 14)} 重新生成</button></div></div>
      <div class="grid g3">${brief}</div>`;
    return { title: "经营驾驶舱", sub: "澳鲸进口 · 澳洲进口分销全链路 · 数据实时汇总", body };
  }

  /* ══════════════════ M2 供应商建联 ★ ══════════════════ */
  function m2() {
    const max = Math.max(...T.outreachFunnel.map((f) => f.n));
    const funnel = T.outreachFunnel.map((f, i) => `<div class="fn-row">
      <div class="fn-lbl">${f.stage}</div>
      <div class="fn-track"><div class="fn-fill" style="background:${f.color};transition-delay:${i * 90}ms" data-w="${(f.n / max) * 100}">${f.n}</div></div>
      <div class="fn-conv">${f.conv}</div></div>`).join("");

    const rows = T.leads.map((l) => `<tr class="clk" data-drawer="m2" data-id="${l.id}">
      <td><b>${l.company}</b><div style="font-size:11px;color:var(--ink4)">${l.contact} · ${l.email}</div></td>
      <td>${l.country} · ${l.region}</td>
      <td style="max-width:180px">${l.category}</td>
      <td><span class="badge ${l.grade === "A" ? "b-gold" : l.grade === "B" ? "b-blue" : "b-gray"}">${l.grade} · ${l.score}</span></td>
      <td><span class="pill" style="font-size:10.5px">${l.source === "sourcing" ? "选品带出" : l.source === "manual" ? "人工录入" : "名录导入"}</span></td>
      <td>${statusBadge[l.status] || ""}</td>
    </tr>`).join("");

    const body = `
      <div class="note gold" style="margin-top:2px"><b>反骚扰核心：</b>三道人工闸 + 去重（30 天同 domain）+ 频控 + 退订抑制。逐家个性化开发信，非模板群发。点线索行进入右侧抽屉。</div>
      <div class="sec-h"><h3>供应商开发漏斗 · 本月</h3><span class="sh-sub">线索 → 建联 → 回复 → 比价 → 合作</span></div>
      <div class="card pad"><div class="funnel">${funnel}</div></div>
      <div class="sec-h"><h3>线索池</h3><span class="sh-sub">${T.leads.length} 条 · 同公司自动去重合并</span>
        <div class="sh-r">
          <button class="btn sm" data-act="chat" data-msg="从选品采集把智利/南非新酒庄一键存为建联线索">${icon(T.I.sourcing, 14)} 从选品带出</button>
          <button class="btn sm gold" data-act="chat" data-msg="给 A 级线索 Viña Aurora 生成一封个性化破冰开发信">✎ 生成开发信</button>
        </div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>公司 / 联系人</th><th>国家 · 产区</th><th>主营品类</th><th>建联优先级</th><th>来源</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return { title: "供应商初次建联", star: true, sub: "采购上游漏斗 · 从线索到破冰开发信到回信转化", body };
  }

  /* ══════════════════ M4 报关单撰写 ★ ══════════════════ */
  function m4() {
    const kpi = [
      { v: T.customsKpi.pending, l: "待报关货柜", acc: "amber" },
      { v: T.customsKpi.reviewing, l: "报关中", acc: "blue" },
      { v: T.customsKpi.released, l: "已放行", acc: "green" },
      { v: T.customsKpi.inspected, l: "查验中", acc: "red" },
    ].map((x) => `<div class="card kpi acc-${x.acc}"><div class="kv">${x.v}</div><div class="kl">${x.l}</div></div>`).join("");

    const rows = T.declarations.map((d) => {
      const chk = d.checkStatus === "hard" ? '<span class="sdot" style="color:var(--red)">硬差异·拦截</span>'
        : d.checkStatus === "soft" ? '<span class="sdot" style="color:var(--amber)">软差异·提示</span>'
        : '<span class="sdot" style="color:var(--green)">一致</span>';
      return `<tr class="clk" data-drawer="m4" data-id="${d.id}">
        <td><b>货柜 ${d.id}</b><div style="font-size:11px;color:var(--ink4)">${d.container}</div></td>
        <td>${d.po}<div style="font-size:11px;color:var(--ink4)">${d.supplier}</div></td>
        <td style="max-width:150px">${d.goods}</td>
        <td>${d.terms}</td>
        <td class="num">${fmt(d.cif)}</td>
        <td>${conf(d.hsComplete)}</td>
        <td>${chk}</td>
        <td>${statusBadge[d.status] || ""}</td>
      </tr>`;
    }).join("");

    const body = `
      <div class="note info" style="margin-top:2px"><b>算自己做，报交出去：</b>货柜 ETA-5d 自动拼报关草稿（填充率 ≥90%），HS 归类 + 三单一致 + WET/GST 测算，人工确认后导出 PDF/EDI 交报关行；<b>系统不直连海关 ICS</b>。</div>
      <div class="grid g4">${kpi}</div>
      <div class="sec-h"><h3>待报关货柜清单</h3><span class="sh-sub">点行进入报关单编辑抽屉 · 双人工闸</span>
        <div class="sh-r"><button class="btn sm gold" data-act="chat" data-msg="为货柜 0617 生成报关草稿并做 HS 归类与三单一致校验">${icon(T.I.customs, 14)} 生成报关草稿</button></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>货柜</th><th>PO / 供应商</th><th>商品</th><th>成交方式</th><th>完税价格 CIF</th><th>HS 完整度</th><th>校验状态</th><th>报关状态</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return { title: "报关单撰写", star: true, sub: "报关草稿自动成稿 · HS 归类 · 三单一致 · 缺证拦发货", body };
  }

  /* ══════════════════ M1 选品采集 ══════════════════ */
  function m1() {
    const rows = T.skuCandidates.map((s) => `<tr>
      <td><b>${s.name}</b></td><td>${s.region}</td><td class="num">${s.priceBand}</td>
      <td>${s.certs}</td><td>${conf(s.conf)}</td>
      <td><button class="btn sm" data-act="chat" data-msg="把 ${s.name}（${s.region}）存为供应商建联线索">存为线索</button></td>
    </tr>`).join("");
    const body = `
      <div class="card pad"><div class="sec-h" style="margin-top:0"><h3>采集条件</h3><span class="sh-sub">品类 / 产区 / 关键词 → Agent 联网采集 · 三级降级</span></div>
        <div style="display:flex;gap:9px;flex-wrap:wrap">
          <span class="pill">品类：进口葡萄酒</span><span class="pill">产区：智利 / 南非 / 阿根廷</span>
          <span class="pill">价位：FOB $4–8</span><span class="pill">认证：有机 / HACCP 优先</span>
          <button class="btn sm gold" data-act="chat" data-msg="按『智利/南非新酒庄·有机红酒』采集一批选品候选并抽结构化字段">${icon(T.I.sourcing, 14)} 开始采集</button>
        </div></div>
      <div class="sec-h"><h3>候选品结果</h3><span class="sh-sub">SkuCandidate · 字段置信度 · 可入库/存为线索</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>品名</th><th>产区</th><th>价位带</th><th>认证</th><th>置信度</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return { title: "选品采集", sub: "自研采集器 · 结构化为 SKU 候选 · 三级降级", body };
  }

  /* ══════════════════ M3 供应商与采购 ══════════════════ */
  function m3() {
    const rows = T.suppliers.map((s) => `<tr>
      <td><b>${s.name}</b> ${s.tag ? `<span class="badge ${s.tag === "核心" ? "b-gold" : "b-teal"}">${s.tag}</span>` : ""}<div style="font-size:11px;color:var(--ink4)">${s.country} · ${s.cat}</div></td>
      <td class="num">${s.onTime || "—"}${s.onTime ? "%" : ""}</td>
      <td class="num">${s.price || "—"}</td>
      <td class="num">${s.quality || "—"}</td>
      <td><b class="num" style="color:var(--gold2)">${s.composite || "—"}</b></td>
      <td><span class="badge ${s.grade === "A" ? "b-gold" : s.grade === "B" ? "b-blue" : "b-gray"}">${s.grade}</span></td>
    </tr>`).join("");
    const body = `
      <div class="sec-h" style="margin-top:2px"><h3>供应商公海 · 多维评分</h3><span class="sh-sub">准时率 / 报价 / 质量 → 综合分</span>
        <div class="sh-r"><button class="btn sm gold" data-act="chat" data-msg="给核心供应商群发一轮 Shiraz 比价询价邮件，并把回信抽成结构化报价">${icon(T.I.purchase, 14)} 群发比价询价</button></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>供应商</th><th>准时率</th><th>报价分</th><th>质量分</th><th>综合</th><th>等级</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="note ok">回信抽取沿用反幻觉范式：剥签名 → 抽 {报价,币种,交期,MOQ,有效期} + 字段置信度，&lt;85% 高亮转人工确认后回写采购单。</div>`;
    return { title: "供应商与采购", sub: "已合作供应商评分 · 询价比价 · 结构化回信抽取", body };
  }

  /* ══════════════════ M5 物流管理 ══════════════════ */
  function m5() {
    const cards = T.shipments.map((s) => {
      const ms = s.milestones.map((m) => `<div class="tl-item ${m.now ? "now" : m.done ? "done" : ""}">
        <div class="tlt">${m.t}</div><div class="tlm">${m.at}</div></div>`).join("");
      return `<div class="card pad">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <b style="font-size:15px">货柜 ${s.id}</b><span class="badge b-blue">${s.status}</span>
          <span style="margin-left:auto;font-size:11.5px;color:var(--ink3)">${s.from} → ${s.to}</span></div>
        <div style="display:flex;gap:16px;font-size:12px;color:var(--ink3);margin-bottom:12px">
          <span>ETA P50 <b style="color:var(--ink)">${s.etaP50}</b></span>
          <span>P90 <b style="color:var(--ink)">${s.etaP90}</b></span>
          <span>滞期风险 <b style="color:${s.demurrage === "中" ? "var(--amber)" : "var(--green)"}">${s.demurrage}</b></span></div>
        <div class="timeline">${ms}</div></div>`;
    }).join("");
    const body = `
      <div class="sec-h" style="margin-top:2px"><h3>在途货柜 · 全程跟踪</h3><span class="sh-sub">里程碑 · ETA P50/P90 · 滞期预警 · 到港自动开 GRN</span></div>
      <div class="grid g2">${cards}</div>`;
    return { title: "物流管理", sub: "订舱 → 海运在途 → 到港清关 → 派送入仓", body };
  }

  /* ══════════════════ M6 厂仓 / 补货 ══════════════════ */
  function m6() {
    const rows = T.stock.map((s) => `<tr>
      <td><b>${s.name}</b><div style="font-size:11px;color:var(--ink4)">${s.sku} · 批次 ${s.batch}</div></td>
      <td class="num">${s.qty.toLocaleString()}</td>
      <td>${s.expiry} ${s.expiry < "2026-00" ? '<span class="badge b-red">临期</span>' : ""}</td>
      <td class="num">${fmt(s.landed)}/瓶</td>
      <td>${s.fefo ? `<span class="badge b-teal">FEFO #${s.fefo}</span>` : '<span class="badge b-red">优先出库</span>'}</td>
    </tr>`).join("");
    const rep = T.replenish.map((r) => `<div class="card tight" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:9px"><b>${r.name}</b>
        <span class="badge b-gold">建议补 ${r.qty.toLocaleString()} 瓶</span>
        <span style="margin-left:auto;font-size:11.5px;color:var(--amber)">${r.by}</span></div>
      <div style="font-size:12px;color:var(--ink3);margin-top:6px">${r.reason}</div></div>`).join("");
    const body = `
      <div class="sec-h" style="margin-top:2px"><h3>库存总览 · FEFO 效期</h3><span class="sh-sub">批次效期 · 落地成本分摊（到岸成本/瓶）</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>商品</th><th>在库</th><th>效期</th><th>落地成本</th><th>FEFO 排序</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="sec-h"><h3>智能补货建议</h3><span class="sh-sub">以销定采 · 数值本地算，AI 解释</span>
        <div class="sh-r"><button class="btn sm" data-act="chat" data-msg="根据销量+在库+在途+交期，给出智能补货建议并说明理由">重新计算</button></div></div>
      ${rep}`;
    return { title: "厂仓 / 补货", sub: "收货上架 · FEFO 效期 · 落地成本 · 智能补货", body };
  }

  /* ══════════════════ M7 客户与分销 ══════════════════ */
  function m7() {
    const cust = T.customers.map((c) => `<tr>
      <td><b>${c.name}</b></td><td><span class="badge ${c.tier === "A" ? "b-gold" : "b-blue"}">${c.tier}</span></td>
      <td>${c.terms}</td><td class="num">${fmt(c.ytd)}</td>
      <td class="num" style="color:${c.open > 30000 ? "var(--amber)" : "var(--ink2)"}">${fmt(c.open)}</td>
      <td>${c.status === "活跃" ? '<span class="sdot" style="color:var(--green)">活跃</span>' : '<span class="sdot" style="color:var(--amber)">对账中</span>'}</td>
    </tr>`).join("");
    const so = T.salesOrders.map((o) => `<tr>
      <td><b>${o.id}</b></td><td>${o.customer}</td><td>${o.lines}</td>
      <td class="num">${fmt(o.incl)}</td>
      <td><span class="badge ${o.status === "已发货" ? "b-green" : o.status === "备货" ? "b-blue" : "b-amber"}">${o.status}</span></td>
    </tr>`).join("");
    const body = `
      <div class="sec-h" style="margin-top:2px"><h3>分销客户</h3><span class="sh-sub">B2B 批发 CRM · 含税价（WET/GST）· 账期</span>
        <div class="sh-r"><button class="btn sm gold" data-act="chat" data-msg="给 Dan Murphy's 起草一份 Shiraz 2021 的报价单，含 WET 与 GST 含税价">${icon(T.I.customer, 14)} 起草报价单</button></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>客户</th><th>层级</th><th>账期</th><th>YTD 销售</th><th>未回款</th><th>状态</th></tr></thead>
        <tbody>${cust}</tbody></table></div>
      <div class="sec-h"><h3>销售订单</h3><span class="sh-sub">报价 → 订单 → 发货 → 回款</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>订单号</th><th>客户</th><th>行项</th><th>含税额</th><th>状态</th></tr></thead>
        <tbody>${so}</tbody></table></div>`;
    return { title: "客户与分销", sub: "B2B 批发 CRM：报价 → 订单 → 发货 → 回款", body };
  }

  /* ══════════════════ M8 财务对账 ══════════════════ */
  function m8() {
    const rows = T.reconMatches.map((r) => `<tr>
      <td><b>${r.item}</b></td><td class="num">${r.amount}</td>
      <td>${r.match}</td><td>${r.conf ? conf(r.conf) : '<span class="badge b-red">无候选</span>'}</td>
      <td>${r.status === "已匹配" ? '<span class="badge b-green">已匹配</span>' : r.status === "未达" ? '<span class="badge b-red">未达账项</span>' : '<span class="badge b-amber">待确认</span>'}</td>
    </tr>`).join("");
    const body = `
      <div class="grid g4">
        <div class="card kpi acc-green"><div class="kv">$1.14M</div><div class="kl">本月收入</div></div>
        <div class="card kpi acc-blue"><div class="kv">$0.78M</div><div class="kl">本月采购/成本</div></div>
        <div class="card kpi acc-purple"><div class="kv">4</div><div class="kl">未达账项</div></div>
        <div class="card kpi acc-amber"><div class="kv">$31.1K</div><div class="kl">Q3 进口税费(WET+GST)</div></div>
      </div>
      <div class="sec-h"><h3>三方单据匹配</h3><span class="sh-sub">采购 / 物流 / 分销 · 复式账本 · AI 给候选匹配</span>
        <div class="sh-r"><button class="btn sm gold" data-act="chat" data-msg="对未达账项『报关行费 BRK-0621 $420』给出候选匹配与理由">${icon(T.I.finance, 14)} AI 辅助对账</button></div></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>单据</th><th>金额</th><th>候选匹配</th><th>置信度</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="note info">BAS/季度税草稿汇总与工资 STP 申报走外接，系统只做核算与结构化，不自建直连 ATO。</div>`;
    return { title: "财务对账", sub: "自研复式账本 · 三方匹配 · 申报外接", body };
  }

  /* ══════════════════ M9 合规中心 ══════════════════ */
  function m9() {
    const rows = T.compliance.map((c) => `<tr class="${c.ok ? "" : ""}">
      <td><b>货柜 ${c.container}</b></td>
      <td style="font-size:11.5px">${c.wet}</td>
      <td style="font-size:11.5px">${c.gst}</td>
      <td style="font-size:11.5px">${c.fsanz.includes("缺") ? `<span style="color:var(--red)">${c.fsanz}</span>` : c.fsanz}</td>
      <td style="font-size:11.5px">${c.biosecurity}</td>
      <td>${c.ok ? '<span class="sdot" style="color:var(--green)">可放行</span>' : `<span class="sdot" style="color:var(--red)">${c.release}</span>`}</td>
    </tr>`).join("");
    const body = `
      <div class="card pad"><div class="sec-h" style="margin-top:0"><h3>WET / GST 计算器</h3><span class="sh-sub">单点真相 · 与 M4 报关、M7 开票共用同一函数</span></div>
        <div class="grid g2">
          <div>
            <div class="field-row"><span class="fk">完税价格（CIF, AUD）</span><span class="fv">$74,304.00</span></div>
            <div class="field-row"><span class="fk">进口关税（ChAFTA 0%）</span><span class="fv" style="color:var(--green)">$0.00</span></div>
            <div class="field-row"><span class="fk">WET 29%（葡萄酒均衡税）</span><span class="fv" style="color:var(--amber)">$21,548.16</span></div>
            <div class="field-row"><span class="fk">进口 GST 10%（含 WET 价上）</span><span class="fv" style="color:var(--blue)">$9,585.22</span></div>
            <div class="field-row"><span class="fk" style="color:var(--gold2);font-weight:700">进口环节应缴税费合计</span><span class="fv" style="color:var(--gold2)">$31,133.38</span></div>
          </div>
          <div class="note gold" style="margin:0"><b>计算链：</b>CIF 74,304 → WET = 74,304 × 29% = 21,548.16 → GST 基 = (CIF + WET) × 10% = 9,585.22。<br><br>这三处数字（报关单 / 合规台账 / 客户发票）由同一函数产出，杜绝"三处算出三个数"。</div>
        </div></div>
      <div class="sec-h"><h3>逐柜合规台账 · 缺证拦发货</h3><span class="sh-sub">WET / GST / TGA / FSANZ / Biosecurity</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>货柜</th><th>WET</th><th>GST</th><th>FSANZ 标签</th><th>Biosecurity</th><th>放行状态</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    return { title: "合规中心", sub: "WET / GST / TGA / FSANZ / Biosecurity · 缺证拦发货", body };
  }

  /* ══════════════════ M10 工作流自动化 ══════════════════ */
  function m10() {
    const rows = T.workflows.map((w) => `<div class="card tight" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <b style="flex:1;min-width:0">${w.name}</b>
        <span class="badge ${w.state === "完成" ? "b-green" : w.state === "挂起" ? "b-amber" : "b-blue"}">${w.state}</span>
        <span style="font-size:10.5px;color:var(--ink4)" class="mono">${w.updated}</span></div>
      <div style="font-size:12px;color:var(--ink3);margin-top:6px">当前步骤：${w.step}</div>
      <div style="height:5px;border-radius:3px;background:var(--glass);margin-top:9px;overflow:hidden">
        <div style="height:100%;width:${w.pct}%;border-radius:3px;background:${w.state === "完成" ? "var(--green)" : "var(--gold2)"}"></div></div>
    </div>`).join("");
    const body = `
      <div class="note info" style="margin-top:2px"><b>编排心脏：</b>触发 → 动作 → 等待 → 分支；可挂起/恢复（每步落盘，供应商 3 天后回信不丢）；审批 / 重试 / 幂等。复用底座 automation / workflows。</div>
      <div class="sec-h"><h3>流程运行清单</h3><span class="sh-sub">跨模块长流程 · 定时采集 / 报关触发 / 建联挂起 / 临期预警</span></div>
      ${rows}`;
    return { title: "工作流 / 自动化", sub: "编排心脏 · 长流程可挂起 / 恢复", body };
  }

  /* ══════════════════ M11 知识库 ══════════════════ */
  function m11() {
    const rows = T.kbEntries.map((e) => `<div class="card tight" style="margin-bottom:9px;display:flex;align-items:center;gap:11px">
      <span style="width:30px;height:30px;border-radius:8px;background:var(--goldsoft);display:flex;align-items:center;justify-content:center;color:var(--gold2);flex-shrink:0">${icon(T.I.kb, 16)}</span>
      <div style="flex:1;min-width:0"><b>${e.title}</b></div>
      <span class="badge b-gray">${e.tag}</span>
      <span style="font-size:11px;color:var(--ink4)" class="mono">${e.links} 双链</span></div>`).join("");
    const body = `
      <div class="note gold" style="margin-top:2px"><b>Agent 的记忆：</b>外贸专属知识沉淀进 PolarisKB（合规要件 / HS 归类规则 / 税则 / ChAFTA / 产区名录 / 开发信话术）。每次 Agent 调用 <code>useKb:true</code> 检索增强。20TB 级混合检索（向量+关键词+双链图谱）。</div>
      <div class="sec-h"><h3>知识条目</h3><span class="sh-sub">${T.kbEntries.length} 篇 · 拖拽任意格式入库 · 双链 [[wiki]]</span>
        <div class="sh-r"><button class="btn sm" data-act="chat" data-msg="用知识库检索 HS 2204.21 葡萄酒归类规则并解释 ChAFTA 优惠条件">检索问答</button></div></div>
      ${rows}`;
    return { title: "知识库 llmwiki", sub: "合规要件 / HS 规则 / 产区 / 话术 — Agent 的记忆", body };
  }

  const views = { m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11 };

  /* ══════════════════ 抽屉：M4 报关单 ══════════════════ */
  function drawerM4(d) {
    const tabs = [
      { k: "elements", label: "申报要素" }, { k: "hs", label: "HS 归类" },
      { k: "tax", label: "税费测算" }, { k: "check", label: "三单校验" }, { k: "export", label: "导出与回执" },
    ];
    function body(tab) {
      if (tab === "elements") {
        const fr = (k, v, edited) => `<div class="field-row"><span class="fk">${k}</span><span class="fv">${edited ? '<span class="edit-dot" title="可改"></span>' : ""}${v}</span></div>`;
        return `<div class="note info">报关要素自动填充率 <b>${d.fillRate}%</b>，蓝点为可人工改字段。缺项：${d.coCertNo ? "无" : "原产地证编号"}。</div>
          <div class="card pad">
          ${fr("报关类型", d.type === "import" ? "进口 N10 Import Declaration" : "出口数据表")}
          ${fr("成交方式", d.terms, true)}
          ${fr("币种", d.currency)}
          ${fr("FOB 货值", fmt(d.fob), true)}
          ${fr("运费", fmt(d.freight), true)}
          ${fr("保费", fmt(d.insurance), true)}
          ${fr("完税价格 CIF", `<b style="color:var(--gold2)">${fmt(d.cif)}</b>`)}
          ${fr("原产国 / 启运国", d.origin + " / " + d.dispatch)}
          ${fr("目的港", d.destPort)}
          ${fr("提单号 / 货柜号", d.bl + " / " + d.container)}
          ${fr("件数 / 毛重 / 净重", `${d.packages} ctn / ${d.grossWt} kg / ${d.netWt} kg`)}
          ${fr("原产地证编号", d.coCertNo ? d.coCertNo : '<span style="color:var(--amber)">待补缺 ⚠</span>', true)}
          </div>`;
      }
      if (tab === "hs") {
        const lines = d.lines.map((l) => `<div class="card pad" style="margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><b>${l.desc}</b><span class="badge b-gray">${l.sku}</span></div>
          <div class="field-row"><span class="fk">建议 HS 编码（10 位）</span><span class="fv">${l.hs ? `<code>${l.hs}</code>` : '<span style="color:var(--red)">缺归类 ✕</span>'} ${l.hs ? conf(l.hsConf) : ""}</span></div>
          <div class="field-row"><span class="fk">法定计量单位</span><span class="fv">${l.uom} ${conf(l.uomConf)}</span></div>
          <div class="field-row"><span class="fk">关税优惠</span><span class="fv">${l.dutyRate} ${l.dutyConf ? conf(l.dutyConf) : ""}</span></div>
          <div class="field-row"><span class="fk">数量 / 单价 / 金额</span><span class="fv">${l.qty.toLocaleString()} × ${fmt(l.unit)} = ${fmt(l.amount)}</span></div>
        </div>`).join("");
        const note = d.lines[0].hs
          ? `<div class="note ok">依据：含酒精葡萄发酵、容器 ≤2L → 归 <code>2204.21</code>；ChAFTA 协定优惠待原产地证编号补全后生效（故 ${d.lines[0].dutyConf}% 转人工补缺）。</div>`
          : `<div class="note warn"><b>缺 HS 归类：</b>点下方按钮让 Claude 结合 llmwiki 税则给出 10 位编码 + 依据 + 置信度，&lt;85% 转人工。</div>
             <button class="btn gold sm" data-act="chat" data-msg="为货柜 ${d.id} 的 Chardonnay 2023 做 HS 归类，给 10 位编码+依据+置信度">${icon(T.I.customs, 14)} AI 归类</button>`;
        return lines + note;
      }
      if (tab === "tax") {
        const gstBase = d.cif + d.wet;
        return `<div class="card pad">
          <div class="field-row"><span class="fk">完税价格（CIF, ${d.currency}）</span><span class="fv">${fmt(d.cif)}</span></div>
          <div class="field-row"><span class="fk">进口关税（${d.agreement} ${d.duty === 0 ? "0%" : ""}）</span><span class="fv" style="color:var(--green)">${fmt(d.duty)}</span></div>
          <div class="field-row"><span class="fk">WET 29%（葡萄酒均衡税）</span><span class="fv" style="color:var(--amber)">${fmt(d.wet)}</span></div>
          <div class="field-row"><span class="fk">进口 GST 10%（含 WET 价 ${fmt(gstBase)} 上）</span><span class="fv" style="color:var(--blue)">${fmt(d.gst)}</span></div>
          <div class="field-row"><span class="fk" style="color:var(--gold2);font-weight:700">进口环节应缴税费合计</span><span class="fv" style="color:var(--gold2);font-size:15px">${fmt(d.duty + d.wet + d.gst)}</span></div>
          </div>
          <div class="note gold"><b>单点真相：</b>此处 WET/GST 与合规中心计算器、与给客户的发票口径<b>共用同一函数</b>，逐分位一致，杜绝三处算出三个数。</div>`;
      }
      if (tab === "check") {
        const rows = d.checks.map((c) => `<div class="checkrow">${checkIcon[c.severity]}
          <div class="cc"><div class="cl"><b>${c.field}</b> · 报关 "${c.decl}" ${c.severity === "pass" ? "＝ 发票 ＝ 装箱单" : ""}</div>
          ${c.note ? `<div class="cd" style="color:${c.severity === "hard" ? "var(--red)" : "var(--amber)"}">${c.note}</div>` : `<div class="cd">发票 ${c.inv} · 装箱单 ${c.pack} · 提单 ${c.bl}</div>`}</div></div>`).join("");
        const hard = d.checks.some((c) => c.severity === "hard");
        return `<div class="card pad">${rows}</div>
          ${hard ? '<div class="note warn"><b>存在硬差异（金额/数量/品名）：100% 拦截，不可导出。</b>请先修正发票/报关金额一致后再导出。</div>'
            : '<div class="note ok"><b>无硬差异，允许导出。</b>软差异（如毛重 20kg）需人工确认一次。</div>'}`;
      }
      if (tab === "export") {
        return `<div class="card pad">
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            <button class="btn ${d.checkStatus === "hard" ? "" : "gold"}" ${d.checkStatus === "hard" ? "disabled" : ""} data-act="toast" data-msg="报关单 PDF 已生成到本地工作文件夹">导出报关单 PDF</button>
            <button class="btn ghost" ${d.checkStatus === "hard" ? "disabled" : ""} data-act="toast" data-msg="EDI/CSV 报文已导出">导出 EDI / CSV 报文</button>
            <button class="btn ghost" ${d.checkStatus === "hard" ? "disabled" : ""} data-act="toast" data-msg="已通过邮件发送给报关行，工作流挂起等回执">邮件交报关行</button>
          </div>
          ${d.checkStatus === "hard" ? '<div class="note warn">存在硬差异，导出被拦截。</div>' : ""}
          <div class="sec-h" style="margin-top:6px"><h3 style="font-size:13px">报关工作流</h3></div>
          <div class="steps">${T.customsFlow.map((s) => `<div class="step ${s.state}"><div class="sn">${s.state === "done" ? "✓" : s.n}</div><div class="st">${s.title}${s.gate ? '<span class="gatebadge">闸</span>' : ""}</div><div class="sd">${s.desc}</div></div>`).join("")}</div>
          </div>
          <div class="note info">回执回写：报关行回传『放行 / 查验 / 补料』→ 工作流恢复 → 写回报关单状态 → 推进物流『到港清关』里程碑；缺证则联动合规中心拦发货。</div>`;
      }
    }
    return {
      title: `货柜 ${d.id} · ${d.goods}`,
      sub: `${d.po} · ${d.supplier} · ${d.terms} · 完税价 ${fmt(d.cif)}`,
      tabs, body,
      foot: `<span class="gate">${icon(T.I.compliance, 13)} 人工闸：确认归类与差异后方可导出</span>
             <button class="btn ghost sm" data-act="chat" data-msg="解释货柜 ${d.id} 报关单的三单校验结果和税费构成">问 AI</button>
             <button class="btn gold sm" ${d.checkStatus === "hard" ? "disabled" : ""} data-act="toast" data-msg="货柜 ${d.id} 报关草稿已确认，可导出交报关行">确认并导出</button>`,
    };
  }

  /* ══════════════════ 抽屉：M2 建联 ══════════════════ */
  function drawerM2(l) {
    const tabs = [{ k: "profile", label: "线索画像" }, { k: "mail", label: "开发信草稿" }, { k: "thread", label: "往来线程" }];
    function body(tab, lang) {
      if (tab === "profile") {
        const fr = Object.entries(l.profile).map(([k, v]) => {
          const c = l.confs[k];
          return `<div class="field-row"><span class="fk">${k}</span><span class="fv">${v}${c ? " " + conf(c) : ""}</span></div>`;
        }).join("");
        return `<div class="card pad">
          ${fr}
          <div class="field-row"><span class="fk" style="color:var(--gold2);font-weight:700">建联优先级</span>
            <span class="fv"><span class="badge ${l.grade === "A" ? "b-gold" : l.grade === "B" ? "b-blue" : "b-gray"}">${l.grade} · ${l.score} 分</span></span></div>
          </div>
          <div class="note ${l.grade === "A" ? "gold" : "info"}">${l.grade === "A" ? "建议本周联系。" : l.grade === "B" ? "可纳入下批建联。" : "关键信息不足或匹配度低，降级处理。"} 画像由 Claude 从官网/录入资料抽取，字段级置信度，&lt;85% 转人工核。</div>`;
      }
      if (tab === "mail") {
        const L = lang || "en";
        const subj = { en: `Partnership inquiry — Organic wines for the Australian market`, es: `Consulta de colaboración — Vinos orgánicos para Australia`, zh: `合作洽询 — 面向澳洲市场的有机葡萄酒` };
        const bodies = {
          en: `Dear ${l.contact},\n\nWe are Orca Imports, a Sydney-based importer & distributor specialising in premium and certified-organic wines for the Australian on- and off-premise market.\n\nWe came across ${l.company} from ${l.region} and were genuinely impressed by your ${l.category.split("/")[0].trim()} and your organic/HACCP credentials — a profile that fits a clear gap in our AU portfolio.\n\nWe'd love to explore importing your range. Could you share:\n  • Your export price list (FOB) and MOQ (we typically start at 1×20' container)\n  • Available certifications & any AU/EU export references\n\nWe're also happy to arrange samples or a short video call at your convenience.\n\nWarm regards,\nLiam Chen\nProcurement · Orca Imports Pty Ltd, Sydney`,
          es: `Estimada ${l.contact},\n\nSomos Orca Imports, importador y distribuidor con sede en Sídney, especializado en vinos premium y orgánicos certificados para el mercado australiano.\n\nConocimos a ${l.company} de ${l.region} y nos impresionó su ${l.category.split("/")[0].trim()} y sus certificaciones orgánicas/HACCP — un perfil que encaja con un hueco claro en nuestra cartera en Australia.\n\nNos encantaría explorar la importación de su gama. ¿Podría compartir su lista de precios de exportación (FOB) y su MOQ? Con gusto coordinamos muestras o una videollamada.\n\nUn cordial saludo,\nLiam Chen · Compras, Orca Imports`,
          zh: `尊敬的 ${l.contact}：\n\n我们是澳鲸进口（Orca Imports），悉尼的进口与分销商，专注为澳洲市场引入优质与有机认证葡萄酒。\n\n我们在 ${l.region} 关注到贵司 ${l.company}，对您的 ${l.category.split("/")[0].trim()} 及有机/HACCP 资质印象深刻——正契合我们澳洲组合中的空缺。\n\n希望洽谈进口合作，能否提供出口报价单（FOB）与起订量（我们通常以 1×20ft 起）？也乐意安排样品或视频会议。\n\n顺祝商祺，\nLiam Chen · 采购 · 澳鲸进口`,
        };
        return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:12px;color:var(--ink3)">语言</span>
          <div class="lang-tabs">
            <button class="lang-tab ${L === "en" ? "on" : ""}" data-lang="en">English</button>
            <button class="lang-tab ${L === "es" ? "on" : ""}" data-lang="es">Español</button>
            <button class="lang-tab ${L === "zh" ? "on" : ""}" data-lang="zh">中文</button>
          </div>
          <button class="btn sm gold" style="margin-left:auto" data-act="chat" data-msg="给 ${l.company} 重写一版更突出我方采购意图和目标价区间的破冰开发信">✎ 让 AI 重写</button>
        </div>
        <div class="mail-meta"><span>收件 <b>${l.email}</b></span><span>会话 <b>conv-${l.id}</b></span><span>语言 <b>${L.toUpperCase()}</b></span></div>
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--ink)">主题：${subj[L]}</div>
        <div class="mail-body">${bodies[L]}</div>
        <div class="note info" style="margin-top:12px">每家信件引用对方真实信息（产区/认证/品类契合点），<b>非模板群发</b>。去重（30 天同 domain）+ 频控 + 首发人工闸生效。</div>`;
      }
      if (tab === "thread") {
        if (!l.thread.length) return `<div class="empty">尚无往来。生成开发信并通过人工闸后，SMTP 发出，引擎挂起等回信。</div>`;
        const msgs = l.thread.map((m) => `<div class="thread-msg ${m.dir}">
          <div class="tm-h"><b>${m.who}</b><span>${m.at}</span></div>${m.text}</div>`).join("");
        const cls = l.replyClass ? { sample: "索样", interested: "有兴趣", quoted: "已报价", decline: "暂不合作", irrelevant: "无关/退订" }[l.replyClass] : null;
        return msgs + (cls ? `<div class="note ok">回信意向分类：<b>${cls}</b>。${l.replyClass === "sample" || l.replyClass === "interested" || l.replyClass === "quoted" ? '可一键<b>转为潜在供应商</b>并进入 ② 供应商公海（标签"新建联"）走既有询价比价流程。' : "退订/无关意向加入抑制名单，不再建联。"}</div>` : "");
      }
    }
    const canConvert = ["sample", "interested", "quoted"].includes(l.replyClass);
    return {
      title: `${l.company}`,
      sub: `${l.country} · ${l.region} · ${l.category}`,
      tabs, body,
      foot: `<span class="gate">${icon(T.I.lead, 13)} 人工闸：挑选 / 首发预览 / 转化</span>
             <button class="btn ghost sm" data-act="chat" data-msg="给 ${l.company} 生成一封个性化破冰开发信">✎ 生成开发信</button>
             <button class="btn ${canConvert ? "gold" : ""} sm" ${canConvert ? "" : "disabled"} data-act="toast" data-msg="${l.company} 已转为潜在供应商，进入供应商公海（标签：新建联）">${canConvert ? "转为供应商" : "待回信"}</button>`,
    };
  }

  function getDrawer(modId, itemId) {
    if (modId === "m4") { const d = T.declarations.find((x) => x.id === itemId); return d ? drawerM4(d) : null; }
    if (modId === "m2") { const l = T.leads.find((x) => x.id === itemId); return l ? drawerM2(l) : null; }
    return null;
  }

  /* ══════════════════ 每模块的对话快捷动作 ══════════════════ */
  const quick = {
    m0: [{ label: "生成今日晨报", msg: "重新生成今日晨报" }, { label: "本月经营亮点", msg: "总结本月经营亮点和三个风险" }, { label: "现金转换周期为何下降", msg: "解释现金转换周期为什么下降了 6 天" }],
    m1: [{ label: "采集智利有机红酒", msg: "按『智利/南非新酒庄·有机红酒』采集一批选品候选并抽结构化字段" }, { label: "评估选品前景", msg: "评估这批候选品在澳洲市场的前景" }],
    m2: [{ label: "给 Viña Aurora 写开发信", msg: "给 A 级线索 Viña Aurora 生成一封个性化破冰开发信" }, { label: "分析漏斗流失", msg: "分析本月建联漏斗在哪个环节流失最严重、如何优化" }, { label: "回信意向分类", msg: "把 Viña Aurora 的最新回信做意向分类" }],
    m3: [{ label: "群发比价询价", msg: "给核心供应商群发一轮 Shiraz 比价询价邮件" }, { label: "抽结构化报价", msg: "把供应商回信抽成结构化报价并标注低置信度字段" }],
    m4: [{ label: "生成 0617 报关草稿", msg: "为货柜 0617 生成报关草稿并做 HS 归类与三单一致校验" }, { label: "0625 缺 HS 归类", msg: "为货柜 0625 的 Chardonnay 2023 做 HS 归类" }, { label: "校验三单一致", msg: "对货柜 0617 做三单一致校验并列出差异" }],
    m5: [{ label: "解析货代里程碑", msg: "解析货代 EDI 邮件里的最新里程碑并更新货柜状态" }, { label: "滞期风险预警", msg: "哪些货柜有滞期风险，给出对策" }],
    m6: [{ label: "智能补货建议", msg: "根据销量+在库+在途+交期，给出智能补货建议并说明理由" }, { label: "临期处理", msg: "Chardonnay 2023 临期批次怎么处理" }],
    m7: [{ label: "起草报价单", msg: "给 Dan Murphy's 起草一份 Shiraz 2021 报价单，含 WET 与 GST 含税价" }, { label: "催收未回款", msg: "起草一封催收 Merivale 未回款的礼貌邮件" }],
    m8: [{ label: "AI 辅助对账", msg: "对未达账项『报关行费 BRK-0621 $420』给出候选匹配与理由" }, { label: "BAS 草稿", msg: "汇总本季度 BAS 税务草稿" }],
    m9: [{ label: "核 0617 合规要件", msg: "核对货柜 0617 应备的合规要件清单" }, { label: "标签合规预检", msg: "对 0625 的英文背标做 FSANZ 合规预检" }],
    m10: [{ label: "查看挂起流程", msg: "有哪些工作流正在挂起等待，分别在等什么" }, { label: "报关触发说明", msg: "报关草稿 ETA-5d 触发是怎么编排的" }],
    m11: [{ label: "查 HS 归类规则", msg: "用知识库检索 HS 2204.21 葡萄酒归类规则并解释 ChAFTA 优惠条件" }, { label: "查 WET 计税口径", msg: "WET 葡萄酒均衡税的计税口径是什么" }],
  };

  /* ══════════════════ 演示版 Claude 应答引擎 ══════════════════
     真实 Tauri 环境走 useAgentRunner.run()/runJson()；此处为浏览器演示用的本地
     上下文应答，能针对当前模块与真实数据给出结构化产物，跑通全链路演示。 */
  function chat(modId, text) {
    const q = text.toLowerCase();
    const has = (...ks) => ks.some((k) => text.includes(k) || q.includes(k.toLowerCase()));

    // 报关草稿
    if (has("报关草稿", "0617") && has("生成", "报关", "校验")) {
      return {
        reply: `已为货柜 <span class="hl">0617 · Shiraz Red Wine 2021</span> 从 PO-2405-11、提单与落地成本凭证聚合出报关草稿，完成 HS 归类、税费测算与三单一致校验。`,
        tools: ["Read PO-2405-11 / 提单 MAEU-6617204", "kb.retrieve『HS 2204.21 归类规则』", "kb.retrieve『ChAFTA 原产地规则』", "compliance.calcWetGst(cif=74304)", "docConsistencyCheck(报关 vs 发票 vs 装箱单 vs 提单)"],
        out: { title: "报关草稿 · 货柜 0617", kv: [["HS 编码", "2204.21.00（94%）"], ["完税价格 CIF", "$74,304.00"], ["WET 29%", "$21,548.16"], ["进口 GST 10%", "$9,585.22"], ["税费合计", "$31,133.38"], ["三单校验", "1 软差异（毛重 20kg）"], ["填充率", "92% · 缺原产地证号"]] },
        tail: `无硬差异，允许导出；毛重差异需人工确认一次。请在抽屉『导出与回执』确认并交报关行。`,
      };
    }
    // HS 归类 0625
    if (has("0625", "Chardonnay", "归类") && has("HS", "归类")) {
      return {
        reply: `结合 llmwiki 澳洲税则给出 <span class="hl">Chardonnay 2023</span> 的 HS 归类建议：`,
        tools: ["kb.retrieve『HS 2204.21 白葡萄酒』", "tariff.lookup(AU)"],
        out: { title: "HS 归类建议 · Chardonnay 2023", kv: [["建议 HS", "2204.21.00"], ["置信度", "91%"], ["法定单位", "升/瓶(750ml)"], ["依据", "静止白葡萄酒 · 容器≤2L"], ["关税", "ChAFTA 0%（需 CO 证）"]] },
        tail: `置信度 91% ≥ 85% 阈值，可采纳；但该柜发票金额存在<span class="hl">硬差异（41,000 vs 40,100）</span>，需先修正才可导出。`,
      };
    }
    // 开发信
    if (has("开发信", "破冰") || (has("Viña Aurora", "Aurora") && has("信"))) {
      const name = has("Kanonkop") ? "Kanonkop Estate" : "Viña Aurora";
      return {
        reply: `已为 <span class="hl">${name}</span> 生成个性化破冰开发信（英/西/中三版），引用了对方真实产区与认证信息，非模板群发。`,
        tools: ["kb.retrieve『破冰开发信话术库』", "lead.profile(" + name + ")", "dedupCheck(30d domain) ✓ 通过", "rateLimitCheck ✓"],
        out: { title: "破冰开发信 · " + name, kv: [["语言", "EN / ES / ZH"], ["主题", "Partnership inquiry — Organic wines"], ["个性化点", "产区 + 有机/HACCP 认证 + 品类契合"], ["CTA", "报价单 / 样品 / 视频会"], ["会话", "conv-" + name] ] },
        tail: `已带 conversationId 便于回信聚合。<b>首封外发前请在抽屉预览确认（人工闸）</b>。`,
      };
    }
    // 晨报
    if (has("晨报")) {
      return {
        reply: `已聚合各模块当日状态，生成今日晨报：`,
        tools: ["聚合 M2/M4/M5/M6/M7/M8/M9 当日状态", "run() 生成自然语言简报"],
        out: { title: "今日晨报 · " + "2026-07-01", kv: [["昨日完成", "0617 三单校验 · Aurora 索样 · SO-3312 发货"], ["今日待办", "★确认 0617 报关导出 · 处理 0625 硬差异+归类"], ["风险预警", "0625 缺背标拦发货 · Chardonnay 临期 · BRK-0621 未达账"]] },
        tail: `建议优先处理 0617 报关（人工闸1）和 0625 硬差异，二者都卡着放行链路。`,
      };
    }
    // 对账
    if (has("对账", "BRK-0621", "未达")) {
      return {
        reply: `对未达账项 <span class="hl">报关行费 BRK-0621 $420</span> 检索候选匹配：`,
        tools: ["ledger.scan(未达)", "match.candidates(BRK-0621)"],
        out: { title: "候选匹配 · BRK-0621", kv: [["候选 1", "货柜 0621 清关 · 相符度 88%"], ["候选 2", "货代杂费池 · 相符度 41%"], ["建议", "归入 0621 清关成本"]] },
        tail: `候选 1 相符度 88%，建议人工确认后计入 0621 落地成本。`,
      };
    }
    // 补货
    if (has("补货")) {
      return {
        reply: `读取销量、在库、在途与交期，给出智能补货建议（数值本地算，AI 只做解释）：`,
        tools: ["stock.ledger", "sales.velocity(30d)", "shipment.inTransit"],
        out: { title: "补货建议", kv: [["Shiraz 2021", "补 3,600 瓶 · 07-20 前"], ["Chardonnay 2023", "补 2,400 瓶 · 本周（临期+低库存）"]] },
        tail: `Shiraz 日均销 118 瓶、在途 1 柜、交期 45 天，安全库存告警；Chardonnay 现货仅 640 且 2025-11 临期。`,
      };
    }
    // 报价单
    if (has("报价单", "报价") && has("Dan Murphy", "报价单")) {
      return {
        reply: `已为 <span class="hl">Dan Murphy's</span> 起草 Shiraz 2021 报价单，含税价与合规中心同一函数取数：`,
        tools: ["compliance.calcWetGst", "quote.build(SKU-SHRZ-21)"],
        out: { title: "报价单 · Shiraz 2021", kv: [["数量", "1,200 瓶"], ["不含税单价", "AUD 27.50"], ["WET+GST 含税", "AUD 39,600"], ["账期", "Net 30"]] },
        tail: `含税价与报关单、合规台账口径逐分位一致。可导出 PDF 发客户。`,
      };
    }
    // 漏斗分析
    if (has("漏斗", "流失")) {
      return {
        reply: `本月建联漏斗：线索 124 → 建联 68（55%）→ 回复 19（28%）→ 比价 7（37%）→ 合作 2（29%）。`,
        tools: ["funnel.analyze(本月)"],
        tail: `<b>回复率 28% 是最大瓶颈</b>。建议：① 开发信更聚焦对方产区/认证的具体契合点；② A 级线索优先、缩短首封响应；③ 对已读未回者 5 天后跟进一封。`,
      };
    }
    // 知识库检索
    if (has("知识库", "检索", "HS 2204", "ChAFTA", "WET", "计税口径", "归类规则")) {
      return {
        reply: `检索 llmwiki（向量+关键词+双链）命中相关条目：`,
        tools: ["kb.retrieve『HS 2204.21』", "kb.retrieve『ChAFTA 原产地规则』", "kb.retrieve『WET 计税口径』"],
        out: { title: "检索结果", kv: [["HS 2204.21", "葡萄酒(≤2L 容器)，含酒精葡萄发酵"], ["ChAFTA", "符合原产地规则 → 协定税率 0%（需 CO 证）"], ["WET", "完税价 × 29%；GST 基 = (CIF+WET)×10%"]] },
        tail: `以上规则可追溯到知识库原文，每次 Agent 调用以 useKb:true 注入。`,
      };
    }

    // 默认：结合模块上下文
    const mod = T.MODULES.find((m) => m.id === modId);
    return {
      reply: `收到。当前在<span class="hl">「${mod ? mod.name : "工作台"}」</span>模块。我可以：结合 llmwiki 检索、抽结构化数据（runJson + schema 校验 + 字段置信度）、生成邮件/单证草稿，关键动作前都会经人工闸。试试下方快捷操作，或直接描述你要做的事。`,
      tools: null,
    };
  }

  return { views, getDrawer, quick, chat, _fmt: fmt };
})();
