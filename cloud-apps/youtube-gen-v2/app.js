(function () {
  "use strict";

  const STORAGE_KEY = "jonmac_youtube_gen_v2_projects_v1";
  const TREND_STORAGE_KEY = "jonmac_youtube_gen_v2_live_trends_v1";
  const templates = window.YT_V2_TEMPLATES || [];
  let allRows = loadTrendRows();
  const app = document.getElementById("app");
  const toastRoot = document.getElementById("toast-root");
  const steps = ["plan", "script", "record", "edit", "publish"];
  const stepLabels = {
    plan: ["Plan", "Angle + packaging"],
    script: ["Script", "2,500-word draft"],
    record: ["Record", "A-roll + assets"],
    edit: ["Auto edit", "Cuts + graphics"],
    publish: ["Publish", "Private by default"],
  };
  const demoAssets = [
    { name: "JonMac_A-Roll_take-03.mp4", size: "2.4 GB", type: "A-roll" },
    { name: "model-demo-screen.mp4", size: "188 MB", type: "Screen recording" },
    { name: "ugc-results.zip", size: "34 MB", type: "Generated outputs" },
  ];

  const state = {
    view: "discover",
    search: "",
    date: "all",
    duration: "all",
    minViews: 0,
    onlyOutliers: false,
    metric: "views",
    templateFilter: "all",
    refreshing: false,
    lastRefreshed: null,
    refreshError: "",
    refreshSummary: "",
    drawerSourceId: null,
    drawerTemplateId: null,
    draftAudience: "TikTok Shop brands and affiliates",
    draftProduct: "",
    draftOffer: "Create and scale winning AI UGC with ViralView",
    projects: loadProjects(),
    activeProjectId: null,
    activeStep: "plan",
    renderTimer: null,
    uploadTimer: null,
  };

  function loadProjects() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  function loadTrendRows() {
    const bundled = (window.OUTLIER_ROWS || []).filter((row) => row && row.id && row.title);
    try {
      const saved = JSON.parse(localStorage.getItem(TREND_STORAGE_KEY));
      if (Array.isArray(saved?.rows) && saved.rows.length) return saved.rows.filter((row) => row && row.id && row.title);
    } catch (_) {}
    return bundled;
  }

  function saveProjects() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name) {
    const paths = {
      spark: '<path d="M12 2l1.5 5L18 9l-4.5 2L12 16l-1.5-5L6 9l4.5-2L12 2Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
      discover: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/><path d="m11 7 1.4 2.6L15 11l-2.6 1.4L11 15l-1.4-2.6L7 11l2.6-1.4L11 7Z"/>',
      pipeline: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      external: '<path d="M14 4h6v6"/><path d="m10 14 10-10"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
      bolt: '<path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>',
      compare: '<path d="M7 7h12l-3-3"/><path d="m19 7-3 3"/><path d="M17 17H5l3 3"/><path d="m5 17 3-3"/>',
      layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
      build: '<path d="M3 20h18"/><path d="M5 20V8l7-5 7 5v12"/><path d="M9 20v-7h6v7"/>',
      affiliate: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="m9 9 6 6"/><path d="M17 4v6M14 7h6"/>',
      flask: '<path d="M9 2h6M10 2v6l-6 10a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 8V2"/><path d="M7 15h10"/>',
      video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/>',
      upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
      file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
      play: '<path d="m9 7 8 5-8 5V7Z"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      x: '<path d="M6 6l12 12M18 6 6 18"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
  }

  function formatNumber(n) {
    return Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n || 0);
  }

  function formatDuration(seconds) {
    const total = Number(seconds) || 0;
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function actualAgeDays(row) {
    const raw = String(row.upload_date || "");
    if (!/^\d{8}$/.test(raw)) return null;
    const published = Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.floor((today - published) / 86400000));
  }

  function formatVideoAge(row) {
    const days = actualAgeDays(row);
    if (days == null) return "Date unavailable";
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return `${days}d ago`;
    if (days < 365) {
      const months = Math.max(1, Math.round(days / 30.44));
      return `${months}mo ago`;
    }
    const years = Math.max(1, Math.floor(days / 365.25));
    return `${years}y ago`;
  }

  function getTemplate(id) {
    return templates.find((item) => item.id === id) || templates[0];
  }

  function recommendTemplate(row) {
    const title = ` ${row.title.toLowerCase()} `;
    let best = templates[0];
    let bestScore = -1;
    templates.forEach((template) => {
      const score = template.match.reduce((sum, word) => sum + (title.includes(word) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = template;
      }
    });
    return best;
  }

  function rowMetric(row) {
    if (state.metric === "velocity") return Number(row.views_per_day_vs_median || 0);
    if (state.metric === "combined") return Number(row.outlier_score || 0);
    return Number(row.views_vs_median || 0);
  }

  function metricLabel() {
    return state.metric === "velocity" ? "velocity" : state.metric === "combined" ? "combined" : "views";
  }

  function relevantRows() {
    const terms = ["ai", "ugc", "ad", "video", "image", "tiktok", "affiliate", "brand", "model", "sora", "kling", "seedance", "veo", "claude", "chatgpt", "viral", "content"];
    let rows = allRows.filter((row) => terms.some((term) => row.title.toLowerCase().includes(term)));
    if (state.search.trim()) {
      const query = state.search.toLowerCase();
      rows = rows.filter((row) => `${row.title} ${row.channel}`.toLowerCase().includes(query));
    }
    if (state.date !== "all") rows = rows.filter((row) => {
      const age = actualAgeDays(row);
      return age != null && age <= Number(state.date);
    });
    if (state.duration === "short") rows = rows.filter((row) => Number(row.duration_seconds || 0) < 15 * 60);
    if (state.duration === "medium") rows = rows.filter((row) => Number(row.duration_seconds || 0) >= 15 * 60 && Number(row.duration_seconds || 0) < 30 * 60);
    if (state.duration === "long") rows = rows.filter((row) => Number(row.duration_seconds || 0) >= 30 * 60);
    if (state.minViews) rows = rows.filter((row) => Number(row.views || 0) >= state.minViews);
    if (state.onlyOutliers) rows = rows.filter((row) => rowMetric(row) >= 3);
    if (state.templateFilter !== "all") rows = rows.filter((row) => recommendTemplate(row).id === state.templateFilter);
    rows.sort((a, b) => rowMetric(b) - rowMetric(a) || Number(b.views || 0) - Number(a.views || 0));
    return rows.slice(0, 24);
  }

  async function refreshDataset() {
    if (state.refreshing) return;
    state.refreshing = true;
    state.refreshError = "";
    state.refreshSummary = "Contacting the live YouTube refresh service…";
    render();
    try {
      const response = await fetch("/yt/api/channels/refresh", {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const contentType = response.headers.get("content-type") || "";
      if (response.redirected || !contentType.includes("application/json")) {
        throw new Error("Your YouTube refresh session has expired. Open /yt, sign in, then return here and retry.");
      }
      const payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.rows)) {
        throw new Error(payload.error || `Live refresh failed (${response.status})`);
      }
      allRows = payload.rows.filter((row) => row && row.id && row.title);
      const refreshedAt = payload.generatedAt || new Date().toISOString();
      localStorage.setItem(TREND_STORAGE_KEY, JSON.stringify({ generatedAt: refreshedAt, rows: allRows }));
      state.refreshing = false;
      state.lastRefreshed = new Date(refreshedAt);
      const refreshedChannels = Array.isArray(payload.refreshed) ? payload.refreshed.length : 0;
      state.refreshSummary = `${refreshedChannels || "All"} channels synced · ${allRows.length} current videos`;
      render();
      toast(`Live YouTube data synced · ${allRows.length} videos loaded`);
    } catch (error) {
      state.refreshing = false;
      state.refreshError = error.message || "Live YouTube refresh failed.";
      state.refreshSummary = "No data was changed.";
      render();
      toast(state.refreshError);
    }
  }

  function activeProject() {
    return state.projects.find((project) => project.id === state.activeProjectId);
  }

  function stageIndex(project) {
    return Math.max(0, steps.indexOf(project.stage));
  }

  function wordCount(text) {
    return (String(text || "").trim().match(/\S+/g) || []).length;
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }

  function generateTitles(row, template, product) {
    const subject = row.title.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    const tool = (subject.match(/(?:Seedance|Kling|Sora|Veo|Claude|ChatGPT|Higgsfield|Runway|Nano Banana)[^:|–-]*/i) || ["This AI Workflow"])[0].trim();
    const productName = product || "a TikTok Shop product";
    const variants = {
      trend_to_revenue: [`I Tested ${tool} for TikTok Shop Ads — Here’s What Happened`, `${tool} Just Changed AI UGC (Real Product Test)`, `The New AI Video Model Every TikTok Shop Brand Should Test`],
      model_battle: [`${tool} vs the Competition: Which Makes Better AI UGC?`, `I Tested 3 AI Video Models on the Same TikTok Shop Product`, `The Best AI UGC Generator? A Real Side-by-Side Test`],
      winner_teardown: [`Why This AI UGC Ad Works (Full Breakdown)`, `I Reverse-Engineered a Winning TikTok Shop Video`, `The 6 Beats Behind High-Converting UGC Ads`],
      brand_build: [`I Built a Complete AI UGC Campaign for ${productName}`, `From Product Page to 10 TikTok Ads with AI`, `Build a TikTok Shop Creative System with Me`],
      affiliate_factory: [`How TikTok Shop Affiliates Can Make 30 Videos a Week with AI`, `My AI UGC System for TikTok Shop Affiliates`, `Turn One Product Into 20 Affiliate Videos`],
      experiment_case_study: [`I Tested AI UGC for 7 Days — The Results Surprised Me`, `Human UGC vs AI UGC: A Real Performance Test`, `Can AI UGC Actually Sell ${productName}?`],
    };
    return variants[template.id] || [subject];
  }

  function generateScript(project) {
    const template = getTemplate(project.templateId);
    const title = project.titleOptions[project.selectedTitleIndex] || project.source.title;
    const audience = project.audience || "TikTok Shop brands and affiliates";
    const product = project.product || "the featured product";
    const offer = project.offer || "create and scale AI UGC with ViralView";
    const lines = [
      `# ${title}`,
      "",
      `[SHOW FINISHED RESULT — 0:00]`,
      `This looks like a creator shot it, but it was generated with AI. Today I’m taking the trend behind “${project.source.title}” and testing whether it can produce UGC that actually helps ${audience} sell ${product}.`,
      "",
      `The important part is not the novelty. It is whether the hook stops the scroll, the product remains believable, and the workflow can create enough distinct angles to find a winner. We’ll build it, score it, and turn the result into a repeatable campaign inside ViralView.`,
      "",
    ];
    template.sections.forEach(([section, budget], index) => {
      lines.push(`## ${index + 1}. ${section.toUpperCase()} — TARGET ${budget} WORDS`);
      if (index === 0) {
        lines.push(`Open on the strongest result before explaining the tool. State the commercial question in one sentence: can this workflow create a video a real shopper would trust? Keep the setup moving and promise a clear verdict.`);
      } else if (/demonstration|build|workflow|model a|model b|remix/i.test(section)) {
        lines.push(`[SCREEN RECORDING — ${section}]`);
        lines.push(`Walk through the exact input, product positioning, prompt choices, and output. Explain what you are changing and why. Show the first imperfect attempt, identify the failure, and make one focused revision so the audience sees a usable process rather than a magic trick.`);
      } else if (/viralview/i.test(section)) {
        lines.push(`[VIRALVIEW DEMO START]`);
        lines.push(`Bring the winning angle into ViralView. Show how the source inspiration becomes an original brief, how variants are organized, and how the team can move from idea to a queue of fresh AI UGC without copying the reference. Tie this directly to the viewer’s bottleneck.`);
      } else if (/call to action/i.test(section)) {
        lines.push(`[CTA LOWER THIRD]`);
        lines.push(`If you want to ${offer}, try ViralView at viralview.io. Use this exact framework on one product, generate three genuinely different angles, and let the audience response tell you what to scale.`);
      } else {
        lines.push(`Explain this section with one concrete example from ${product}. Separate what looked impressive from what would influence a purchase. Use specific evidence: hook clarity, product visibility, natural motion, voice credibility, pacing, proof, and strength of the call to action.`);
      }
      lines.push("");
    });
    lines.push("## EDITOR NOTES", "Use jump cuts only to remove dead air. Add clean captions, restrained punch-ins, product screenshots, and scorecard graphics. Preserve a practical, evidence-first tone. Never imply the source video or creator endorses this remake.");
    return lines.join("\n");
  }

  function nav() {
    const active = state.activeProjectId ? "pipeline" : state.view;
    return `
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">${icon("spark")}</div><div class="brand-copy"><strong>Jon Mac Business</strong><span>YouTube Production OS</span></div><b class="v2-pill">V2</b></div>
        <div class="nav-label">Workspace</div>
        <button class="nav-button ${active === "discover" ? "active" : ""}" data-nav="discover">${icon("discover")}<span>Discover</span></button>
        <button class="nav-button ${active === "pipeline" ? "active" : ""}" data-nav="pipeline">${icon("pipeline")}<span>Production pipeline</span><b class="nav-badge">${state.projects.length}</b></button>
        <div class="nav-label">System</div>
        <button class="nav-button ${active === "settings" ? "active" : ""}" data-nav="settings">${icon("settings")}<span>Templates & integrations</span></button>
        <div class="sidebar-foot"><div class="account"><div class="avatar">JM</div><div><strong>Jon Mac</strong><span>Prototype workspace</span></div></div></div>
      </aside>`;
  }

  function layout(content, title, sub) {
    return `<div class="shell">${nav()}<main class="main"><header class="topbar"><div class="crumb"><strong>YouTube Gen V2</strong><span>/</span><span>${esc(title)}</span></div><div class="top-actions"><div class="status-chip"><i class="status-dot"></i>Prototype saved locally</div><a class="button secondary" href="../youtube-gen/">Open original /yt</a></div></header><div class="content">${content}</div></main></div>`;
  }

  function renderDiscover() {
    const rows = relevantRows();
    const totalViews = rows.reduce((sum, row) => sum + row.views, 0);
    const average = rows.length ? rows.reduce((sum, row) => sum + row.outlier_score, 0) / rows.length : 0;
    const cards = rows.map((row) => {
      const template = recommendTemplate(row);
      return `<article class="video-card" data-video-id="${esc(row.id)}" data-upload-date="${esc(row.upload_date || "")}" data-age-days="${actualAgeDays(row) == null ? "" : actualAgeDays(row)}" data-duration-seconds="${Number(row.duration_seconds || 0)}" data-views="${Number(row.views || 0)}" data-metric="${rowMetric(row)}">
        <a class="thumb" data-source-thumbnail href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${esc(row.title)} on YouTube"><img src="${esc(row.thumbnail)}" alt="" loading="lazy"><b class="multiple">${Number(row.outlier_score || 0).toFixed(1)}× outlier</b><span class="duration">${formatDuration(row.duration_seconds)}</span><span class="thumb-open">${icon("play")} Watch on YouTube</span></a>
        <div class="video-body"><h3 class="video-title">${esc(row.title)}</h3><div class="channel-line"><span>${esc(row.channel)}</span><span>${formatVideoAge(row)}</span></div>
        <div class="stats"><div class="stat"><strong>${formatNumber(row.views)}</strong><span>Views</span></div><div class="stat"><strong>${formatNumber(row.views_per_day)}</strong><span>Views/day</span></div><div class="stat"><strong>${rowMetric(row).toFixed(1)}×</strong><span>${metricLabel()}</span></div></div>
        <div class="recommendation" style="--template-color:${template.color}"><i></i>Best fit: ${template.code} ${esc(template.shortName)}</div>
        <div class="card-actions"><button class="primary" data-remake="${esc(row.id)}">Remake with a template</button><a data-source-link href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" title="Watch source video on YouTube" aria-label="Watch source video on YouTube">${icon("external")}</a></div></div>
      </article>`;
    }).join("");
    const content = `
      <div class="page-head"><div><p class="eyebrow">Trend intelligence → original business content</p><h1>Find the signal. Build the video.</h1><p>Use a proven topic as evidence, then rebuild it through one of six original Jon Mac formats. Ranked by performance relative to each channel—not raw views alone.</p></div><button class="secondary" data-nav="pipeline">View production pipeline</button></div>
      <div class="prototype-banner"><strong>Safe V2 preview:</strong> this route has separate local data and does not change the current YouTube Gen app. External AI, rendering, storage, and YouTube actions are simulated until their APIs are connected.</div>
      <div class="metric-strip"><div class="metric-card"><div class="metric-icon">${icon("video")}</div><div><strong>${rows.length}</strong><span>Qualified trend matches</span></div></div><div class="metric-card"><div class="metric-icon">${icon("chart")}</div><div><strong>${average.toFixed(1)}×</strong><span>Average outlier score</span></div></div><div class="metric-card"><div class="metric-icon">${icon("users")}</div><div><strong>${formatNumber(totalViews)}</strong><span>Combined source views</span></div></div><div class="metric-card"><div class="metric-icon">${icon("pipeline")}</div><div><strong>${state.projects.length}</strong><span>V2 projects created</span></div></div></div>
      <div class="toolbar"><label class="search-box">${icon("search")}<input id="trend-search" value="${esc(state.search)}" placeholder="Search AI models, TikTok Shop, affiliates, UGC…"></label><button class="secondary refresh-button ${state.refreshing ? "refreshing" : ""}" data-refresh ${state.refreshing ? "disabled" : ""}>${icon("spark")} ${state.refreshing ? "Syncing YouTube…" : "Sync live YouTube"}</button></div>
      ${state.refreshError ? `<div class="refresh-message error"><strong>Live refresh failed</strong><span>${esc(state.refreshError)}</span></div>` : state.refreshSummary ? `<div class="refresh-message ${state.refreshing ? "working" : "success"}"><strong>${state.refreshing ? "Refreshing current videos" : "Live data updated"}</strong><span>${esc(state.refreshSummary)}</span></div>` : ""}
      <div class="filter-panel" aria-label="Discovery filters">
        <label><span>Date</span><select id="date-filter"><option value="all">All time</option><option value="1" ${state.date === "1" ? "selected" : ""}>Last 1 day</option><option value="3" ${state.date === "3" ? "selected" : ""}>Last 3 days</option><option value="7" ${state.date === "7" ? "selected" : ""}>Last 7 days</option><option value="30" ${state.date === "30" ? "selected" : ""}>Last 30 days</option><option value="90" ${state.date === "90" ? "selected" : ""}>Last 90 days</option></select></label>
        <label><span>Duration</span><select id="duration-filter"><option value="all">Any duration</option><option value="short" ${state.duration === "short" ? "selected" : ""}>Under 15 min</option><option value="medium" ${state.duration === "medium" ? "selected" : ""}>15–30 min</option><option value="long" ${state.duration === "long" ? "selected" : ""}>30+ min</option></select></label>
        <label><span>Min views</span><select id="views-filter"><option value="0">Any</option><option value="10000" ${state.minViews === 10000 ? "selected" : ""}>10K+</option><option value="50000" ${state.minViews === 50000 ? "selected" : ""}>50K+</option><option value="100000" ${state.minViews === 100000 ? "selected" : ""}>100K+</option><option value="250000" ${state.minViews === 250000 ? "selected" : ""}>250K+</option></select></label>
        <label class="filter-checkbox"><input id="outliers-filter" type="checkbox" ${state.onlyOutliers ? "checked" : ""}><span>Only outliers (3×+)</span></label>
        <label><span>Metric</span><select id="metric-filter"><option value="views">Views multiple</option><option value="velocity" ${state.metric === "velocity" ? "selected" : ""}>Velocity multiple</option><option value="combined" ${state.metric === "combined" ? "selected" : ""}>Combined score</option></select></label>
        <div class="filter-result"><strong>${rows.length}</strong><span>showing${state.lastRefreshed ? ` · refreshed ${state.lastRefreshed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span></div>
      </div>
      <div class="template-filter"><button class="filter-chip ${state.templateFilter === "all" ? "active" : ""}" data-template-filter="all">All formats</button>${templates.map((template) => `<button class="filter-chip ${state.templateFilter === template.id ? "active" : ""}" data-template-filter="${template.id}">${template.code} ${esc(template.shortName)}</button>`).join("")}</div>
      <div style="height:14px"></div><div class="video-grid">${cards || '<div class="empty-state"><strong>No matching trends</strong>Try a broader search or another template.</div>'}</div>`;
    app.innerHTML = layout(content, "Discover");
  }

  function renderPipeline() {
    const groups = [
      ["Planned", state.projects.filter((p) => ["plan", "script"].includes(p.stage))],
      ["Production", state.projects.filter((p) => ["record", "edit"].includes(p.stage) && p.edit.status !== "review")],
      ["Review & publish", state.projects.filter((p) => p.edit.status === "review" || p.stage === "publish")],
    ];
    const projectCard = (project) => {
      const template = getTemplate(project.templateId);
      const progress = project.publish.status === "published" ? 100 : (stageIndex(project) + (project.stage === "edit" ? project.edit.progress / 100 : 0)) / 5 * 100;
      return `<article class="project-card" data-open-project="${project.id}" style="--template-color:${template.color}"><div class="project-card-top"><span class="template-tag">${template.code} ${esc(template.shortName)}</span><span class="status-chip">${esc(projectStatus(project))}</span></div><h3>${esc(project.titleOptions[project.selectedTitleIndex])}</h3><p>${esc(project.source.channel)} · ${esc(project.product || "Product not set")}</p><div class="progress-line"><i style="width:${Math.min(100, progress)}%"></i></div><div class="next-action"><span>Next: ${esc(nextAction(project))}</span><b>${Math.round(progress)}%</b></div></article>`;
    };
    const columns = groups.map(([name, projects]) => `<section class="kanban-column"><div class="column-head"><strong>${name}</strong><span>${projects.length}</span></div>${projects.map(projectCard).join("") || '<div class="empty-state"><strong>Nothing here yet</strong>Create a project from Discover.</div>'}</section>`).join("");
    const published = state.projects.filter((p) => p.publish.status === "published").length;
    const editing = state.projects.filter((p) => p.edit.status === "rendering").length;
    const content = `<div class="page-head"><div><p class="eyebrow">One queue from trend to upload</p><h1>Production pipeline</h1><p>Every project carries its source insight, chosen format, script, footage, edit settings, and YouTube package.</p></div><button class="primary" data-nav="discover">Find a trending video</button></div>
      <div class="pipeline-summary"><div class="summary-hero"><div><strong>${state.projects.length} active projects</strong><span>The original /yt pipeline is unchanged.</span></div>${icon("pipeline")}</div><div class="summary-card"><strong>${state.projects.filter((p) => p.stage === "record").length}</strong><span>Ready to record</span></div><div class="summary-card"><strong>${editing}</strong><span>Auto edits running</span></div><div class="summary-card"><strong>${published}</strong><span>Uploads completed</span></div></div><div class="kanban">${columns}</div>`;
    app.innerHTML = layout(content, "Production pipeline");
  }

  function projectStatus(project) {
    if (project.publish.status === "published") return "Published privately";
    if (project.publish.status === "uploading") return "Uploading";
    if (project.edit.status === "rendering") return "Auto editing";
    if (project.edit.status === "review") return "Ready for review";
    return stepLabels[project.stage][0];
  }

  function nextAction(project) {
    if (project.publish.status === "published") return "Review in YouTube Studio";
    if (project.edit.status === "review") return "Approve final cut";
    return { plan: "Approve packaging", script: "Approve script", record: "Upload A-roll", edit: "Wait for render", publish: "Upload privately" }[project.stage];
  }

  function renderWorkspace() {
    const project = activeProject();
    if (!project) { state.activeProjectId = null; state.view = "pipeline"; render(); return; }
    const template = getTemplate(project.templateId);
    const current = steps.indexOf(state.activeStep);
    const unlocked = Math.max(stageIndex(project), project.edit.status === "review" ? 4 : 0);
    const stepper = steps.map((step, index) => `<button class="step-button ${step === state.activeStep ? "active" : ""} ${index < unlocked || project.publish.status === "published" ? "done" : ""}" data-step="${step}" ${index > unlocked ? "disabled" : ""}><span class="step-number">${index < unlocked || project.publish.status === "published" ? "✓" : index + 1}</span><span class="step-copy"><strong>${stepLabels[step][0]}</strong><span>${stepLabels[step][1]}</span></span></button>`).join("");
    const workspace = `<div class="workspace-head"><div class="workspace-source"><img src="${esc(project.source.thumbnail)}" alt=""><div><p class="eyebrow">${template.code} · ${esc(template.name)}</p><h1>${esc(project.titleOptions[project.selectedTitleIndex])}</h1><p>Inspired by ${esc(project.source.channel)} · rebuilt as original Jon Mac Business content</p></div></div><button class="secondary" data-close-project>Back to pipeline</button></div><div class="workspace-layout"><aside class="stepper">${stepper}</aside><section class="workspace-panel">${renderStep(project, template)}</section></div>`;
    app.innerHTML = layout(workspace, "Project workspace");
  }

  function renderStep(project, template) {
    if (state.activeStep === "script") return renderScriptStep(project, template);
    if (state.activeStep === "record") return renderRecordStep(project, template);
    if (state.activeStep === "edit") return renderEditStep(project, template);
    if (state.activeStep === "publish") return renderPublishStep(project, template);
    return renderPlanStep(project, template);
  }

  function renderPlanStep(project, template) {
    return `<div class="panel-head"><div><h2>Original angle and packaging</h2><p>Keep the market signal. Replace the creator’s expression, examples, structure, and claims.</p></div><span class="status-chip"><i class="status-dot"></i>${esc(template.editorPreset)}</span></div><div class="panel-body"><div class="prototype-banner">The source is research—not a script to paraphrase. V2 extracts transferable beats and routes them through your selected format.</div><div class="plan-grid">
      <div class="subpanel"><div class="subpanel-head"><strong>Source signal</strong><span>${Number(project.source.outlier_score).toFixed(1)}× outlier</span></div><div class="source-mini"><img src="${esc(project.source.thumbnail)}"><div><h3>${esc(project.source.title)}</h3><p>${esc(project.source.channel)} · ${formatNumber(project.source.views)} views</p><div class="structure-chips"><span>Fast promise</span><span>Visible proof</span><span>Live demo</span><span>Clear verdict</span><span>Direct CTA</span></div></div></div></div>
      <div class="subpanel" style="--template-color:${template.color}"><div class="subpanel-head"><strong>Your format</strong><span>${template.code}</span></div><div class="template-overview"><div class="template-icon">${icon(template.icon)}</div><div><h3>${esc(template.name)}</h3><p>${esc(template.description)}</p><div class="mini-tags"><span>${esc(template.audience)}</span><span>${esc(template.editorPreset)}</span><span>2,500 words</span></div></div></div></div>
      <div class="subpanel"><div class="subpanel-head"><strong>Choose a title</strong><span>3 original angles</span></div><div class="option-list">${project.titleOptions.map((title, i) => `<div class="option ${i === project.selectedTitleIndex ? "selected" : ""}" data-title-option="${i}"><span class="option-index">${i + 1}</span><p>${esc(title)}</p></div>`).join("")}</div></div>
      <div class="subpanel"><div class="subpanel-head"><strong>Choose a thumbnail concept</strong><span>${esc(template.thumbnailPreset)}</span></div><div class="option-list">${project.thumbnailOptions.map((title, i) => `<div class="option ${i === project.selectedThumbnailIndex ? "selected" : ""}" data-thumb-option="${i}"><span class="option-index">${i + 1}</span><p>${esc(title)}</p></div>`).join("")}</div></div>
      <div class="subpanel full"><div class="subpanel-head"><strong>Commercial bridge</strong><span>Why this belongs on Jon Mac Business</span></div><div class="drawer-fields"><label class="field"><span>Primary audience</span><input data-project-field="audience" value="${esc(project.audience)}"></label><label class="field"><span>Product / example</span><input data-project-field="product" value="${esc(project.product)}"></label><label class="field full"><span>ViralView promise</span><input data-project-field="offer" value="${esc(project.offer)}"></label></div></div>
    </div></div><div class="panel-foot"><button class="secondary" data-regenerate-plan>Regenerate options</button><button class="primary" data-approve-plan>Approve plan & write script</button></div>`;
  }

  function renderScriptStep(project, template) {
    const count = wordCount(project.script);
    const pct = Math.min(100, count / 2500 * 100);
    return `<div class="panel-head"><div><h2>Template-aware script</h2><p>Structured to exactly 2,500 words when the production LLM is connected.</p></div><button class="secondary" data-regenerate-script>${icon("spark")}Regenerate draft</button></div><div class="panel-body"><div class="prototype-banner"><strong>Prototype behavior:</strong> the section scaffold and editor markers are real. The production endpoint should expand each section to its budget and validate the final 2,500-word count.</div><div class="script-layout"><div class="script-editor"><div class="script-toolbar"><strong>Jon Mac draft</strong><div class="word-meter"><span><b id="word-count">${count}</b> / 2,500 words</span><div class="word-meter-bar"><i id="word-progress" style="width:${pct}%"></i></div></div></div><textarea id="script-text">${esc(project.script)}</textarea></div><aside><div class="subpanel"><div class="subpanel-head"><strong>${template.code} section budget</strong><span>Exact target</span></div><div class="section-budget">${template.sections.map(([name, words]) => `<div class="budget-row"><span>${esc(name)}</span><strong>${words}</strong></div>`).join("")}</div><div class="budget-total"><span>Total</span><strong>${template.sections.reduce((sum, item) => sum + item[1], 0)} words</strong></div></div><div class="marker-key"><strong>Auto-editor markers</strong><p>[SHOW FINISHED RESULT]<br>[SCREEN RECORDING]<br>[VIRALVIEW DEMO START]<br>[CTA LOWER THIRD]</p></div></aside></div></div><div class="panel-foot"><button class="secondary" data-save-script>Save draft</button><button class="primary" data-approve-script>Approve & prepare recording</button></div>`;
  }

  function renderRecordStep(project, template) {
    const assets = project.assets || [];
    return `<div class="panel-head"><div><h2>Record and upload raw footage</h2><p>One clean A-roll file plus the screen captures and outputs named by the template.</p></div><button class="secondary" data-demo-assets>Use demo footage</button></div><div class="panel-body"><div class="record-grid"><div class="teleprompter-card"><p class="eyebrow">Teleprompter · ${template.code}</p><h3>${esc(project.titleOptions[project.selectedTitleIndex])}</h3><div class="teleprompter-copy">${esc(project.script)}</div></div><label class="upload-card ${assets.some((a) => a.type === "A-roll") ? "ready" : ""}">${icon("upload")}<strong>${assets.some((a) => a.type === "A-roll") ? "A-roll uploaded" : "Drop your raw A-roll here"}</strong><span>MP4 or MOV · long recordings are fine</span><input type="file" accept="video/*" data-upload="a-roll"></label><label class="upload-card ${assets.length > 1 ? "ready" : ""}">${icon("file")}<strong>Add screen recordings and outputs</strong><span>${esc(template.requiredAssets.join(" · "))}</span><input type="file" multiple data-upload="assets"></label><div class="asset-list">${assets.map((asset) => `<div class="asset-item">${icon("check")}<div><strong>${esc(asset.name)}</strong><span>${esc(asset.type)} · ${esc(asset.size)}</span></div></div>`).join("") || '<div class="empty-state"><strong>No files uploaded</strong>Your files will appear here.</div>'}</div></div></div><div class="panel-foot"><button class="primary" data-start-edit ${assets.some((a) => a.type === "A-roll") ? "" : "disabled"}>Start auto edit</button></div>`;
  }

  function renderEditStep(project, template) {
    const edit = project.edit;
    const complete = edit.status === "review" || edit.status === "approved";
    const progress = complete ? 100 : edit.progress;
    return `<div class="panel-head"><div><h2>${complete ? "Review your first cut" : "Auto editor is building your video"}</h2><p>${esc(template.editorPreset)} preset · transcript-guided cuts · motion graphics from script markers</p></div><span class="status-chip"><i class="status-dot"></i>${complete ? "Render ready" : "Background job"}</span></div><div class="panel-body"><div class="prototype-banner">This preview simulates the job state and review experience. Production needs object storage, transcription, a render worker, and signed preview URLs.</div><div class="edit-stage"><div><div class="video-preview"><img src="${esc(project.source.thumbnail)}"><div class="preview-content"><div class="play">${icon("play")}</div><strong>${complete ? "First cut · 18:42" : "Assembling first cut"}</strong><span>${complete ? "1080p preview · captions and graphics included" : "You can leave this page while it renders"}</span></div></div><div class="timeline"><i style="--w:1.4;--c:#2676ff"></i><i style="--w:.5;--c:#ff6b4a"></i><i style="--w:2;--c:#2676ff"></i><i style="--w:.8;--c:#17b890"></i><i style="--w:1.2;--c:#7758ff"></i></div><div class="edit-progress"><div class="progress-head"><strong>${complete ? "First cut complete" : "Auto-edit progress"}</strong><span>${progress}%</span></div><div class="big-progress"><i style="width:${progress}%"></i></div><div class="job-step">${complete ? '<i style="background:#0bba7a;animation:none"></i>Ready for your approval' : `<i></i>${esc(edit.currentJob || "Preparing footage")}`}</div></div></div><aside class="edit-controls"><h3>Editor recipe</h3><div class="control-row"><label>Jump cuts <span class="switch"></span></label></div><div class="control-row"><label>Captions <span class="switch"></span></label><select><option>Jon Mac Clean</option><option>Bold social</option></select></div><div class="control-row"><label>Motion graphics <span class="switch"></span></label><select><option>Business minimal</option><option>High-energy tech</option></select></div><div class="control-row"><label>Pacing<input type="range" min="1" max="5" value="4"></label></div><div class="control-row"><label>Audio mix <span class="switch"></span></label></div></aside></div></div><div class="panel-foot"><button class="secondary" ${complete ? "" : "disabled"} data-request-revision>Request revision</button><button class="primary" ${complete ? "" : "disabled"} data-approve-edit>Approve final cut</button></div>`;
  }

  function renderPublishStep(project) {
    const publish = project.publish;
    const title = project.titleOptions[project.selectedTitleIndex];
    return `<div class="panel-head"><div><h2>Package and upload to YouTube</h2><p>V2 always defaults to Private so you retain the final human approval in YouTube Studio.</p></div><span class="status-chip"><i class="status-dot"></i>${publish.status === "published" ? "Upload complete" : "YouTube draft"}</span></div><div class="panel-body"><div class="publish-grid"><div class="metadata-form"><label class="field"><span>Title</span><input data-publish-field="title" value="${esc(publish.title || title)}"></label><label class="field"><span>Description</span><textarea data-publish-field="description">${esc(publish.description || `In this video, Jon tests an AI UGC workflow for TikTok Shop brands and affiliates.\n\nBuild your own AI UGC system with ViralView: https://viralview.io\n\nThis video uses original analysis and demonstrations inspired by public market trends.`)}</textarea></label><label class="field"><span>Tags</span><input data-publish-field="tags" value="${esc(publish.tags || "AI UGC, TikTok Shop, TikTok Shop affiliate, AI video, ViralView")}"></label><label class="field"><span>Visibility</span><select data-publish-field="visibility"><option value="private" ${publish.visibility !== "scheduled" ? "selected" : ""}>Private — recommended</option><option value="scheduled" ${publish.visibility === "scheduled" ? "selected" : ""}>Schedule after upload</option></select></label></div><aside class="publish-check"><h3>Preflight check</h3><div class="check-list"><div class="check"><i>✓</i>Final cut approved</div><div class="check"><i>✓</i>Original title and script</div><div class="check"><i>✓</i>ViralView link included</div><div class="check"><i>✓</i>Captions generated</div><div class="check"><i>✓</i>Visibility set to private</div></div><div class="private-note">Publishing remains a human-controlled action. The production integration should upload privately first and return the YouTube Studio edit link.</div>${publish.status === "uploading" ? `<div class="edit-progress"><div class="progress-head"><strong>Uploading</strong><span>${publish.progress || 0}%</span></div><div class="big-progress"><i style="width:${publish.progress || 0}%"></i></div></div>` : ""}${publish.status === "published" ? `<div class="youtube-success"><strong>Uploaded privately to YouTube</strong><a href="${esc(publish.url)}" target="_blank">Open draft in YouTube Studio →</a></div>` : ""}</aside></div></div><div class="panel-foot"><button class="secondary" data-save-metadata>Save metadata</button><button class="primary" data-upload-youtube ${publish.status === "uploading" || publish.status === "published" ? "disabled" : ""}>${icon("upload")}Upload privately to YouTube</button></div>`;
  }

  function renderSettings() {
    const integrations = [
      ["Outlier discovery feed", "ready", "Ready", "Uses the existing curated YouTube dataset and relative channel-performance scoring."],
      ["Six script templates", "ready", "Ready", "Stored as versioned data with exact 2,500-word allocations and editor presets."],
      ["Script generation API", "prototype", "Prototype", "UI, prompts, budgets, and approval state are ready; connect your preferred LLM endpoint."],
      ["Raw footage storage", "required", "Connect", "Use resumable uploads to S3, Cloudflare R2, or Supabase Storage for large A-roll files."],
      ["Transcription + render worker", "required", "Connect", "Needs transcription, edit-decision-list generation, FFmpeg/render worker, and signed previews."],
      ["YouTube OAuth + upload", "required", "Connect", "Use resumable YouTube Data API uploads, private by default, with retry-safe job state."],
    ];
    const cards = integrations.map(([name, status, label, copy]) => `<article class="integration-card"><div class="integration-top"><h3>${esc(name)}</h3><span class="integration-status ${status}">${label}</span></div><p>${esc(copy)}</p></article>`).join("");
    const library = templates.map((template) => `<article class="template-library-card" style="--template-color:${template.color}"><p class="eyebrow">${template.code} · ${esc(template.audience)}</p><h3>${esc(template.name)}</h3><p>${esc(template.description)}</p><div class="budget-total"><span>${template.sections.length} sections</span><strong>${template.sections.reduce((sum, section) => sum + section[1], 0)} words</strong></div></article>`).join("");
    const content = `<div class="page-head"><div><p class="eyebrow">Control center</p><h1>Templates and integrations</h1><p>The V2 interface separates what already works from what needs a production service behind it.</p></div></div><div class="settings-grid">${cards}</div><div class="page-head" style="margin-top:28px;margin-bottom:0"><div><p class="eyebrow">Reusable formats</p><h2>Six templates, one production system</h2></div></div><div class="template-library">${library}</div>`;
    app.innerHTML = layout(content, "Templates & integrations");
  }

  function renderDrawer() {
    if (!state.drawerSourceId) return "";
    const row = allRows.find((item) => item.id === state.drawerSourceId);
    if (!row) return "";
    const recommended = recommendTemplate(row);
    const selected = getTemplate(state.drawerTemplateId || recommended.id);
    return `<div class="drawer-backdrop" data-drawer-backdrop><aside class="drawer" role="dialog" aria-modal="true" aria-label="Create remake project"><div class="drawer-head"><div><p class="eyebrow">New original project</p><h2>Route this trend through a format</h2></div><button class="close-button" data-close-drawer>${icon("x")}</button></div><div class="drawer-body"><div class="drawer-source"><img src="${esc(row.thumbnail)}"><div><h3>${esc(row.title)}</h3><p>${esc(row.channel)} · ${formatNumber(row.views)} views · ${Number(row.outlier_score).toFixed(1)}× outlier</p></div></div><div class="drawer-section"><h3>1. Choose one of six templates</h3><div class="template-picker">${templates.map((template) => `<button class="template-choice ${selected.id === template.id ? "selected" : ""}" style="--template-color:${template.color}" data-drawer-template="${template.id}">${recommended.id === template.id ? '<b class="recommended-badge">Recommended</b>' : ""}<strong>${template.code} · ${esc(template.name)}</strong><span>${esc(template.description)}</span></button>`).join("")}</div></div><div class="drawer-section"><h3>2. Add the commercial context</h3><div class="drawer-fields"><label class="field"><span>Audience</span><input id="drawer-audience" value="${esc(state.draftAudience)}"></label><label class="field"><span>Product or niche</span><input id="drawer-product" value="${esc(state.draftProduct)}" placeholder="e.g. portable blender"></label><label class="field full"><span>ViralView bridge</span><input id="drawer-offer" value="${esc(state.draftOffer)}"></label></div></div></div><div class="drawer-foot"><button class="secondary" data-close-drawer>Cancel</button><button class="primary" data-create-project>Create ${selected.code} project</button></div></aside></div>`;
  }

  function render() {
    if (state.activeProjectId) renderWorkspace();
    else if (state.view === "pipeline") renderPipeline();
    else if (state.view === "settings") renderSettings();
    else renderDiscover();
    if (state.drawerSourceId) app.insertAdjacentHTML("beforeend", renderDrawer());
  }

  function createProject() {
    const row = allRows.find((item) => item.id === state.drawerSourceId);
    const template = getTemplate(state.drawerTemplateId || recommendTemplate(row).id);
    if (!row) return;
    state.draftAudience = document.getElementById("drawer-audience")?.value.trim() || state.draftAudience;
    state.draftProduct = document.getElementById("drawer-product")?.value.trim() || "Featured TikTok Shop product";
    state.draftOffer = document.getElementById("drawer-offer")?.value.trim() || state.draftOffer;
    const project = {
      id: `v2_${Date.now()}`,
      createdAt: new Date().toISOString(),
      source: { id: row.id, title: row.title, thumbnail: row.thumbnail, channel: row.channel, views: row.views, outlier_score: row.outlier_score, url: row.url },
      templateId: template.id,
      audience: state.draftAudience,
      product: state.draftProduct,
      offer: state.draftOffer,
      stage: "plan",
      titleOptions: generateTitles(row, template, state.draftProduct),
      selectedTitleIndex: 0,
      thumbnailOptions: ["AI result on the left, surprised Jon on the right, 3-word verdict", "Product centered with before/after outputs and a red comparison arrow", `Large ${template.code} badge, model logo, and one bold commercial result`],
      selectedThumbnailIndex: 0,
      script: "",
      assets: [],
      edit: { status: "idle", progress: 0, currentJob: "Waiting for footage" },
      publish: { status: "idle", progress: 0, visibility: "private" },
    };
    project.script = generateScript(project);
    state.projects.unshift(project);
    state.activeProjectId = project.id;
    state.activeStep = "plan";
    state.drawerSourceId = null;
    saveProjects();
    render();
    toast(`${template.code} project created`);
  }

  function updateProject(mutator, shouldRender = true) {
    const project = activeProject();
    if (!project) return;
    mutator(project);
    saveProjects();
    if (shouldRender) render();
  }

  function startAutoEdit() {
    updateProject((project) => { project.stage = "edit"; project.edit = { status: "rendering", progress: 4, currentJob: "Transcribing A-roll" }; });
    state.activeStep = "edit";
    render();
    const jobs = [[17, "Removing retakes and dead air"], [34, "Matching B-roll to script markers"], [53, "Building captions and motion graphics"], [72, "Mixing and leveling audio"], [89, "Rendering 1080p preview"], [100, "Ready for review"]];
    let index = 0;
    clearInterval(state.renderTimer);
    state.renderTimer = setInterval(() => {
      const activeId = state.activeProjectId;
      const project = state.projects.find((p) => p.id === activeId);
      if (!project) return clearInterval(state.renderTimer);
      const [progress, job] = jobs[index++];
      project.edit.progress = progress;
      project.edit.currentJob = job;
      if (progress === 100) { project.edit.status = "review"; clearInterval(state.renderTimer); toast("Your first cut is ready to review"); }
      saveProjects();
      if (state.activeProjectId === activeId && state.activeStep === "edit") render();
    }, 650);
  }

  function startYoutubeUpload() {
    updateProject((project) => { project.publish.status = "uploading"; project.publish.progress = 5; });
    clearInterval(state.uploadTimer);
    state.uploadTimer = setInterval(() => {
      const project = activeProject();
      if (!project) return clearInterval(state.uploadTimer);
      project.publish.progress = Math.min(100, project.publish.progress + 19);
      if (project.publish.progress >= 100) {
        project.publish.status = "published";
        project.publish.url = `https://studio.youtube.com/video/v2-demo-${project.id}/edit`;
        clearInterval(state.uploadTimer);
        toast("Private YouTube upload complete");
      }
      saveProjects();
      render();
    }, 500);
  }

  app.addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-drawer-backdrop")) { state.drawerSourceId = null; render(); return; }
    const target = event.target.closest("button, [data-open-project], [data-title-option], [data-thumb-option], [data-close-drawer]");
    if (!target) return;
    if (target.dataset.nav) { state.activeProjectId = null; state.view = target.dataset.nav; render(); }
    else if (target.dataset.remake) { const row = allRows.find((r) => r.id === target.dataset.remake); state.drawerSourceId = target.dataset.remake; state.drawerTemplateId = recommendTemplate(row).id; render(); }
    else if (target.hasAttribute("data-close-drawer")) { state.drawerSourceId = null; render(); }
    else if (target.dataset.drawerTemplate) { state.drawerTemplateId = target.dataset.drawerTemplate; render(); }
    else if (target.hasAttribute("data-create-project")) createProject();
    else if (target.hasAttribute("data-refresh")) refreshDataset();
    else if (target.dataset.templateFilter) { state.templateFilter = target.dataset.templateFilter; render(); }
    else if (target.dataset.openProject) { state.activeProjectId = target.dataset.openProject; state.activeStep = activeProject().stage; render(); }
    else if (target.hasAttribute("data-close-project")) { state.activeProjectId = null; state.view = "pipeline"; render(); }
    else if (target.dataset.step) { state.activeStep = target.dataset.step; render(); }
    else if (target.dataset.titleOption) updateProject((p) => { p.selectedTitleIndex = Number(target.dataset.titleOption); });
    else if (target.dataset.thumbOption) updateProject((p) => { p.selectedThumbnailIndex = Number(target.dataset.thumbOption); });
    else if (target.hasAttribute("data-regenerate-plan")) updateProject((p) => { p.titleOptions = generateTitles(p.source, getTemplate(p.templateId), p.product).map((t, i) => i === 0 ? t.replace("I Tested", "I Put") : t); toast("Packaging options refreshed"); });
    else if (target.hasAttribute("data-approve-plan")) updateProject((p) => { p.script = generateScript(p); p.stage = "script"; state.activeStep = "script"; toast("Plan approved. Script scaffold created."); });
    else if (target.hasAttribute("data-regenerate-script")) updateProject((p) => { p.script = generateScript(p); toast("Script regenerated from the selected format"); });
    else if (target.hasAttribute("data-save-script")) { const text = document.getElementById("script-text")?.value || ""; updateProject((p) => { p.script = text; }, false); toast("Draft saved"); }
    else if (target.hasAttribute("data-approve-script")) { const text = document.getElementById("script-text")?.value || activeProject().script; updateProject((p) => { p.script = text; p.stage = "record"; state.activeStep = "record"; toast("Script approved. Recording kit is ready."); }); }
    else if (target.hasAttribute("data-demo-assets")) updateProject((p) => { p.assets = demoAssets.map((a) => ({ ...a })); toast("Demo footage attached"); });
    else if (target.hasAttribute("data-start-edit")) startAutoEdit();
    else if (target.hasAttribute("data-request-revision")) { toast("Revision note added to the next render"); }
    else if (target.hasAttribute("data-approve-edit")) updateProject((p) => { p.edit.status = "approved"; p.stage = "publish"; state.activeStep = "publish"; toast("Final cut approved"); });
    else if (target.hasAttribute("data-save-metadata")) { syncPublishFields(); saveProjects(); toast("YouTube metadata saved"); }
    else if (target.hasAttribute("data-upload-youtube")) { syncPublishFields(); startYoutubeUpload(); }
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "trend-search") { state.search = event.target.value; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(render, 180); }
    if (event.target.id === "script-text") {
      const count = wordCount(event.target.value);
      const countNode = document.getElementById("word-count");
      const bar = document.getElementById("word-progress");
      if (countNode) countNode.textContent = count;
      if (bar) bar.style.width = `${Math.min(100, count / 2500 * 100)}%`;
    }
    if (event.target.dataset.projectField) updateProject((p) => { p[event.target.dataset.projectField] = event.target.value; }, false);
  });

  app.addEventListener("change", (event) => {
    if (event.target.id === "date-filter") { state.date = event.target.value; render(); }
    if (event.target.id === "duration-filter") { state.duration = event.target.value; render(); }
    if (event.target.id === "views-filter") { state.minViews = Number(event.target.value); render(); }
    if (event.target.id === "outliers-filter") { state.onlyOutliers = event.target.checked; render(); }
    if (event.target.id === "metric-filter") { state.metric = event.target.value; render(); }
    if (event.target.dataset.upload) {
      const files = Array.from(event.target.files || []);
      updateProject((project) => {
        const mapped = files.map((file) => ({ name: file.name, size: `${Math.max(.1, file.size / 1024 / 1024).toFixed(1)} MB`, type: event.target.dataset.upload === "a-roll" ? "A-roll" : "Production asset" }));
        if (event.target.dataset.upload === "a-roll") project.assets = project.assets.filter((a) => a.type !== "A-roll").concat(mapped);
        else project.assets = project.assets.concat(mapped);
      });
      toast(`${files.length} file${files.length === 1 ? "" : "s"} added`);
    }
  });

  function syncPublishFields() {
    const project = activeProject();
    if (!project) return;
    document.querySelectorAll("[data-publish-field]").forEach((field) => { project.publish[field.dataset.publishField] = field.value; });
  }

  render();
})();
