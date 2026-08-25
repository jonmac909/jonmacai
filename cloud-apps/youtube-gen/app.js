const DATA_URL = "../recent_outliers_rows.json";
const MS_PER_DAY = 86_400_000;
const CUSTOM_KEYWORDS_STORAGE = "outlier_viewer_custom_keywords_v1";
const IDEAS_STORAGE = "outlier_viewer_ideas_v1";
const REMAKE_PACKAGES_STORAGE = "outlier_viewer_remake_packages_v1";
const REMAKE_PROJECTS_STORAGE = "outlier_viewer_remake_projects_v1";
const REFRESHED_ROWS_STORAGE = "outlier_viewer_refreshed_rows_v1";
const RECOVERY_SEED_STORAGE = "youtube_gen_recovered_factory_seed_v1";
const PERFORMANCE_STORAGE = "outlier_viewer_performance_v1";
const SOURCE_POOL_PAGE_SIZE = 6;
const LONG_FORM_MIN_SECONDS = 180;
const SOURCE_POOL_DEFAULT_DAYS = 21;
const SOURCE_POOL_MIN_DAYS = 1;
const SOURCE_POOL_MAX_DAYS = 120;
const SOURCE_POOL_DEFAULT_MULTIPLE = 1.5;
const SOURCE_POOL_MIN_MULTIPLE = 1;
const SOURCE_POOL_MAX_MULTIPLE = 10;
const SOURCE_POOL_MULTIPLE_STEP = 0.25;
const CHANNELS_HIDDEN_STORAGE = "outlier_viewer_channels_hidden_v1";
const KEYWORD_VOLUME_OVERRIDES_STORAGE = "outlier_viewer_keyword_volume_overrides_v1";
const KEYWORDTOOL_API_KEY_STORAGE = "outlier_viewer_keywordtool_api_key_v1";
const KIE_API_KEY_STORAGE = "kie_api_key";
const CLOUD_STATE_API_URL = "/api/cloud/youtube-gen/state";
const CLOUD_STATE_STORAGE_KEYS = [
  CUSTOM_KEYWORDS_STORAGE,
  IDEAS_STORAGE,
  REMAKE_PROJECTS_STORAGE,
  REFRESHED_ROWS_STORAGE,
  PERFORMANCE_STORAGE,
  CHANNELS_HIDDEN_STORAGE,
  KEYWORD_VOLUME_OVERRIDES_STORAGE,
];
let cloudStateSaveTimer = 0;
const pendingCloudStateKeys = new Set();
const THUMBNAIL_PROMPT_VERSION = "source-layout-lock-v6";
const THUMBNAIL_IDENTITY_PROMPT_PROTOCOL = "thumbnail-identity-lock-v6";
const SUPPORTED_THUMBNAIL_PROMPT_VERSIONS = new Set([
  "source-layout-lock-v4",
  "source-layout-lock-v5",
  "source-layout-lock-v5-localized-edit",
  "source-layout-lock-v6",
  "source-layout-lock-v6-localized-edit",
]);
const TREND_API_URLS = [];
const KEYWORD_VOLUME_API_URLS = [];
const KEYWORD_VOLUME_BATCH_API_URLS = [];
const CHANNEL_API_URLS = [
  "/api/channel",
];
const CHANNEL_REFRESH_API_URLS = [
  "/api/channels/refresh-stream",
  "/api/channels/refresh",
];
const IDEA_GENERATION_API_URLS = [
  "/api/cloud/youtube-gen/factory-package",
];
const MANUAL_THUMBNAIL_API_URLS = [
  "/api/cloud/youtube-gen/manual-thumbnail",
];
const KIE_ASSET_API_URLS = [
  "/api/cloud/youtube-gen/kie-assets",
];
const BRAND_COLORS = {
  jonMacBlue: "#009FE3",
  claudeOrange: "#F97316",
  higgsfieldLime: "#C7FF2E",
};
const HEYGEN_LOCKED_SETTINGS = {
  avatarName: "Jon Mac Office",
  avatarId: "0fe4d8b1d93c45f4b54efdf13b7c94b3",
  voiceName: "Jon Eleven",
  voiceId: "ff5a7d57646445eab3b0d04c2da6e9e9",
  motionEngine: "Avatar III",
  aspectRatio: "16:9",
  outputFormat: "MP4",
};
const HEYGEN_STUDIO_URL = "https://app.heygen.com/projects";
const avatarVideoFiles = new Map();
const avatarVideoObjectUrls = new Map();
const heygenCodexPollTimers = new Map();
const heygenCodexAutoAttachAttempts = new Set();
const LOCAL_HEYGEN_CODEX_BRIDGE_URLS = [
  "/api/local/codex/heygen-avatar",
];
const LOCAL_DRIVE_FILE_UPLOAD_BRIDGE_URLS = [
  "/api/local/codex/drive-upload-file",
];
const FOCUS_KEYWORDS = [
  "claude ai",
  "claude design",
  "claude code tutorial",
  "claude skills tutorial",
  "how to use claude code",
  "claude cowork tutorial",
  "codex vs claude",
  "codex tutorial",
  "chatgpt codex",
  "how to use codex",
  "claude code vs codex",
  "codex 5.5",
  "obsidian claude code",
  "remotion claude code",
  "claude managed agents",
  "claude video editing",
  "claude code free unlimited",
];

const EDITOR_PRESETS = [
  { name: "Usman", phone: "+923282301478" },
  { name: "Vishal", phone: "+919713433745" },
  { name: "Rishi", phone: "+917999548394" },
];
const CURRENT_EDITOR_HANDOFF_TITLE = "This Claude + Higgsfield Combo Replaces 6 AI Video Tools";
const CURRENT_EDITOR_HANDOFF_DRIVE_FOLDER = {
  id: "1tEOpUYsU0s62qK9LVe16iDYdndSgIxEc",
  name: "This Claude + Higgsfield Combo Replaces 6 AI Video Tools",
  url: "https://drive.google.com/drive/folders/1tEOpUYsU0s62qK9LVe16iDYdndSgIxEc",
  webViewLink: "https://drive.google.com/drive/folders/1tEOpUYsU0s62qK9LVe16iDYdndSgIxEc",
};
const STALE_EDITOR_HANDOFF_DRIVE_FOLDER_IDS = new Set(["1-u8SaScWRlulQ5a5CzUs3Rmuh4pzH3D4"]);

const state = {
  rows: [],
  trends: {},
  keywordVolumes: {},
  keywordVolumeOverrides: {},
  customKeywords: [],
  trendLoading: new Set(),
  trendErrors: {},
  trendFetchPausedUntil: 0,
  trendFetchPausedReason: "",
  keywordVolumeLoading: new Set(),
  keywordVolumeErrors: {},
  keywordVolumeBatchLoading: false,
  keywordToolApiKey: "",
  channelLoading: false,
  channelRefreshing: false,
  channelRefreshProgress: null,
  channelRemoving: new Set(),
  channelStatus: "",
  channelError: "",
  selectedVideos: new Set(),
  ideas: [],
  remakePackages: [],
  savedProjects: [],
  selectedRemakeVideoId: "",
  sourcePoolOffset: 0,
  sourcePoolDays: SOURCE_POOL_DEFAULT_DAYS,
  sourcePoolMinMultiple: SOURCE_POOL_DEFAULT_MULTIPLE,
  packageStep: "source",
  thumbnailPromptIndex: 1,
  thumbnailPromptReady: new Set(),
  ideaGenerationLoading: false,
  ideaProgress: null,
  assetGenerationLoading: false,
  assetProgress: null,
  assetGenerationTarget: null,
  editingThumbnailIndex: 0,
  editingThumbnailPrompt: "",
  previewAsset: null,
  editingScript: false,
  scriptDraft: "",
  avatarBrowserUrl: "https://app.heygen.com/",
  editorDraftName: "",
  editorDraftPhone: "",
  editorMessageDraft: "",
  editorMessageTouched: false,
  editorHandoffLoading: false,
  cloudConfigStatus: null,
  cloudConfigLoading: false,
  performanceLogs: [],
  metric: "views",
  view: "videos",
  selectedChannels: new Set(),
  channelsHidden: false,
  search: "",
  date: "all",
  duration: "all",
  minViews: 0,
  onlyOutliers: false,
  sort: "viewAll",
};

const channelStyles = {
  nateherk: ["NH", "#111827"],
  itssssss_jack: ["JR", "#f05a37"],
  robonuggets: ["RN", "#0f766e"],
  chase_h_ai: ["CA", "#4338ca"],
  simonscrapes: ["SS", "#0f172a"],
  mark_kashef: ["MK", "#7c2d12"],
  mrpaidsocial: ["MP", "#0f172a"],
};

const els = {
  search: document.querySelector("#searchInput"),
  sort: document.querySelector("#sortSelect"),
  date: document.querySelector("#dateFilter"),
  duration: document.querySelector("#durationFilter"),
  minViews: document.querySelector("#viewsFilter"),
  metric: document.querySelector("#metricSelect"),
  onlyOutliers: document.querySelector("#onlyOutliers"),
  saved: document.querySelector(".saved"),
  chips: document.querySelector("#channelChips"),
  grid: document.querySelector("#grid"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  resultActionStatus: document.querySelector("#resultActionStatus"),
  clear: document.querySelector("#clearButton"),
  analyze: document.querySelector("#analyzeButton"),
  outliersPath: document.querySelector("#outliersPathButton"),
  projectsPath: document.querySelector("#projectsPathButton"),
  factoryPath: document.querySelector("#factoryPathButton"),
  filters: document.querySelector(".filters"),
  topSearch: document.querySelector(".search"),
  sortControl: document.querySelector(".sort-control"),
  generateIdeas: document.querySelector("#generateIdeasButton"),
  toggleChannels: document.querySelector("#toggleChannelsButton"),
  keywordAddForm: document.querySelector("#keywordAddForm"),
  keywordInput: document.querySelector("#keywordInput"),
  channelAddForm: document.querySelector("#channelAddForm"),
  channelInput: document.querySelector("#channelInput"),
  refreshChannels: document.querySelector("#refreshChannelsButton"),
  channelStatus: document.querySelector("#channelStatus"),
};

function compactNumber(value) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(value));
}

function compactVolume(value) {
  if (!Number.isFinite(value)) return "not available";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M/mo`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K/mo`;
  return `${Math.round(value)}/mo`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseUploadDate(raw) {
  const str = String(raw || "");
  if (!/^\d{8}$/.test(str)) return null;
  return new Date(Number(str.slice(0, 4)), Number(str.slice(4, 6)) - 1, Number(str.slice(6, 8)));
}

function localCalendarDate(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function ageDaysFromUpload(raw, fallback = 99999) {
  const savedAge = Number(fallback);
  if (Number.isFinite(savedAge) && savedAge >= 0 && savedAge < 99999) {
    return Math.max(0, Math.round(savedAge));
  }
  const uploaded = parseUploadDate(raw);
  if (!uploaded) return 99999;
  return Math.max(0, Math.round((localCalendarDate() - localCalendarDate(uploaded)) / MS_PER_DAY));
}

function ageLabelFromDays(days) {
  if (!Number.isFinite(days)) return "";
  const rounded = Math.max(0, Math.round(days));
  if (rounded === 0) return "today";
  if (rounded === 1) return "1 day ago";
  return `${rounded} days ago`;
}

function daysAgo(raw) {
  const uploaded = parseUploadDate(raw);
  if (!uploaded) return "";
  return ageLabelFromDays(ageDaysFromUpload(raw));
}

function rowAgeLabel(row) {
  return ageLabelFromDays(Number(row.ageDays ?? row.age_days));
}

function prettyDate(raw) {
  const uploaded = parseUploadDate(raw);
  if (!uploaded) return "";
  return uploaded.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function projectUpdatedLabel(raw) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "Saved project";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function channelHandle(row) {
  if (row.channel_handle) return row.channel_handle;
  const handles = {
    nateherk: "@nateherk",
    itssssss_jack: "@Itssssss_Jack",
    robonuggets: "@RoboNuggets",
    chase_h_ai: "@Chase-H-AI",
    simonscrapes: "@simonscrapes",
    mark_kashef: "@Mark_Kashef",
  };
  return handles[row.channel_key] || `@${row.channel.replace(/\s+/g, "")}`;
}

function inferTrendQuery(row) {
  const title = String(row.title || "").toLowerCase();
  const checks = [
    ["seedance 2.0", "Seedance 2.0"],
    ["higgsfield", "Higgsfield AI"],
    ["ai ugc ads", "AI UGC ads"],
    ["ugc ads", "UGC ads"],
    ["ugc ad", "UGC ads"],
    ["ai video generators", "AI video generators"],
    ["ai video generator", "AI video generator"],
    ["ai videos", "AI videos"],
    ["ai video", "AI video"],
    ["ai ads", "AI ads"],
    ["ai ad", "AI ads"],
    ["ai animation", "AI animation"],
    ["ai anime", "AI anime"],
    ["ai filmmaking", "AI filmmaking"],
    ["ai music videos", "AI music videos"],
    ["music videos", "Music videos"],
    ["cinema studio", "Cinema Studio"],
    ["marketing studio", "Marketing Studio"],
    ["gpt image 2", "GPT Image 2"],
    ["nano banana", "Nano Banana AI"],
    ["nanobanana", "Nano Banana AI"],
    ["kling 3.0", "Kling 3.0"],
    ["veo 3.1", "Veo 3.1"],
    ["sora 2", "Sora 2"],
    ["runway", "Runway AI"],
    ["suno", "Suno AI"],
    ["heygen", "HeyGen"],
    ["arcads", "Arcads"],
    ["openart", "OpenArt"],
    ["invideo", "InVideo AI"],
    ["design.com", "Design.com"],
    ["happyhorse", "HappyHorse AI"],
    ["wan 2.7", "Wan 2.7"],
    ["claude design", "Claude Design"],
    ["claude code", "Claude Code"],
    ["claude +", "Claude"],
    ["claude plus", "Claude"],
    ["opus 4.7", "Claude Opus 4.7"],
    ["claude opus", "Claude Opus"],
    ["claude code memory", "Claude Code Memory"],
    ["memory system", "Claude Code Memory"],
    ["claude code skills", "Claude Code Skills"],
    ["claude skills", "Claude Code Skills"],
    ["skills", "Claude Code Skills"],
    ["claude.md", "CLAUDE.md"],
    ["agent teams", "Claude Code Agents"],
    ["workflows", "Claude Code Workflows"],
    ["workflow", "Claude Code Workflows"],
    ["openclaw", "OpenClaw"],
    ["hermes", "OpenClaw"],
    ["antigravity", "Google Antigravity"],
    ["stitch", "Stitch AI"],
    ["notebooklm", "NotebookLM"],
    ["obsidian", "Obsidian AI"],
    ["codex", "Codex AI"],
    ["gemini", "Gemini AI"],
    ["ollama", "Ollama"],
    ["deepseek", "DeepSeek"],
    ["mcp", "MCP AI"],
    ["playwright", "Playwright AI"],
    ["spline", "Spline AI"],
    ["flutter", "Flutter AI"],
    ["canva", "Canva AI"],
    ["karpathy", "Andrej Karpathy Claude Code"],
    ["video editing", "AI video editing"],
    ["brand ads", "AI brand ads"],
    ["presentations", "AI presentation maker"],
    ["slides", "AI presentation maker"],
    ["mobile app", "AI app builder"],
    ["websites", "AI website builder"],
    ["website", "AI website builder"],
    ["browser automation", "AI browser automation"],
    ["trader", "AI trading bot"],
  ];
  const match = checks.find(([needle]) => title.includes(needle));
  if (match) return match[1];
  if (title.includes("claude")) return "Claude AI";
  const titleTokens = String(row.title || "")
    .match(/[A-Za-z][A-Za-z0-9.+#-]*/g)
    ?.filter((token) => token.length > 2 && !["the", "and", "for", "with", "you", "your", "this", "that", "how", "new", "best"].includes(token.toLowerCase()));
  return titleTokens?.slice(0, 3).join(" ") || "AI tools";
}

function enrich(row) {
  const uploadDate = parseUploadDate(row.upload_date);
  const viewsVsMedian = Number(row.views_vs_median || 0);
  const average = Number(row.channel_median_views || 0);
  const ageDays = ageDaysFromUpload(row.upload_date, row.age_days);
  const trendQuery = inferTrendQuery(row);
  return {
    ...row,
    ageDays,
    trendQuery,
    uploadTime: uploadDate ? uploadDate.getTime() : 0,
    outlierMultiple: viewsVsMedian,
    avgViews: average,
    thumbnail: `https://i.ytimg.com/vi/${row.id}/hqdefault.jpg`,
  };
}

function trendsUrl(query) {
  const params = new URLSearchParams({
    date: "today 12-m",
    geo: "US",
    gprop: "youtube",
    q: query,
  });
  return `https://trends.google.com/trends/explore?${params.toString()}`;
}

function openVideoUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return;

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Browser-specific noop.
    }
    return;
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "youtube-gen-open-url", url }, "*");
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function openExternalUrl(rawUrl, successMessage = "Opening in a new window.") {
  const url = String(rawUrl || "").trim();
  if (!url) return;

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Browser-specific noop.
    }
    state.channelError = "";
    state.channelStatus = successMessage;
    update();
    return;
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "youtube-gen-open-url", url }, "*");
    state.channelError = "";
    state.channelStatus = `${successMessage} If no tab appeared, allow popups for AIOS Hub and click again.`;
    update();
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

function openExternalUrlFromClick(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return false;

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Browser-specific noop.
    }
    return true;
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "youtube-gen-open-url", url }, "*");
    return true;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  return true;
}

function sparklinePath(points, width = 138, height = 36) {
  const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function trendSummary(points) {
  const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
  if (values.length < 2) return "No cached points";
  const latest = values.at(-1);
  const previous = values[Math.max(0, values.length - 9)];
  const delta = latest - previous;
  if (delta >= 8) return `rising, now ${latest}`;
  if (delta <= -8) return `cooling, now ${latest}`;
  return `steady, now ${latest}`;
}

function trendForQuery(query) {
  const normalized = normalizeKeyword(query).toLowerCase();
  if (!normalized) return undefined;
  if (state.trends[query]) return state.trends[query];
  const key = Object.keys(state.trends).find((value) => value.toLowerCase() === normalized);
  return key ? state.trends[key] : undefined;
}

function isTrendLoading(query) {
  return state.trendLoading.has(query.toLowerCase());
}

function keywordVolumeForQuery(query) {
  const normalized = normalizeKeyword(query).toLowerCase();
  if (!normalized) return undefined;
  if (state.keywordVolumeOverrides[query]) return state.keywordVolumeOverrides[query];
  const overrideKey = Object.keys(state.keywordVolumeOverrides).find((value) => value.toLowerCase() === normalized);
  if (overrideKey) return state.keywordVolumeOverrides[overrideKey];
  if (state.keywordVolumes[query]) return state.keywordVolumes[query];
  const key = Object.keys(state.keywordVolumes).find((value) => value.toLowerCase() === normalized);
  return key ? state.keywordVolumes[key] : undefined;
}

function isKeywordVolumeLoading(query) {
  return state.keywordVolumeLoading.has(query.toLowerCase());
}

function keywordVolumeDisplay(query) {
  const volume = keywordVolumeForQuery(query);
  const error = state.keywordVolumeErrors[query.toLowerCase()];
  if (isKeywordVolumeLoading(query)) {
    return {
      className: "loading",
      value: "Loading...",
      detail: "Checking real YouTube volume",
      title: "Looking up estimated YouTube monthly search traffic.",
    };
  }
  if (volume?.volume !== null && volume?.volume !== undefined && Number.isFinite(Number(volume.volume))) {
    const source = volume.source || "Volume provider";
    const detailParts = [volume.estimated ? "US monthly estimate" : "US monthly"];
    if (volume.property) detailParts.push(volume.property);
    if (source) detailParts.push(source);
    return {
      className: "ready",
      value: compactVolume(Number(volume.volume)),
      detail: detailParts.join(" · "),
      title: `${volume.estimated ? "Estimated" : "Provider-backed"} monthly YouTube search traffic from ${source}.`,
    };
  }
  if (volume?.source === "not_configured" || volume?.error) {
    return {
      className: "missing",
      value: "--/mo",
      detail: "No saved volume",
      title: "Actual YouTube search volume needs a volume provider export or KEYWORDTOOL_API_KEY. Trends data is not used as volume.",
    };
  }
  if (error) {
    if (/offline|server/i.test(error)) {
      return {
        className: "missing",
        value: "--/mo",
        detail: "No saved volume",
        title: "Import a provider export here, or connect KEYWORDTOOL_API_KEY. Trends data is not used as volume.",
      };
    }
    return {
      className: "error",
      value: "Unavailable",
      detail: error,
      title: error,
    };
  }
  return {
    className: "pending",
    value: "--/mo",
    detail: "No saved volume",
    title: "This field only shows provider-backed volume, not Google Trends interest.",
  };
}

function trendMarkup(row) {
  const topic = trendForQuery(row.trendQuery);
  const points = topic?.points || [];
  const path = sparklinePath(points);
  const url = trendsUrl(row.trendQuery);
  const key = row.trendQuery.toLowerCase();
  const cached = points.length > 0;
  const loading = isTrendLoading(row.trendQuery);
  const paused = Date.now() < state.trendFetchPausedUntil;
  const error = state.trendErrors[key] || (!cached && paused ? state.trendFetchPausedReason : "");
  const status = cached ? trendSummary(points) : loading ? "loading..." : "open live chart";
  const source = cached ? "Google Trends" : error ? "Google rate limited" : loading ? "fetching Trends" : "not cached yet";
  const line = cached
    ? `<path class="trend-line" d="${path}" />`
    : `<path class="trend-line muted" d="M0 28 C24 28 32 12 54 18 S92 29 138 14" />`;
  return `
    <div class="trend ${cached ? "" : "pending"} ${loading ? "loading" : ""} ${error ? "error" : ""}">
      <div class="trend-top">
        <span>YT Search 12m</span>
        <a href="${url}" target="_blank" rel="noreferrer">${escapeHtml(row.trendQuery)}</a>
      </div>
      <svg class="trend-chart" viewBox="0 0 138 36" role="img" aria-label="Google Trends YouTube Search interest for ${escapeHtml(row.trendQuery)}">
        <path class="trend-grid" d="M0 9.5H138 M0 22.5H138" />
        ${line}
      </svg>
      <div class="trend-foot">
        <span>${escapeHtml(status)}</span>
        <span title="${escapeHtml(error || source)}">${escapeHtml(source)}</span>
      </div>
    </div>
  `;
}

function normalizeKeyword(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function localCloudState(keys = CLOUD_STATE_STORAGE_KEYS) {
  return Object.fromEntries(keys
    .map((key) => [key, localStorage.getItem(key)])
    .filter(([, value]) => value !== null));
}

async function putCloudState(items, onlyIfMissing = false) {
  if (!items || !Object.keys(items).length) return;
  const response = await fetch(CLOUD_STATE_API_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items,
      onlyIfMissing,
      sourceOrigin: window.location.origin,
    }),
  });
  if (!response.ok) throw new Error(`Cloud state save failed (${response.status}).`);
}

function scheduleCloudStateSave(...keys) {
  keys.filter((key) => CLOUD_STATE_STORAGE_KEYS.includes(key)).forEach((key) => pendingCloudStateKeys.add(key));
  window.clearTimeout(cloudStateSaveTimer);
  cloudStateSaveTimer = window.setTimeout(async () => {
    const queuedKeys = [...pendingCloudStateKeys];
    pendingCloudStateKeys.clear();
    try {
      await putCloudState(localCloudState(queuedKeys));
    } catch (error) {
      console.warn("YouTube Gen cloud state sync deferred.", error);
    }
  }, 250);
}

async function hydrateCloudState() {
  const localItems = localCloudState();
  const isVercelOrigin = window.location.hostname.endsWith(".vercel.app");
  try {
    if (isVercelOrigin && Object.keys(localItems).length) {
      await putCloudState(localItems, true);
    }
    let response = await fetch(CLOUD_STATE_API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cloud state load failed (${response.status}).`);
    let payload = await response.json();
    let remoteItems = payload?.items && typeof payload.items === "object" ? payload.items : {};

    if (!Object.keys(remoteItems).length && Object.keys(localItems).length) {
      await putCloudState(localItems, true);
      response = await fetch(CLOUD_STATE_API_URL, { cache: "no-store" });
      if (response.ok) {
        payload = await response.json();
        remoteItems = payload?.items && typeof payload.items === "object" ? payload.items : {};
      }
    }
    for (const [key, value] of Object.entries(remoteItems)) {
      if (CLOUD_STATE_STORAGE_KEYS.includes(key) && typeof value === "string") {
        localStorage.setItem(key, value);
      }
    }
  } catch (error) {
    console.warn("YouTube Gen is using its local state until cloud sync is available.", error);
  }
}

async function loadCloudOutlierRows() {
  try {
    const response = await fetch("/api/cloud/youtube-gen/outliers", { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload?.outliers)) return [];
    return payload.outliers.map((item) => ({
      ...(item?.raw && typeof item.raw === "object" ? item.raw : {}),
      id: item?.ytVideoId || item?.raw?.id,
      title: item?.title || item?.raw?.title,
      thumbnail: item?.thumbnailUrl || item?.raw?.thumbnail,
      url: item?.url || item?.raw?.url,
      views: Number(item?.views ?? item?.raw?.views ?? 0),
      channel_median_views: Number(item?.channelMedianViews ?? item?.raw?.channel_median_views ?? 0),
      outlier_score: Number(item?.outlierScore ?? item?.raw?.outlier_score ?? 0),
      channel: item?.competitorName || item?.raw?.channel,
      channel_handle: item?.competitorHandle || item?.raw?.channel_handle,
      channel_subscribers: Number(item?.subs ?? item?.raw?.channel_subscribers ?? 0),
    })).filter((row) => row.id);
  } catch {
    return [];
  }
}

function loadCustomKeywords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEYWORDS_STORAGE) || "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Map(parsed.map((value) => [normalizeKeyword(value).toLowerCase(), normalizeKeyword(value)])).values()]
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveCustomKeywords() {
  localStorage.setItem(CUSTOM_KEYWORDS_STORAGE, JSON.stringify(state.customKeywords));
  scheduleCloudStateSave(CUSTOM_KEYWORDS_STORAGE);
}

function loadStoredList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeRecoveredPackage(existing, recovered) {
  if (!existing) return recovered;
  return {
    ...recovered,
    ...existing,
    approvals: {
      ...(recovered.approvals || {}),
      ...(existing.approvals || {}),
    },
    assets: {
      ...(recovered.assets || {}),
      ...(existing.assets || {}),
      avatarVideo: existing.assets?.avatarVideo || recovered.assets?.avatarVideo,
    },
  };
}

function mergeRecoveredProject(existing, recovered) {
  if (!existing) return recovered;
  return {
    ...recovered,
    ...existing,
    package: mergeRecoveredPackage(existing.package, recovered.package),
  };
}

function mergeRecoveredList(existingList, recoveryList, mergeFn, limit) {
  const byId = new Map();
  const orderedIds = [];
  const remember = (item) => {
    if (!item?.id) return;
    if (!orderedIds.includes(item.id)) orderedIds.push(item.id);
    byId.set(item.id, item);
  };
  recoveryList.forEach((item) => {
    if (!item?.id) return;
    remember(mergeFn(existingList.find((existing) => existing?.id === item.id), item));
  });
  existingList.forEach((item) => {
    if (!item?.id) return;
    if (byId.has(item.id)) return;
    remember(item);
  });
  return orderedIds.map((id) => byId.get(id)).filter(Boolean).slice(0, limit);
}

function loadRefreshedRows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REFRESHED_ROWS_STORAGE) || "null");
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

function saveRefreshedRows(rows, generatedAt = "") {
  try {
    localStorage.setItem(REFRESHED_ROWS_STORAGE, JSON.stringify({
      generatedAt: generatedAt || new Date().toISOString(),
      rows,
    }));
    scheduleCloudStateSave(REFRESHED_ROWS_STORAGE);
  } catch {
    // Browser storage can fill up, but refresh should still update the live view.
  }
}

function mergeRowsById(...rowGroups) {
  const byId = new Map();
  rowGroups.flat().filter(Boolean).forEach((row) => {
    if (!row?.id) return;
    byId.set(row.id, {
      ...(byId.get(row.id) || {}),
      ...row,
    });
  });
  return Array.from(byId.values());
}

function seedRecoveredFactoryData(packages, projects) {
  const recoveryPackages = Array.isArray(window.YOUTUBE_GEN_RECOVERY_PACKAGES)
    ? window.YOUTUBE_GEN_RECOVERY_PACKAGES
    : [];
  const recoveryProjects = Array.isArray(window.YOUTUBE_GEN_RECOVERY_PROJECTS)
    ? window.YOUTUBE_GEN_RECOVERY_PROJECTS
    : [];
  if (!recoveryPackages.length && !recoveryProjects.length) {
    return { packages, projects };
  }

  const mergedPackages = mergeRecoveredList(packages, recoveryPackages, mergeRecoveredPackage, 20);
  const mergedProjects = mergeRecoveredList(projects, recoveryProjects, mergeRecoveredProject, 50);
  localStorage.setItem(REMAKE_PROJECTS_STORAGE, JSON.stringify(mergedProjects));
  localStorage.setItem(RECOVERY_SEED_STORAGE, "true");
  scheduleCloudStateSave(REMAKE_PROJECTS_STORAGE);
  return { packages: mergedPackages, projects: mergedProjects };
}

function applyRecoveredFactoryDefaults() {
  const recoveredPackage = state.remakePackages.find((item) => item?.id === "remake_recovered_higgsfield_claude_factory");
  if (!recoveredPackage) return;
  state.selectedRemakeVideoId = recoveredPackage.approvals?.sourceVideoId || recoveredPackage.sourceVideos?.[0]?.id || state.selectedRemakeVideoId;
  if (!state.packageStep || state.packageStep === "source") {
    state.packageStep = "thumbnail";
  }
}

function saveIdeas() {
  localStorage.setItem(IDEAS_STORAGE, JSON.stringify(state.ideas));
  scheduleCloudStateSave(IDEAS_STORAGE);
}

function saveRemakePackages() {
  localStorage.setItem(REMAKE_PACKAGES_STORAGE, JSON.stringify(state.remakePackages.slice(0, 20)));
}

function clearActiveFactoryStorage() {
  localStorage.removeItem(REMAKE_PACKAGES_STORAGE);
}

function saveRemakeProjects() {
  localStorage.setItem(REMAKE_PROJECTS_STORAGE, JSON.stringify(state.savedProjects.slice(0, 50)));
  scheduleCloudStateSave(REMAKE_PROJECTS_STORAGE);
}

function latestPackage() {
  return state.remakePackages[0] || null;
}

function autosaveCurrentProject(options = {}) {
  const current = latestPackage();
  if (!current) return null;
  const projectId = current.projectId || `project_${Date.now()}`;
  const existing = state.savedProjects.find((item) => item.id === projectId);
  const packageData = { ...current, projectId };
  const project = {
    id: projectId,
    name: projectTitleForPackage(packageData),
    createdAt: existing?.createdAt || packageData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    package: packageData,
    selectedRemakeVideoId: state.selectedRemakeVideoId || packageData.approvals?.sourceVideoId || packageData.sourceVideos?.[0]?.id || "",
    packageStep: state.packageStep || existing?.packageStep || "titles",
    thumbnailPromptIndex: state.thumbnailPromptIndex || existing?.thumbnailPromptIndex || 1,
  };
  state.savedProjects = [
    project,
    ...state.savedProjects.filter((item) => item.id !== projectId),
  ].slice(0, 50);
  state.remakePackages = [packageData, ...state.remakePackages.slice(1)];
  saveRemakeProjects();
  saveRemakePackages();
  if (options.status) {
    state.channelError = "";
    state.channelStatus = options.status === true ? `Auto-saved project: ${project.name}` : options.status;
  }
  return project;
}

function updateLatestPackage(updater) {
  const current = latestPackage();
  if (!current) return;
  const next = updater(current);
  state.remakePackages = [next, ...state.remakePackages.slice(1)];
  autosaveCurrentProject();
}

function projectTitleForPackage(packageData) {
  const approvedTitle = Number.isInteger(packageData?.approvals?.titleIndex)
    ? packageData.titles?.[packageData.approvals.titleIndex]
    : "";
  return normalizeKeyword(approvedTitle || packageData?.titles?.[0] || packageData?.topicAngle || "Untitled remake project");
}

function saveCurrentProject() {
  const current = latestPackage();
  if (!current) {
    state.channelError = "Generate a package before saving a project.";
    state.channelStatus = "";
    update();
    return;
  }
  const project = autosaveCurrentProject();
  state.channelStatus = project ? `Saved project: ${project.name}` : "";
  update();
}

function loadSavedProject(projectId) {
  const project = state.savedProjects.find((item) => item.id === projectId);
  if (!project?.package) return;
  state.view = "ideas";
  state.remakePackages = [project.package];
  state.selectedRemakeVideoId = project.selectedRemakeVideoId || project.package.approvals?.sourceVideoId || project.package.sourceVideos?.[0]?.id || "";
  state.packageStep = project.packageStep || "titles";
  state.thumbnailPromptIndex = project.thumbnailPromptIndex || 1;
  state.ideaProgress = null;
  state.assetProgress = null;
  state.ideaGenerationLoading = false;
  state.assetGenerationLoading = false;
  state.assetGenerationTarget = null;
  applyEditorDraftFromPackage(project.package);
  saveRemakePackages();
  state.channelError = "";
  state.channelStatus = `Loaded project: ${project.name}`;
  update();
}

function removeSavedProject(projectId) {
  const project = state.savedProjects.find((item) => item.id === projectId);
  state.savedProjects = state.savedProjects.filter((item) => item.id !== projectId);
  saveRemakeProjects();
  state.channelError = "";
  state.channelStatus = project ? `Removed saved project: ${project.name}` : "Saved project removed.";
  update();
}

function savePerformanceLogs() {
  localStorage.setItem(PERFORMANCE_STORAGE, JSON.stringify(state.performanceLogs));
  scheduleCloudStateSave(PERFORMANCE_STORAGE);
}

function loadChannelsHidden() {
  return localStorage.getItem(CHANNELS_HIDDEN_STORAGE) !== "false";
}

function saveChannelsHidden() {
  localStorage.setItem(CHANNELS_HIDDEN_STORAGE, state.channelsHidden ? "true" : "false");
  scheduleCloudStateSave(CHANNELS_HIDDEN_STORAGE);
}

function loadKeywordVolumeOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEYWORD_VOLUME_OVERRIDES_STORAGE) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => Number.isFinite(Number(value?.volume))));
  } catch {
    return {};
  }
}

function saveKeywordVolumeOverrides() {
  localStorage.setItem(KEYWORD_VOLUME_OVERRIDES_STORAGE, JSON.stringify(state.keywordVolumeOverrides));
  scheduleCloudStateSave(KEYWORD_VOLUME_OVERRIDES_STORAGE);
}

function loadKeywordToolApiKey() {
  return localStorage.getItem(KEYWORDTOOL_API_KEY_STORAGE) || "";
}

function saveKeywordToolApiKey(value) {
  const key = String(value || "").trim();
  if (key) localStorage.setItem(KEYWORDTOOL_API_KEY_STORAGE, key);
}

function loadKieApiKey() {
  return localStorage.getItem(KIE_API_KEY_STORAGE) || localStorage.getItem("muapi_key") || "";
}

function saveKieApiKey(value) {
  const key = String(value || "").trim();
  if (key) {
    localStorage.setItem(KIE_API_KEY_STORAGE, key);
    localStorage.setItem("muapi_key", key);
  } else {
    localStorage.removeItem(KIE_API_KEY_STORAGE);
    localStorage.removeItem("muapi_key");
  }
}

function parseVolumeNumber(raw) {
  const text = String(raw || "").trim().replaceAll(",", "");
  if (!text) return NaN;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!match) return NaN;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return NaN;
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "m") return base * 1_000_000;
  if (suffix === "k") return base * 1_000;
  return base;
}

function volumeImportRecord(query, volume, source = "Imported provider file") {
  return {
    query,
    volume: Math.round(volume),
    source,
    country: "US",
    property: "YouTube Search",
    imported: true,
    fetchedAt: new Date().toISOString(),
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseVolumeRows(rows) {
  if (!rows.length) return {};
  const normalizedHeader = rows[0].map((cell) => cell.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const keywordIndex = normalizedHeader.findIndex((cell) => ["keyword", "query", "term", "searchterm"].includes(cell));
  const volumeIndex = normalizedHeader.findIndex((cell) => [
    "volume",
    "searchvolume",
    "ytvolume",
    "youtubevolume",
    "monthlysearches",
    "avgmonthlysearches",
    "averagemonthlysearches",
  ].includes(cell));
  const hasHeader = keywordIndex !== -1 && volumeIndex !== -1;
  const keywordCol = hasHeader ? keywordIndex : 0;
  const volumeCol = hasHeader ? volumeIndex : 1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const records = {};
  for (const row of dataRows) {
    const query = normalizeKeyword(row[keywordCol]);
    const volume = parseVolumeNumber(row[volumeCol]);
    if (!query || !Number.isFinite(volume)) continue;
    records[query] = volumeImportRecord(query, volume);
  }
  return records;
}

function parseVolumeImport(text, fileName = "") {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (/\.json$/i.test(fileName) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    const entries = Array.isArray(parsed)
      ? parsed.map((item) => [item.keyword || item.query || item.term, item.volume || item.search_volume || item.youtube_volume])
      : Object.entries(parsed).map(([query, value]) => [query, typeof value === "object" ? value.volume || value.search_volume || value.youtube_volume : value]);
    return Object.fromEntries(entries.flatMap(([query, value]) => {
      const normalized = normalizeKeyword(query);
      const volume = parseVolumeNumber(value);
      return normalized && Number.isFinite(volume) ? [[normalized, volumeImportRecord(normalized, volume)]] : [];
    }));
  }
  return parseVolumeRows(parseCsvRows(trimmed));
}

function slugText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function rowMetric(row, metric = state.metric) {
  if (metric === "velocity") return Number(row.views_per_day_vs_median || 0);
  if (metric === "combined") return Number(row.outlier_score || Math.max(row.outlierMultiple || 0, row.views_per_day_vs_median || 0));
  return Number(row.outlierMultiple || 0);
}

function metricLabel(metric = state.metric) {
  if (metric === "velocity") return "velocity";
  if (metric === "combined") return "combined";
  return "views";
}

function metricStatsText(row) {
  if (state.metric === "velocity") {
    return `${compactNumber(row.views_per_day || 0)}/day vs ${compactNumber(row.channel_median_views_per_day || 0)}/day median`;
  }
  if (state.metric === "combined") {
    return `${Number(row.outlier_score || 0).toFixed(2)} score, ${Number(row.outlierMultiple || 0).toFixed(2)}x views`;
  }
  return `${compactNumber(row.views)} views vs ${compactNumber(row.avgViews)} avg`;
}

function channelSummary(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.channel_key)) {
      map.set(row.channel_key, {
        key: row.channel_key,
        name: row.channel,
        count: 0,
        median: Number(row.channel_median_views || 0),
      });
    }
    map.get(row.channel_key).count += 1;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function initialsForChannel(name) {
  const words = String(name || "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) return "YT";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function colorForKey(key) {
  let hash = 0;
  for (const char of String(key || "")) hash = ((hash << 5) - hash) + char.charCodeAt(0);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 54% 34%)`;
}

function renderChips() {
  const channels = channelSummary(state.rows);
  els.chips.innerHTML = channels.map((channel) => {
    const [initials, color] = channelStyles[channel.key] || [initialsForChannel(channel.name), colorForKey(channel.key)];
    const active = state.selectedChannels.has(channel.key) ? " active" : "";
    const removing = state.channelRemoving.has(channel.key);
    return `
      <span class="chip${active}${removing ? " removing" : ""}">
        <button class="chip-select" type="button" data-channel="${escapeHtml(channel.key)}">
          <span class="avatar" style="background:${color}; color:#fff">${escapeHtml(initials)}</span>
          <span class="name">${escapeHtml(channel.name)}</span>
          <span class="count">${compactNumber(channel.median)}</span>
        </button>
        <button class="chip-remove-channel" type="button" data-remove-channel="${escapeHtml(channel.key)}" aria-label="Remove ${escapeHtml(channel.name)}">x</button>
      </span>
    `;
  }).join("");
}

function mergeRows(newRows) {
  const incoming = newRows.map(enrich);
  if (!incoming.length) return;
  const channelKey = incoming[0].channel_key;
  const incomingIds = new Set(incoming.map((row) => row.id));
  state.rows = [
    ...incoming,
    ...state.rows.filter((row) => row.channel_key !== channelKey && !incomingIds.has(row.id)),
  ];
}

function passesDate(row) {
  if (state.date === "all") return true;
  const days = Number(state.date);
  return Number(row.ageDays ?? 99999) <= days;
}

function passesDuration(row) {
  const minutes = Number(row.duration_seconds || 0) / 60;
  if (state.duration === "short") return minutes < 15;
  if (state.duration === "medium") return minutes >= 15 && minutes < 30;
  if (state.duration === "long") return minutes >= 30;
  return true;
}

function passesSearch(row) {
  const q = state.search.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${row.title} ${row.channel} ${channelHandle(row)} ${row.pattern} ${(row.tokens || []).join(" ")}`.toLowerCase();
  return haystack.includes(q.replace(/^@/, ""));
}

function filteredRows() {
  const selected = state.selectedChannels;
  let rows = state.rows.filter((row) => {
    if (selected.size && !selected.has(row.channel_key)) return false;
    if (!passesSearch(row)) return false;
    if (!passesDate(row)) return false;
    if (!passesDuration(row)) return false;
    if (Number(row.views || 0) < state.minViews) return false;
    if (state.onlyOutliers && rowMetric(row) < 3) return false;
    return true;
  });

  if (state.sort === "viewAll") return sortViewAllRows(rows);

  rows = rows.sort((a, b) => {
    if (state.sort === "uploaded") return b.uploadTime - a.uploadTime;
    if (state.sort === "views") return b.views - a.views;
    if (state.sort === "viewsMultiple") return Number(b.outlierMultiple || 0) - Number(a.outlierMultiple || 0);
    if (state.sort === "velocityMultiple") return Number(b.views_per_day_vs_median || 0) - Number(a.views_per_day_vs_median || 0);
    if (state.sort === "combinedScore") return Number(b.outlier_score || 0) - Number(a.outlier_score || 0);
    if (state.sort === "outlier") return rowMetric(b) - rowMetric(a);
    if (state.sort === "velocity") return Number(b.views_per_day || 0) - Number(a.views_per_day || 0);
    return b.uploadTime - a.uploadTime;
  });

  return rows;
}

function sortViewAllRows(rows) {
  return [...rows].sort((a, b) => (
    rowMetric(b) - rowMetric(a)
    || Number(b.views || 0) - Number(a.views || 0)
    || b.uploadTime - a.uploadTime
  ));
}

function resultTitle(rows) {
  if (state.selectedChannels.size === 1) {
    const key = [...state.selectedChannels][0];
    const row = state.rows.find((item) => item.channel_key === key);
    return row ? row.channel : "Selected Channel";
  }
  if (state.selectedChannels.size > 1) return `${state.selectedChannels.size} Channels`;
  return "Outliers";
}

function selectedOptionLabel(select, fallback = "") {
  return select?.selectedOptions?.[0]?.textContent?.trim() || fallback;
}

function activeFilterLabels() {
  const labels = [];
  if (state.date !== "all") labels.push(selectedOptionLabel(els.date, `Last ${state.date} days`));
  if (state.duration !== "all") labels.push(selectedOptionLabel(els.duration, state.duration));
  if (Number(state.minViews || 0) > 0) labels.push(selectedOptionLabel(els.minViews, `${compactNumber(state.minViews)}+ views`));
  if (state.onlyOutliers) labels.push("Only outliers 3x+");
  return labels;
}

function renderCards() {
  const rows = filteredRows();
  els.grid.className = "grid";
  els.resultTitle.textContent = resultTitle(rows);
  const channelCount = new Set(rows.map((row) => row.channel_key)).size;
  const filters = activeFilterLabels();
  const filterPrefix = filters.length ? `${filters.join(" · ")}: ` : "";
  els.resultMeta.textContent = `${filterPrefix}${rows.length} videos from ${channelCount} channel${channelCount === 1 ? "" : "s"}${state.selectedVideos.size ? `, ${state.selectedVideos.size} selected` : ""}`;

  if (!rows.length) {
    const emptyContext = filters.length ? ` for ${filters.join(", ")}` : "";
    els.grid.innerHTML = `<div class="empty">No videos match these filters${emptyContext}.</div>`;
    return;
  }

  els.grid.innerHTML = rows.map((row, index) => {
    const multiple = rowMetric(row);
    const badgeClass = multiple >= 3 ? "hot" : multiple >= 1.5 ? "warm" : "";
    const handle = channelHandle(row);
    const age = rowAgeLabel(row);
    const date = prettyDate(row.upload_date);
    const loading = index < 16 ? "eager" : "lazy";
    const priority = index < 8 ? ' fetchpriority="high"' : "";
    const selected = state.selectedVideos.has(row.id);
    return `
      <article class="card${selected ? " selected" : ""}">
        <a class="thumb-link video-open-link" href="${row.url}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(row.title)} on YouTube">
          <img class="thumb" src="${row.thumbnail}" alt="" loading="${loading}"${priority} />
          <span class="duration">${formatDuration(row.duration_seconds)}</span>
        </a>
        <button class="select-video${selected ? " active" : ""}" type="button" data-select-video="${escapeHtml(row.id)}">${selected ? "Selected" : "Select"}</button>
        <button class="title video-title-link factory-title-link" type="button" data-send-to-factory="${escapeHtml(row.id)}" title="Send to Factory">${escapeHtml(row.title)}</button>
        <div class="meta">
          <span class="channel">${handle}</span>
          <span class="dot">•</span>
          <span>${compactNumber(row.avgViews)} avg</span>
        </div>
        <div class="upload">${age}${date ? ` (${date})` : ""}</div>
        <div class="stats">
          <span class="badge ${badgeClass}">${multiple.toFixed(2)}x</span>
          <span class="statline">${escapeHtml(metricStatsText(row))}</span>
        </div>
        ${trendMarkup(row)}
      </article>
    `;
  }).join("");
  queueMicrotask(() => queueVisibleTrendLoads(rows));
}

function queueVisibleTrendLoads(rows) {
  if (Date.now() < state.trendFetchPausedUntil) return;
  const missing = [];
  const seen = new Set();
  for (const row of rows.slice(0, 36)) {
    const query = normalizeKeyword(row.trendQuery);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    const topic = trendForQuery(query);
    if (topic?.points?.length) continue;
    if (state.trendLoading.has(key) || state.trendErrors[key]) continue;
    missing.push(query);
    if (missing.length >= 3) break;
  }
  missing.forEach((query) => loadTrendData(query));
}

function keywordItems() {
  const map = new Map();
  const putItem = (query, props = {}) => {
    const normalized = normalizeKeyword(query);
    const key = normalized.toLowerCase();
    if (!normalized || map.has(key)) return map.get(key);
    const item = {
      query: normalized,
      trend: trendForQuery(normalized),
      videos: [],
      videoIds: new Set(),
      count: 0,
      views: 0,
      topOutlier: 0,
      ...props,
    };
    map.set(key, item);
    return item;
  };
  const addVideo = (item, row) => {
    if (!item || !row?.id || item.videoIds.has(row.id)) return;
    item.videoIds.add(row.id);
    item.videos.push(row);
    item.count += 1;
    item.views += Number(row.views || 0);
    item.topOutlier = Math.max(item.topOutlier, Number(row.outlierMultiple || 0));
  };

  for (const query of FOCUS_KEYWORDS) {
    putItem(query, { focus: true });
  }
  for (const query of state.customKeywords) {
    putItem(query, { custom: true });
  }
  for (const row of state.rows) {
    const query = row.trendQuery;
    addVideo(putItem(query), row);
    for (const item of map.values()) {
      if ((item.focus || item.custom) && rowMatchesKeyword(row, item.query)) addVideo(item, row);
    }
  }

  let items = [...map.values()];
  const q = state.search.trim().toLowerCase().replace(/^@/, "");
  if (q) {
    items = items.filter((item) => {
      const haystack = `${item.query} ${item.videos.map((row) => `${row.title} ${row.channel}`).join(" ")}`.toLowerCase();
      return haystack.includes(q);
    });
  }

  items = items.map((item) => {
    const points = item.trend?.points || [];
    const values = points.map((point) => Number(point.value)).filter(Number.isFinite);
    const latest = values.length ? values.at(-1) : 0;
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const topVideo = [...item.videos].sort((a, b) => Number(b.outlierMultiple || 0) - Number(a.outlierMultiple || 0))[0];
    const { videoIds, ...safeItem } = item;
    return { ...safeItem, points, latest, avg, topVideo };
  });

  items.sort((a, b) => {
    if (state.sort === "keywordVideos") return b.count - a.count || b.views - a.views;
    if (state.sort === "views") return b.views - a.views;
    if (state.sort === "viewsMultiple") return b.topOutlier - a.topOutlier;
    if (state.sort === "velocityMultiple") return b.latest - a.latest;
    if (state.sort === "combinedScore") return b.topOutlier - a.topOutlier || b.latest - a.latest;
    if (state.sort === "outlier") return b.topOutlier - a.topOutlier;
    if (state.sort === "velocity") return b.latest - a.latest;
    return a.query.localeCompare(b.query);
  });

  return items;
}

function rowMatchesKeyword(row, query) {
  const haystack = [
    row.title,
    row.trendQuery,
    row.pattern,
    ...(row.tokens || []),
  ].join(" ").toLowerCase();
  const normalized = normalizeKeyword(query).toLowerCase();
  if (!normalized) return false;
  if (haystack.includes(normalized)) return true;
  const stop = new Set(["how", "to", "use"]);
  const parts = normalized.split(/\s+/).filter((part) => part.length > 1 && !stop.has(part));
  if (!parts.length) return false;
  return parts.every((part) => haystack.includes(part));
}

async function loadTrendData(query) {
  const existingTrend = trendForQuery(query);
  if (!query || existingTrend?.points?.length) {
    if (query && existingTrend) state.trends[query] = existingTrend;
    return;
  }
  if (!TREND_API_URLS.length) return;
  if (Date.now() < state.trendFetchPausedUntil) return;
  const key = query.toLowerCase();
  if (state.trendLoading.has(key)) return;
  state.trendLoading.add(key);
  delete state.trendErrors[key];
  update();
  let lastError = "";
  try {
    for (const apiUrl of TREND_API_URLS) {
      try {
        const response = await fetch(`${apiUrl}?q=${encodeURIComponent(query)}`);
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Trend fetch failed with ${response.status}`);
        }
        state.trends[query] = payload.topic;
        if (payload.topic?.query) state.trends[payload.topic.query] = payload.topic;
        return;
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Trend server is not running.");
  } catch (error) {
    const offline = /Failed to fetch|NetworkError|Load failed/i.test(error.message);
    if (/429|rate.?limit/i.test(error.message)) {
      state.trendFetchPausedUntil = Date.now() + 10 * 60 * 1000;
      state.trendFetchPausedReason = "Google Trends rate-limited the local fetch. The live chart still opens.";
    }
    state.trendErrors[key] = offline
      ? "Trend server offline. Start the local outlier viewer server, then retry this keyword."
      : error.message;
  } finally {
    state.trendLoading.delete(key);
    update();
  }
}

async function loadKeywordVolumeData(query) {
  if (state.keywordToolApiKey) {
    return fetchKeywordVolumeBatch([{ query }], true);
  }
  const existing = keywordVolumeForQuery(query);
  if (!query || existing) return;
  const key = query.toLowerCase();
  if (state.keywordVolumeLoading.has(key)) return;
  state.keywordVolumeLoading.add(key);
  delete state.keywordVolumeErrors[key];
  update();
  let lastError = "";
  try {
    for (const apiUrl of KEYWORD_VOLUME_API_URLS) {
      try {
        const response = await fetch(`${apiUrl}?q=${encodeURIComponent(query)}`);
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Keyword volume fetch failed with ${response.status}`);
        }
        state.keywordVolumes[query] = payload.volume;
        if (payload.volume?.query) state.keywordVolumes[payload.volume.query] = payload.volume;
        return;
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Keyword volume server is not running.");
  } catch (error) {
    const offline = /Failed to fetch|NetworkError|Load failed/i.test(error.message);
    state.keywordVolumeErrors[key] = offline
      ? "Keyword volume server offline."
      : error.message;
  } finally {
    state.keywordVolumeLoading.delete(key);
    update();
  }
}

function queueKeywordVolumeLoads(items) {
  const missing = items
    .slice(0, 40)
    .filter((item) => !keywordVolumeForQuery(item.query) && !state.keywordVolumeErrors[item.query.toLowerCase()]);
  if (missing.length) fetchKeywordVolumeBatch(missing, true);
}

async function fetchKeywordVolumeBatch(items, force = true) {
  const queries = [...new Set(items.map((item) => normalizeKeyword(item.query)).filter(Boolean))];
  if (!queries.length || state.keywordVolumeBatchLoading) return;
  state.keywordVolumeBatchLoading = true;
  state.channelError = "";
  state.channelStatus = `Fetching YouTube volume for ${queries.length} keywords...`;
  update();
  let lastError = "";
  try {
    for (const apiUrl of KEYWORD_VOLUME_BATCH_API_URLS) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keywords: queries,
            apiKey: state.keywordToolApiKey,
            force,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Keyword volume fetch failed with ${response.status}`);
        }
        for (const [query, volume] of Object.entries(payload.volumes || {})) {
          state.keywordVolumes[query] = volume;
          if (volume?.query) state.keywordVolumes[volume.query] = volume;
        }
        if (payload.missingApiKey) {
          state.channelError = "Paste a Keyword Tool API key to fetch actual YouTube monthly volume.";
          state.channelStatus = "";
        } else {
          const fetchedCount = Object.values(payload.volumes || {}).filter((volume) => volume?.volume !== null && volume?.volume !== undefined).length;
          state.channelStatus = payload.freeEstimate
            ? `Loaded free YouTube volume estimates for ${fetchedCount} keywords.`
            : `Loaded real YouTube volume for ${fetchedCount} keywords.`;
          state.channelError = "";
        }
        return;
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Local volume endpoint is not reachable.");
  } catch (error) {
    const offline = /Failed to fetch|NetworkError|Load failed|not reachable/i.test(error.message);
    state.channelError = offline
      ? "Local volume endpoint is not open."
      : error.message;
    state.channelStatus = "";
  } finally {
    state.keywordVolumeBatchLoading = false;
    update();
  }
}

async function loadChannelData(channelInput) {
  const value = normalizeKeyword(channelInput);
  if (!value || state.channelLoading) return;
  state.channelLoading = true;
  state.channelError = "";
  state.channelStatus = "Loading channel...";
  update();

  let lastError = "";
  try {
    for (const apiUrl of CHANNEL_API_URLS) {
      try {
        const response = await fetch(`${apiUrl}?url=${encodeURIComponent(value)}`);
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Channel fetch failed with ${response.status}`);
        }
        mergeRows(payload.rows || []);
        state.view = "videos";
        state.selectedChannels.clear();
        if (payload.channel?.key) state.selectedChannels.add(payload.channel.key);
        state.search = "";
        state.date = "all";
        state.duration = "all";
        state.minViews = 0;
        state.onlyOutliers = false;
        state.sort = "viewAll";
        els.search.value = "";
        els.date.value = "all";
        els.duration.value = "all";
        els.minViews.value = "0";
        els.onlyOutliers.checked = false;
        els.sort.value = "viewAll";
        state.channelStatus = `Added ${payload.channel?.name || "channel"}: ${payload.channel?.count || 0} videos`;
        return;
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Channel fetch failed.");
  } catch (error) {
    state.channelError = error.message;
    state.channelStatus = "";
  } finally {
    state.channelLoading = false;
    update();
  }
}

function updateChannelRefreshProgress(event) {
  const total = Number(event.total || state.channelRefreshProgress?.total || 0);
  const completed = Number(event.completed || state.channelRefreshProgress?.completed || 0);
  const refreshed = Number(event.refreshed || 0);
  const errors = Number(event.errors || 0);
  const percent = Math.max(0, Math.min(100, Number(event.percent || 0)));
  state.channelRefreshProgress = {
    percent,
    step: event.step || "Refreshing channels",
    detail: event.detail || "",
    channel: event.channel || "",
    total,
    completed,
    refreshed,
    errors,
  };
  const countText = total ? `${completed}/${total}` : "starting";
  const issueText = errors ? `, ${errors} failed` : "";
  state.channelStatus = `${state.channelRefreshProgress.step}: ${countText} channels, ${refreshed} refreshed${issueText}. ${state.channelRefreshProgress.detail}`.trim();
}

function channelRefreshStatusMarkup() {
  const progress = state.channelRefreshProgress;
  if (!progress) return escapeHtml(state.channelError || state.channelStatus || "");
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  const countText = progress.total ? `${progress.completed}/${progress.total} channels` : "Starting";
  const issueText = progress.errors ? `, ${progress.errors} failed` : "";
  return `
    <div class="refresh-progress">
      <div class="refresh-progress-top">
        <strong>${escapeHtml(progress.step || "Refreshing")}</strong>
        <span>${Math.round(percent)}%</span>
      </div>
      <div class="refresh-progress-track"><span style="width:${percent}%"></span></div>
      <div class="refresh-progress-detail">${escapeHtml(`${countText}, ${progress.refreshed || 0} refreshed${issueText}. ${progress.detail || ""}`)}</div>
    </div>
  `;
}

async function refreshAllChannels(options = {}) {
  const preserveView = options && typeof options === "object" && !("type" in options)
    ? options.preserveView
    : "";
  const stayInFactory = preserveView === "factory";
  if (state.channelRefreshing || state.channelLoading) return;
  state.channelRefreshing = true;
  state.channelError = "";
  state.channelRefreshProgress = {
    percent: 0,
    step: "Starting refresh",
    detail: "Preparing saved channel list...",
    completed: 0,
    total: 0,
    refreshed: 0,
    errors: 0,
  };
  state.channelStatus = "Starting refresh: preparing saved channel list...";
  update();

  let lastError = "";
  try {
    for (const apiUrl of CHANNEL_REFRESH_API_URLS) {
      try {
        const response = await fetch(apiUrl, { method: "POST" });
        let payload;
        if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
          payload = await readProgressStream(response, updateChannelRefreshProgress, "refresh");
        } else {
          payload = await response.json();
        }
        if (!response.ok || !payload.ok) {
          const failures = Array.isArray(payload.errors) && payload.errors.length
            ? ` ${payload.errors.slice(0, 2).map((item) => item.name || item.key).join(", ")} failed.`
            : "";
          throw new Error(`${payload.error || `Refresh failed with ${response.status}`}${failures}`);
        }
        state.rows = (payload.rows || []).map(enrich);
        if (payload.rows?.length) saveRefreshedRows(payload.rows, payload.generatedAt);
        state.sourcePoolOffset = 0;
        state.selectedRemakeVideoId = "";
        let sourcePoolNote = "";
        if (stayInFactory) {
          state.view = "ideas";
          sourcePoolNote = widenSourcePoolToNearestMatch();
        } else {
          state.view = "videos";
          state.selectedChannels.clear();
          state.search = "";
          state.date = "all";
          state.duration = "all";
          state.minViews = 0;
          state.onlyOutliers = false;
          state.sort = "viewAll";
          els.search.value = "";
          els.date.value = "all";
          els.duration.value = "all";
          els.minViews.value = "0";
          els.onlyOutliers.checked = false;
          els.sort.value = "viewAll";
        }
        const refreshedCount = payload.refreshed?.length || 0;
        const errorCount = payload.errors?.length || 0;
        const errorNames = Array.isArray(payload.errors)
          ? payload.errors.slice(0, 2).map((item) => item.name || item.key).filter(Boolean).join(", ")
          : "";
        const viewNote = stayInFactory ? ` Factory source pool updated.${sourcePoolNote}` : "";
        const errorNote = errorCount ? `, ${errorCount} failed${errorNames ? ` (${errorNames})` : ""}` : "";
        state.channelStatus = `Refreshed ${refreshedCount} channel${refreshedCount === 1 ? "" : "s"} and loaded ${payload.totalRows || state.rows.length} videos${errorNote}.${viewNote}`;
        state.channelRefreshProgress = null;
        state.channelError = "";
        return;
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Channel refresh failed.");
  } catch (error) {
    state.channelError = error.message;
    state.channelStatus = "";
    state.channelRefreshProgress = null;
  } finally {
    state.channelRefreshing = false;
    update();
  }
}

async function removeChannelData(channelKey, channelName, count) {
  if (!channelKey || state.channelRemoving.has(channelKey)) return;
  const ok = window.confirm(`Remove ${channelName} and ${count} saved video${count === 1 ? "" : "s"} from this list?`);
  if (!ok) return;

  state.channelRemoving.add(channelKey);
  state.channelError = "";
  state.channelStatus = `Removing ${channelName}...`;
  update();

  let lastError = "";
  try {
    for (const apiUrl of CHANNEL_API_URLS) {
      try {
        const response = await fetch(`${apiUrl}?key=${encodeURIComponent(channelKey)}`, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Channel remove failed with ${response.status}`);
        }
        state.rows = state.rows.filter((row) => row.channel_key !== channelKey);
        state.selectedChannels.delete(channelKey);
        state.channelStatus = `Removed ${channelName}: ${payload.removed || 0} videos`;
        return;
      } catch (error) {
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Channel remove failed.");
  } catch (error) {
    state.channelError = error.message;
    state.channelStatus = "";
  } finally {
    state.channelRemoving.delete(channelKey);
    update();
  }
}

function selectedRows() {
  return [...state.selectedVideos]
    .map((id) => state.rows.find((row) => row.id === id))
    .filter(Boolean);
}

function titleCase(value) {
  return String(value || "").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function rowIdeaText(row) {
  return [
    row.title,
    row.description,
    row.pattern,
    row.trendQuery,
    ...(row.tokens || []),
  ].join(" ").toLowerCase();
}

function approvedTopicBuckets(row) {
  const text = rowIdeaText(row);
  const buckets = [];
  if (/\bclaude code\b|\bclaude\b.*\bcode\b|\bcode\b.*\bclaude\b/.test(text)) buckets.push("Claude Code");
  if (/\bseedance\b|\bsee dance\b/.test(text)) buckets.push("Seedance 2.0");
  if (/\bhiggsfield\b|\bcinema studio\b|\bmarketing studio\b/.test(text)) buckets.push("Higgsfield");
  if (/\bugc\b|\bugc ads?\b|\bai ads?\b|\bad generator\b|\bcommercial\b/.test(text)) buckets.push("AI UGC");
  if (/\bai videos?\b|\bai video generator|\bvideo generators?\b|\bai filmmaking\b|\bfilmmaking\b|\banimation\b|\bcinematic\b|\bmusic videos?\b|\bimage to video\b|\bavatar\b/.test(text)) buckets.push("AI Video");
  return [...new Set(buckets)];
}

function contentStyleForRow(row) {
  const title = String(row.title || "").toLowerCase();
  if (/\bstop\b|\bwasting\b|\bwrong\b|\bdo this\b|\bmistakes?\b|\bcredits?\b|\bavoid\b/.test(title)) {
    return "Stop Wasting / Do This Instead";
  }
  if (/\+|\bplus\b|\bwith\b|\bcombo\b|\bworkflow\b|\bmixed\b/.test(title)) {
    return "Tool Combo / Workflow";
  }
  if (/\btested\b|\btried\b|\bevery\b|\bbest tools?\b|\bcomparison\b|\bvs\b|\bversus\b/.test(title)) {
    return "Tested / Tried";
  }
  if (/\bhow to\b|\bguide\b|\btutorial\b|\bstep by step\b|\bstep-by-step\b|\bcourse\b|\bbeginner/.test(title)) {
    return "Tutorial / Full Guide";
  }
  if (/\bbest\b|\bright now\b|\bnew\b|\bchanged\b|\bdestroyed\b|\bnext level\b|\binsane\b|\bgame changer\b/.test(title)) {
    return "Best / New Best / Right Now";
  }
  return row.pattern?.includes("guide/tutorial") ? "Tutorial / Full Guide" : "Best / New Best / Right Now";
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function sourcePoolDays() {
  return Math.round(clampNumber(state.sourcePoolDays, SOURCE_POOL_MIN_DAYS, SOURCE_POOL_MAX_DAYS));
}

function sourcePoolMinMultiple() {
  const value = clampNumber(state.sourcePoolMinMultiple, SOURCE_POOL_MIN_MULTIPLE, SOURCE_POOL_MAX_MULTIPLE);
  return Math.round(value / SOURCE_POOL_MULTIPLE_STEP) * SOURCE_POOL_MULTIPLE_STEP;
}

function formatOutlierMultiple(value) {
  const rounded = Number(value);
  return rounded.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function remakeEligibleRows() {
  const days = sourcePoolDays();
  const minMultiple = sourcePoolMinMultiple();
  return state.rows
    .map((row) => {
      const topicBuckets = approvedTopicBuckets(row);
      return {
        ...row,
        topicBuckets,
        topicBucket: topicBuckets[0] || "",
        contentStyle: contentStyleForRow(row),
      };
    })
    .filter((row) => (
      Number(row.ageDays ?? row.age_days ?? 99999) <= days
      && Number(row.views_vs_median || row.outlierMultiple || 0) >= minMultiple
      && Number(row.duration_seconds || 0) >= LONG_FORM_MIN_SECONDS
    ))
    .sort((a, b) => {
      const score = Number(b.views_vs_median || b.outlierMultiple || 0) - Number(a.views_vs_median || a.outlierMultiple || 0);
      if (score) return score;
      const velocity = Number(b.views_per_day_vs_median || 0) - Number(a.views_per_day_vs_median || 0);
      if (velocity) return velocity;
      return Number(b.uploadTime || 0) - Number(a.uploadTime || 0);
    });
}

function widenSourcePoolToNearestMatch() {
  if (remakeEligibleRows().length) return "";
  const originalDays = state.sourcePoolDays;
  const originalMultiple = state.sourcePoolMinMultiple;
  const presets = [
    [SOURCE_POOL_DEFAULT_DAYS, SOURCE_POOL_DEFAULT_MULTIPLE],
    [30, 1.5],
    [45, 1.25],
    [60, 1],
    [SOURCE_POOL_MAX_DAYS, SOURCE_POOL_MIN_MULTIPLE],
  ];
  const seen = new Set();
  for (const [days, multiple] of presets) {
    const normalizedDays = Math.round(clampNumber(days, SOURCE_POOL_MIN_DAYS, SOURCE_POOL_MAX_DAYS));
    const normalizedMultiple = Math.round(clampNumber(multiple, SOURCE_POOL_MIN_MULTIPLE, SOURCE_POOL_MAX_MULTIPLE) / SOURCE_POOL_MULTIPLE_STEP) * SOURCE_POOL_MULTIPLE_STEP;
    const key = `${normalizedDays}:${normalizedMultiple}`;
    if (seen.has(key)) continue;
    seen.add(key);
    state.sourcePoolDays = normalizedDays;
    state.sourcePoolMinMultiple = normalizedMultiple;
    if (remakeEligibleRows().length) {
      return ` Source pool widened to ${normalizedDays} days at ${formatOutlierMultiple(normalizedMultiple)}x.`;
    }
  }
  state.sourcePoolDays = originalDays;
  state.sourcePoolMinMultiple = originalMultiple;
  return "";
}

function sourcePoolVisibleRows(rows) {
  const pool = Array.isArray(rows) ? rows : [];
  if (pool.length <= SOURCE_POOL_PAGE_SIZE) return pool;
  const offset = ((state.sourcePoolOffset % pool.length) + pool.length) % pool.length;
  const visible = [];
  for (let index = 0; index < SOURCE_POOL_PAGE_SIZE; index += 1) {
    visible.push(pool[(offset + index) % pool.length]);
  }
  return visible;
}

function sourcePoolRangeLabel(total) {
  if (!total) return "0 of 0";
  if (total <= SOURCE_POOL_PAGE_SIZE) return `1-${total} of ${total}`;
  const start = ((state.sourcePoolOffset % total) + total) % total;
  const end = start + SOURCE_POOL_PAGE_SIZE;
  if (end <= total) return `${start + 1}-${end} of ${total}`;
  return `${start + 1}-${total} + 1-${end - total} of ${total}`;
}

function autoSelectedRemakeRows() {
  return sourcePoolVisibleRows(remakeEligibleRows());
}

function sourcePayloadFromRow(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    channel: row.channel,
    channel_handle: channelHandle(row),
    channel_subscribers: Number(row.channel_subscribers || 0),
    channel_subscriber_label: row.channel_subscriber_label || "",
    description: row.description || "",
    upload_date: row.upload_date,
    ageDays: row.ageDays,
    views: Number(row.views || 0),
    views_vs_median: Number(row.views_vs_median || row.outlierMultiple || 0),
    views_per_day_vs_median: Number(row.views_per_day_vs_median || 0),
    duration_seconds: Number(row.duration_seconds || 0),
    thumbnail: row.thumbnail || "",
    pattern: row.pattern || "",
    tokens: row.tokens || [],
    topicBucket: row.topicBuckets?.join(", ") || row.topicBucket || "",
    contentStyle: row.contentStyle || contentStyleForRow(row),
    customTranscript: row.customTranscript || "",
  };
}

function createFactorySourcePackageFromRow(row) {
  const enrichedRow = {
    ...row,
    topicBuckets: row.topicBuckets?.length ? row.topicBuckets : approvedTopicBuckets(row),
    contentStyle: row.contentStyle || contentStyleForRow(row),
  };
  const source = sourcePayloadFromRow(enrichedRow);
  const packageData = createScratchPackage({
    projectName: source.title,
    youtubeUrl: source.url,
    metadata: {
      videoId: source.id,
      url: source.url,
      title: source.title,
      authorName: source.channel || source.channel_handle,
      thumbnailUrl: source.thumbnail,
    },
  });
  return {
    ...packageData,
    id: "",
    customProject: false,
    sourceVideos: [source],
    recommendedStyle: source.contentStyle || "Factory Source",
    topicAngle: `Create an original Jon Mac video package from: ${source.title}.`,
    sourceAnalysis: {
      ...(packageData.sourceAnalysis || {}),
      transcriptStatus: "Click Generate Factory Package to fetch the source transcript and build the rewrite.",
      framesStatus: "Source thumbnail and video metadata came from the Outliers card.",
      hook: "Selected directly from Outliers.",
    },
    approvals: {
      ...(packageData.approvals || {}),
      sourceVideoId: source.id,
    },
  };
}

function sendOutlierRowToFactory(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) {
    state.channelError = "Could not find that outlier video.";
    state.channelStatus = "";
    update();
    return;
  }
  const packageData = createFactorySourcePackageFromRow(row);
  state.view = "ideas";
  state.remakePackages = [packageData, ...state.remakePackages].slice(0, 20);
  state.selectedRemakeVideoId = row.id;
  state.packageStep = "source";
  state.thumbnailPromptIndex = 1;
  state.ideaProgress = null;
  state.assetProgress = null;
  state.ideaGenerationLoading = false;
  state.assetGenerationLoading = false;
  state.assetGenerationTarget = null;
  state.editingScript = false;
  state.scriptDraft = "";
  state.channelError = "";
  state.channelStatus = `Sent to Factory: ${row.title}`;
  autosaveCurrentProject();
  update();
}

function youtubeVideoIdFromUrl(value) {
  const url = String(value || "").trim();
  const direct = url.match(/^[a-zA-Z0-9_-]{11}$/);
  if (direct) return direct[0];
  const match = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return match?.[1] || "";
}

function maxresThumbnailUrl(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";
}

function cleanTitleCore(title) {
  return normalizeKeyword(String(title || "")
    .replace(/\s*\|.*$/g, "")
    .replace(/\s*-\s*YouTube$/i, "")
    .replace(/[?!]+$/g, ""));
}

function stripTrailingYear(title) {
  return normalizeKeyword(title).replace(/\s*\((20\d{2})\)\s*$/i, "").trim();
}

function stripTrailingContext(title) {
  return stripTrailingYear(title)
    .replace(/\s*\((full tutorial|step-by-step|from scratch|full workflow|free course|do this now|fast & easy tutorial)\)\s*$/i, "")
    .trim();
}

function uniqueTitleList(titles) {
  return [...new Map(titles
    .map((title) => normalizeKeyword(title))
    .filter(Boolean)
    .map((title) => [title.toLowerCase(), title])).values()];
}

function titleReady(value) {
  const text = normalizeKeyword(value);
  return text
    ? `${text.charAt(0).toUpperCase()}${text.slice(1)}`
      .replace(/\bai\b/gi, "AI")
      .replace(/\bugc\b/gi, "UGC")
      .replace(/\bgpt\b/gi, "GPT")
      .replace(/\bwith\b/g, "With")
    : "";
}

function compactTitleOverlay(title, maxLength = 54) {
  const clean = titleReady(title).replace(/\s*\([^)]*\)\s*$/g, "");
  if (clean.length <= maxLength) return clean;
  const clipped = clean.slice(0, maxLength).replace(/\s+\S*$/g, "").trim();
  return clipped || clean.slice(0, maxLength).trim();
}

function embeddedPhrase(value) {
  return titleReady(value).replace(/^(A|An|The)\s/, (match) => match.toLowerCase());
}

function withoutLeadingArticle(value) {
  return titleReady(value).replace(/^(A|An|The)\s+/i, "");
}

function withIndefiniteArticle(value) {
  const phrase = withoutLeadingArticle(value);
  const article = /^(AI|A\.I\.|[aeio])/i.test(phrase) ? "an" : "a";
  return `${article} ${phrase}`;
}

function actionSubjectFromTitle(title) {
  const base = stripTrailingContext(cleanTitleCore(title)) || cleanTitleCore(title);
  const firstPersonVerbs = {
    built: "Build",
    made: "Make",
    created: "Create",
    tested: "Test",
    tried: "Try",
    copied: "Copy",
    launched: "Launch",
  };
  const changedForever = base.match(/^(.+?)\s+(?:has|just)\s+changed\s+(.+?)\s+forever$/i);
  if (changedForever) {
    return {
      base,
      verb: "Create",
      subject: `${titleReady(changedForever[2])} With ${titleReady(changedForever[1])}`,
    };
  }

  const resultFormula = base.match(/^(.+?)\s*=\s*(.+)$/i);
  if (resultFormula) {
    const result = titleReady(resultFormula[2]).replace(/\s+in minutes$/i, "");
    return {
      base,
      verb: "Create",
      subject: `${result} With ${titleReady(resultFormula[1])}`,
    };
  }

  const howTo = base.match(/^how to (make|create|build|start|use|find|publish)\s+(.+)$/i);
  if (howTo) {
    return {
      base,
      verb: howTo[1].toLowerCase() === "create" ? "Create" : titleReady(howTo[1]),
      subject: titleReady(howTo[2]),
    };
  }

  const firstPerson = base.match(/^i\s+(built|made|created|tested|tried|copied|launched)\s+(.+)$/i);
  if (firstPerson) {
    return {
      base,
      verb: firstPersonVerbs[firstPerson[1].toLowerCase()] || "Make",
      subject: titleReady(firstPerson[2]),
    };
  }

  return {
    base,
    verb: "Make",
    subject: titleReady(base),
  };
}

function splitMechanic(subject) {
  const match = subject.match(/^(.+?)\s+With\s+(.+)$/i);
  if (!match) return { outcome: subject, mechanic: "" };
  return {
    outcome: titleReady(match[1]),
    mechanic: titleReady(match[2]),
  };
}

function workflowFromOutcome(outcome) {
  if (/videos/i.test(outcome)) return titleReady(outcome.replace(/videos/i, "Video Workflow"));
  if (/ads/i.test(outcome)) return titleReady(outcome.replace(/ads/i, "Ad Workflow"));
  if (/posts/i.test(outcome)) return titleReady(outcome.replace(/posts/i, "Post System"));
  return `${titleReady(outcome)} Workflow`;
}

function titleVariantsFromSourceTitle(sourceTitle, fallback = "This AI Workflow") {
  const core = cleanTitleCore(sourceTitle) || fallback;
  const { base, verb, subject } = actionSubjectFromTitle(core);
  const { outcome, mechanic } = splitMechanic(subject);
  const workflow = workflowFromOutcome(outcome);
  const topic = mechanic ? `${outcome} With ${mechanic}` : subject;
  const changer = mechanic || outcome;
  return uniqueTitleList([
    `How to Create ${embeddedPhrase(topic)} (Full Workflow)`,
    `${changer} Just Changed ${withoutLeadingArticle(outcome)} Forever (Full Tutorial)`,
    mechanic
      ? `I Built ${withIndefiniteArticle(workflow)} With ${mechanic} (From Scratch)`
      : `I Built ${embeddedPhrase(subject)} From Scratch`,
    `The Easiest Way to ${verb} ${embeddedPhrase(subject)} (Step-by-Step)`,
    `${topic} in Minutes`,
    `How to ${verb} ${embeddedPhrase(subject)} in 2026 (Step-by-Step)`,
    `${base} (Full Tutorial)`,
  ].map((title) => titleReady(title))).slice(0, 5);
}

function packageSourceTitle(packageData) {
  return normalizeKeyword(packageData?.sourceVideos?.[0]?.title || packageData?.topicAngle || "");
}

function hasGenericFactoryTitleDrift(titles = []) {
  return titles.some((title) => /ai video factory|full video package|one outlier|repeatable ai video system|factory workflow|stop guessing/i.test(String(title || "")));
}

function repairPackageTitleOptions(packageData) {
  if (!packageData || !Array.isArray(packageData.titles)) return packageData;
  const sourceTitle = packageSourceTitle(packageData);
  if (!sourceTitle || !hasGenericFactoryTitleDrift(packageData.titles)) return packageData;
  const titles = titleVariantsFromSourceTitle(sourceTitle);
  return {
    ...packageData,
    titles,
    hooks: Array.isArray(packageData.hooks)
      ? packageData.hooks.map((hook, index) => ({
          ...hook,
          title: titles[index] || hook.title,
          textOverlay: compactTitleOverlay(titles[index] || titles[0] || hook.textOverlay),
        }))
      : packageData.hooks,
    thumbnailPrompts: Array.isArray(packageData.thumbnailPrompts)
      ? packageData.thumbnailPrompts.map((prompt, index) => String(prompt || "").replace(/Source thumbnail topic:[^.]+\\./, `Source thumbnail topic: ${titles[index] || titles[0] || sourceTitle}.`))
      : packageData.thumbnailPrompts,
  };
}

function repairActivePackageTitleOptions() {
  const current = latestPackage();
  const repaired = repairPackageTitleOptions(current);
  if (!current || repaired === current) return null;
  state.remakePackages = [repaired, ...state.remakePackages.slice(1)];
  const projectId = repaired.projectId;
  if (projectId) {
    state.savedProjects = state.savedProjects.map((project) => (
      project.id === projectId
        ? { ...project, name: projectTitleForPackage(repaired), package: repaired, updatedAt: new Date().toISOString() }
        : project
    ));
    saveRemakeProjects();
  }
  saveRemakePackages();
  return repaired;
}

function thumbnailPromptsFromScratch(source, titles = []) {
  const title = source?.title || titles[0] || "custom YouTube project";
  const thumbnail = source?.thumbnail || maxresThumbnailUrl(source?.id);
  const layoutReference = thumbnail
    ? `Imported source thumbnail reference: ${thumbnail}.`
    : "Use the imported source thumbnail as the visual reference once one is added.";
  const base = [
    "Reverse engineer the source thumbnail image into a production-ready YouTube thumbnail prompt, then render that thumbnail for Jon Mac.",
    layoutReference,
    "Image 1 is the layout lock. Recreate the same composition, crop, subject placement, text-block locations, icon/logo areas, background style, and visual hierarchy.",
    "Swap any visible presenter/person with Jon Mac from the reference images while keeping the same pose, scale, crop, and lighting. If the source has no presenter, do not add one.",
    "Replace source logos, product names, and headline text only inside matching existing areas. Do not add new panels, arrows, people, mockups, grids, or portrait-only framing.",
    `Source thumbnail topic: ${title}.`,
    "Use short clean text only. Keep words spelled correctly and separated by spaces. If clean text is hard, use fewer words.",
  ].join(" ");
  return [
    `${base} Option 1 should stay closest to the source layout. Keep all major blocks in the same positions.`,
    `${base} Option 2 should keep the exact same layout and only adjust the top text or icon treatment.`,
    `${base} Option 3 should keep the exact same layout and only adjust the presenter expression if the source uses a person. No portrait-only output.`,
    `${base} Option 4 should keep the exact same layout and only adjust contrast or color intensity. No new text structure.`,
    `${base} Option 5 should keep the exact same layout and only make the spacing cleaner. Do not remove the source text-block structure.`,
  ];
}

function createScratchPackage({ projectName = "", script = "", youtubeUrl = "", metadata = null } = {}) {
  const now = new Date().toISOString();
  const videoId = metadata?.videoId || youtubeVideoIdFromUrl(youtubeUrl) || `custom_${Date.now()}`;
  const videoUrl = metadata?.url || youtubeUrl || "";
  const sourceTitle = normalizeKeyword(metadata?.title || projectName || "Untitled custom project");
  const thumbnail = metadata?.thumbnailUrl || maxresThumbnailUrl(videoId);
  const source = {
    id: videoId,
    url: videoUrl,
    title: sourceTitle,
    channel: metadata?.authorName || "Custom source",
    channel_handle: metadata?.authorName || "Custom",
    description: "Custom scratch project",
    upload_date: "",
    ageDays: 0,
    views: 0,
    views_vs_median: 0,
    views_per_day_vs_median: 0,
    duration_seconds: 0,
    thumbnail,
    pattern: "Custom scratch source",
    tokens: [],
    topicBucket: "Custom project",
    contentStyle: "Scratch Project",
    customTranscript: script,
  };
  const titles = titleVariantsFromSourceTitle(sourceTitle);
  return {
    id: `scratch_${Date.now()}`,
    projectId: `project_${Date.now()}`,
    createdAt: now,
    customProject: true,
    sourceVideos: [source],
    recommendedStyle: "Scratch Project",
    topicAngle: `Create an original Jon Mac video package from: ${sourceTitle}.`,
    sourceAnalysis: {
      transcriptStatus: script ? `Pasted script saved (${countWords(script).toLocaleString()} words).` : "Paste a script or click Rewrite Script to fetch a source transcript.",
      framesStatus: thumbnail ? "Thumbnail reference imported from the pasted YouTube URL." : "Paste a YouTube URL to import the title and thumbnail reference.",
      hook: "Custom project created from scratch.",
      structure: [],
      scenes: [],
      frames: [],
      transcriptTakeaways: [],
      originalTranscript: script,
    },
    titles,
    thumbnailPrompts: thumbnailPromptsFromScratch(source, titles),
    hooks: titles.slice(0, 3).map((title) => ({
      textOverlay: compactTitleOverlay(title),
      spokenIntro: script.split(/\s+/).slice(0, 90).join(" "),
      title,
    })),
    script: {
      targetLengthWords: script ? Math.max(800, countWords(script)) : 0,
      sourceLengthNotes: script ? "Pasted scratch-project script." : "No pasted script yet.",
      originalTranscript: script,
      originalTranscriptWords: countWords(script),
      originalTranscriptSource: script ? "pasted script" : "",
      fullScript: "",
      wordForWordIntro: "",
    },
    avatarPlan: {
      firstMinuteScript: "",
      visualDirection: "Use Jon Mac's avatar in a clean talking-head setup, then cut to screen proof and thumbnail/title decisions.",
      steps: [
        "Approve the rewritten script.",
        "Generate the avatar read from the approved script.",
        "Upload the finished avatar video and script doc to Drive.",
      ],
    },
    editPlan: [
      "Use the imported source as a packaging reference, not copied creative.",
      "Match the approved title, thumbnail prompt, and script hook.",
      "Keep tool screenshots tight and remove unsupported claims.",
    ],
    assets: {},
    approvals: {
      sourceVideoId: videoId,
    },
  };
}

async function fetchYouTubeMetadata(youtubeUrl) {
  const url = String(youtubeUrl || "").trim();
  if (!url) return null;
  try {
    const response = await fetch(`/api/cloud/youtube-gen/youtube-metadata?url=${encodeURIComponent(url)}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok && data.video) return data.video;
  } catch (error) {}
  const videoId = youtubeVideoIdFromUrl(url);
  if (!videoId) throw new Error("Could not pull the YouTube title and thumbnail.");
  let title = "";
  let authorName = "";
  try {
    const oembed = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (oembed.ok) {
      const payload = await oembed.json();
      title = payload && payload.title ? String(payload.title) : "";
      authorName = payload && payload.author_name ? String(payload.author_name) : "";
    }
  } catch (error) {}
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: title || videoId,
    authorName: authorName || "Custom source",
    thumbnailUrl: maxresThumbnailUrl(videoId) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the thumbnail file."));
    reader.readAsDataURL(file);
  });
}

async function uploadManualThumbnailFile(file) {
  if (!file) return null;
  if (!String(file.type || "").startsWith("image/")) {
    throw new Error("Upload a PNG, JPG, or WebP thumbnail image.");
  }
  const dataUrl = await readFileAsDataUrl(file);
  let lastError = "";
  for (const apiUrl of MANUAL_THUMBNAIL_API_URLS) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: file.name || "manual-thumbnail.png" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `Thumbnail upload failed with ${response.status}`);
      return {
        url: data.url || data.path || dataUrl,
        path: data.path || "",
        dataUrl,
        filename: file.name || "manual-thumbnail.png",
      };
    } catch (error) {
      lastError = error.message || "Thumbnail upload failed.";
    }
  }
  throw new Error(lastError || "Thumbnail upload failed.");
}

async function createManualFactorySourceFromForm(formElement) {
  const form = new FormData(formElement);
  const projectName = normalizeKeyword(form.get("projectName"));
  const script = String(form.get("script") || "").trim();
  const youtubeUrl = normalizeKeyword(form.get("youtubeUrl"));
  const thumbnailFile = form.get("thumbnail");
  const hasThumbnailFile = thumbnailFile instanceof File && thumbnailFile.size > 0;
  if (!projectName && !script && !youtubeUrl && !hasThumbnailFile) {
    state.channelError = "Paste a YouTube URL, script, thumbnail, or project title first.";
    state.channelStatus = "";
    update();
    return;
  }
  state.channelError = "";
  state.channelStatus = youtubeUrl ? "Pulling YouTube title and thumbnail..." : "Creating manual Factory source...";
  update();
  try {
    const metadata = youtubeUrl ? await fetchYouTubeMetadata(youtubeUrl) : null;
    const uploadedThumbnail = hasThumbnailFile ? await uploadManualThumbnailFile(thumbnailFile) : null;
    const mergedMetadata = {
      ...(metadata || {}),
      title: metadata?.title || projectName || "Manual Factory Source",
      thumbnailUrl: uploadedThumbnail?.url || metadata?.thumbnailUrl || "",
    };
    const packageData = createScratchPackage({
      projectName: projectName || mergedMetadata.title,
      script,
      youtubeUrl,
      metadata: mergedMetadata,
    });
    state.view = "ideas";
    state.remakePackages = [packageData, ...state.remakePackages].slice(0, 20);
    state.selectedRemakeVideoId = packageData.sourceVideos[0]?.id || "";
    state.packageStep = script ? "script" : "source";
    state.thumbnailPromptIndex = 1;
    state.ideaProgress = null;
    state.assetProgress = null;
    state.ideaGenerationLoading = false;
    state.assetGenerationLoading = false;
    state.assetGenerationTarget = null;
    state.editingScript = false;
    state.scriptDraft = "";
    autosaveCurrentProject({ status: `Manual Factory source ready: ${projectTitleForPackage(packageData)}` });
    update();
    formElement.reset();
  } catch (error) {
    state.channelError = error.message || "Could not create the manual Factory source.";
    state.channelStatus = "";
    update();
  }
}

async function createScratchProjectFromForm(formElement) {
  const form = new FormData(formElement);
  const projectName = normalizeKeyword(form.get("projectName"));
  const script = String(form.get("script") || "").trim();
  const youtubeUrl = normalizeKeyword(form.get("youtubeUrl"));
  const thumbnailFile = form.get("thumbnail");
  const hasThumbnailFile = thumbnailFile instanceof File && thumbnailFile.size > 0;
  if (!projectName && !script && !youtubeUrl && !hasThumbnailFile) {
    state.channelError = "Add a project name, script, or YouTube URL first.";
    state.channelStatus = "";
    update();
    return;
  }
  state.channelError = "";
  state.channelStatus = youtubeUrl ? "Pulling YouTube title and thumbnail..." : "Creating scratch project...";
  update();
  try {
    const metadata = youtubeUrl ? await fetchYouTubeMetadata(youtubeUrl) : null;
    const uploadedThumbnail = hasThumbnailFile ? await uploadManualThumbnailFile(thumbnailFile) : null;
    const packageData = createScratchPackage({
      projectName,
      script,
      youtubeUrl,
      metadata: uploadedThumbnail ? { ...(metadata || {}), thumbnailUrl: uploadedThumbnail.url } : metadata,
    });
    state.view = "ideas";
    state.remakePackages = [packageData];
    state.selectedRemakeVideoId = packageData.sourceVideos[0]?.id || "";
    state.packageStep = script ? "script" : "titles";
    state.thumbnailPromptIndex = 1;
    state.ideaProgress = null;
    state.assetProgress = null;
    state.ideaGenerationLoading = false;
    state.assetGenerationLoading = false;
    state.assetGenerationTarget = null;
    state.editingScript = false;
    state.scriptDraft = "";
    autosaveCurrentProject({ status: `Created scratch project: ${projectTitleForPackage(packageData)}` });
    update();
    formElement.reset();
  } catch (error) {
    state.channelError = error.message || "Could not create the scratch project.";
    state.channelStatus = "";
    update();
  }
}

async function importMetadataIntoScratchProject(youtubeUrl) {
  const current = latestPackage();
  if (!current) return;
  state.channelError = "";
  state.channelStatus = "Pulling YouTube title and thumbnail...";
  update();
  try {
    const metadata = await fetchYouTubeMetadata(youtubeUrl);
    updateLatestPackage((pkg) => {
      const existingSource = pkg.sourceVideos?.[0] || {};
      const source = {
        ...existingSource,
        id: metadata.videoId || existingSource.id,
        url: metadata.url || youtubeUrl,
        title: metadata.title || existingSource.title,
        channel: metadata.authorName || existingSource.channel,
        channel_handle: metadata.authorName || existingSource.channel_handle,
        thumbnail: metadata.thumbnailUrl || maxresThumbnailUrl(metadata.videoId) || existingSource.thumbnail,
      };
      const titles = titleVariantsFromSourceTitle(source.title);
      return {
        ...pkg,
        sourceVideos: [source],
        topicAngle: `Create an original Jon Mac video package from: ${source.title}.`,
        titles,
        thumbnailPrompts: thumbnailPromptsFromScratch(source, titles),
        approvals: {
          ...(pkg.approvals || {}),
          sourceVideoId: source.id || "",
        },
      };
    });
    state.selectedRemakeVideoId = metadata.videoId || latestPackage()?.sourceVideos?.[0]?.id || "";
    state.channelStatus = "Imported YouTube title and thumbnail.";
    state.channelError = "";
    update();
  } catch (error) {
    state.channelError = error.message || "Could not import the YouTube title and thumbnail.";
    state.channelStatus = "";
    update();
  }
}

function saveScratchSourceScript(scriptText) {
  const text = String(scriptText || "").trim();
  if (!latestPackage()) return;
  updateLatestPackage((pkg) => {
    const source = { ...(pkg.sourceVideos?.[0] || {}), customTranscript: text };
    const script = typeof pkg.script === "object" && pkg.script ? pkg.script : {};
    return {
      ...pkg,
      sourceVideos: [source],
      sourceAnalysis: {
        ...(pkg.sourceAnalysis || {}),
        transcriptStatus: text ? `Pasted script saved (${countWords(text).toLocaleString()} words).` : "No source script saved.",
        originalTranscript: text,
      },
      script: {
        ...script,
        originalTranscript: text,
        originalTranscriptWords: countWords(text),
        originalTranscriptSource: text ? "pasted script" : "",
      },
    };
  });
  state.channelError = "";
  state.channelStatus = text ? "Source script saved. Click Rewrite Script when ready." : "Source script cleared.";
  update();
}

async function saveScratchSourceThumbnail(file) {
  if (!latestPackage()) return;
  state.channelError = "";
  state.channelStatus = "Uploading thumbnail reference...";
  update();
  try {
    const uploaded = await uploadManualThumbnailFile(file);
    if (!uploaded?.url) throw new Error("Thumbnail upload did not return a usable URL.");
    updateLatestPackage((pkg) => {
      const source = { ...(pkg.sourceVideos?.[0] || {}), thumbnail: uploaded.url };
      const titles = Array.isArray(pkg.titles) && pkg.titles.length ? pkg.titles : titleVariantsFromSourceTitle(source.title);
      return {
        ...pkg,
        sourceVideos: [source],
        thumbnailPrompts: thumbnailPromptsFromScratch(source, titles),
        sourceAnalysis: {
          ...(pkg.sourceAnalysis || {}),
          framesStatus: "Manual thumbnail reference uploaded and saved.",
        },
      };
    });
    state.channelError = "";
    state.channelStatus = "Manual thumbnail reference saved.";
    update();
  } catch (error) {
    state.channelError = error.message || "Could not save the manual thumbnail.";
    state.channelStatus = "";
    update();
  }
}

function updateIdeaProgress(event) {
  updateProgressState("ideaProgress", event);
}

function updateAssetProgress(event) {
  updateProgressState("assetProgress", event);
}

function updateProgressState(key, event) {
  const previous = state[key] || { events: [] };
  const percent = Number.isFinite(Number(event.percent)) ? Math.max(0, Math.min(100, Number(event.percent))) : previous.percent || 0;
  const entry = {
    percent,
    step: event.step || event.status || previous.step || "Working",
    detail: event.detail || event.error || "",
    error: event.error || "",
    status: event.status || "progress",
    asset: event.asset || null,
    assets: event.assets || null,
    at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }),
  };
  const partialAssets = mergeProgressAssets(previous.partialAssets, event);
  state[key] = {
    ...entry,
    partialAssets,
    events: [entry, ...(previous.events || [])].slice(0, 12),
  };
}

function mergeProgressAssets(existing = { references: [], thumbnails: [], visualHooks: [] }, event = {}) {
  if (event.assets) return event.assets;
  const next = {
    references: [...(existing.references || [])],
    thumbnails: [...(existing.thumbnails || [])],
    visualHooks: [...(existing.visualHooks || [])],
  };
  const asset = event.asset;
  if (!asset || !asset.type) return next;
  if (asset.type === "thumbnail") {
    next.thumbnails = mergeAssetLists(next.thumbnails, [asset]);
  }
  if (asset.type === "visualHook") {
    next.visualHooks = mergeAssetLists(next.visualHooks, [asset]);
  }
  return next;
}

function assetsFromProgress(progress) {
  if (progress?.partialAssets) return progress.partialAssets;
  const assets = { references: [], thumbnails: [], visualHooks: [] };
  for (const event of progress?.events || []) {
    if (event.assets) return event.assets;
    const asset = event.asset;
    if (!asset || !asset.type) continue;
    if (asset.type === "thumbnail") assets.thumbnails.push(asset);
    if (asset.type === "visualHook") assets.visualHooks.push(asset);
  }
  return assets;
}

function assetsSatisfyTargets(assets, targets) {
  const thumbTargets = targets?.thumbnails || [];
  const visualTargets = targets?.visualHooks || [];
  const hasThumbs = thumbTargets.every((index) => (assets.thumbnails || []).some((asset) => Number(asset.index) === Number(index) && assetImageUrl(asset)));
  const hasVisuals = visualTargets.every((index) => (assets.visualHooks || []).some((asset) => Number(asset.index) === Number(index) && assetImageUrl(asset)));
  return hasThumbs && hasVisuals && (thumbTargets.length || visualTargets.length);
}

function assetResultCount(assets = {}) {
  return (assets.thumbnails || []).filter((asset) => assetImageUrl(asset)).length
    + (assets.visualHooks || []).filter((asset) => assetImageUrl(asset)).length;
}

async function readProgressStream(response, onProgress = updateIdeaProgress, completeKey = "package") {
  if (!response.body) {
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Generation failed with ${response.status}`);
    return data[completeKey];
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedValue = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      onProgress(event);
      if (event.status === "error") {
        update();
        const error = new Error(event.error || event.detail || "Idea generation failed.");
        error.name = "GenerationError";
        throw error;
      }
      if (event.status === "complete") {
        completedValue = event[completeKey];
      }
      update();
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    onProgress(event);
    if (event.status === "error") {
      const error = new Error(event.error || event.detail || "Idea generation failed.");
      error.name = "GenerationError";
      throw error;
    }
    if (event.status === "complete") completedValue = event[completeKey];
  }

  if (!completedValue) throw new Error("Generation ended without a complete result.");
  return completedValue;
}

async function generateRemakePackage() {
  const currentPackage = latestPackage();
  const isScriptRewrite = Boolean(currentPackage && state.packageStep === "script");
  const recommendations = isScriptRewrite ? [] : autoSelectedRemakeRows();
  const packageSource = currentPackage?.sourceVideos?.[0] || null;
  const activeProjectId = currentPackage?.projectId || "";
  const returnStep = isScriptRewrite ? "script" : "titles";
  const savedSourceTranscript = originalTranscriptText(currentPackage);
  let selected = null;
  if (isScriptRewrite && packageSource) {
    selected = {
      ...packageSource,
      customTranscript: savedSourceTranscript || packageSource.customTranscript || "",
    };
    state.selectedRemakeVideoId = packageSource.id || state.selectedRemakeVideoId || "";
  } else {
    const effectiveSourceId = state.selectedRemakeVideoId || packageSource?.id || "";
    const baseSelected = recommendations.find((row) => row.id === effectiveSourceId)
      || (packageSource && packageSource.id === effectiveSourceId ? packageSource : null);
    selected = baseSelected && savedSourceTranscript && baseSelected.id === packageSource?.id
      ? { ...baseSelected, customTranscript: savedSourceTranscript }
      : baseSelected;
  }
  const rows = selected ? [selected] : [];
  state.view = "ideas";
  if (!rows.length) {
    state.channelError = isScriptRewrite
      ? "This project is missing its source video. Go back to Source or build a new package."
      : recommendations.length
      ? "Click one source video before generating a Factory package."
      : "No 2x outliers from the last 7 days. Refresh data or widen the filter.";
    state.channelStatus = "";
    update();
    return;
  }

  const payload = {
    sourceVideos: rows.map(sourcePayloadFromRow),
    brandStyle: {
      primaryBlue: BRAND_COLORS.jonMacBlue,
      higgsfieldLime: BRAND_COLORS.higgsfieldLime,
      claudeOrange: BRAND_COLORS.claudeOrange,
    },
    requiredOutput: {
      titles: 5,
      thumbnailPrompts: 5,
      script: 1,
      avatarPlan: 1,
      editPlan: 1,
    },
  };

  state.ideaGenerationLoading = true;
  state.ideaProgress = {
    percent: 0,
    step: isScriptRewrite ? "Rewriting script" : "Starting",
    detail: isScriptRewrite ? "Replacing the saved rewrite from the source transcript." : "Opening the live generation stream.",
    status: "progress",
    events: [],
  };
  state.channelError = "";
  state.channelStatus = isScriptRewrite ? "Rewriting source script..." : "Building Factory package...";
  update();

  let lastError = "";
  try {
    for (const apiUrl of IDEA_GENERATION_API_URLS) {
      try {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Idea generation failed with ${response.status}`);
        }
        const generatedPackage = await readProgressStream(response, updateIdeaProgress, "package");
        const packageData = isScriptRewrite
          ? mergeScriptRewritePackage(latestPackage() || currentPackage, generatedPackage, activeProjectId)
          : activeProjectId ? { ...generatedPackage, projectId: activeProjectId } : generatedPackage;
        const remainingPackages = state.remakePackages.filter((packageItem, index) => {
          if (isScriptRewrite && index === 0) return false;
          if (activeProjectId && packageItem?.projectId === activeProjectId) return false;
          return true;
        });
        state.remakePackages = [packageData, ...remainingPackages].slice(0, 20);
        state.packageStep = returnStep;
        state.editorDraftName = "";
        state.editorDraftPhone = "";
        state.editorMessageDraft = "";
        state.editorMessageTouched = false;
        autosaveCurrentProject();
        state.channelStatus = isScriptRewrite ? `Rewrote script from ${rows[0].title}` : `Built Factory package from ${rows[0].title}`;
        state.channelError = "";
        updateIdeaProgress({
          status: "complete",
          percent: 100,
          step: isScriptRewrite ? "Rewrite replaced" : "Complete",
          detail: isScriptRewrite ? "The saved script was replaced with an adapted source rewrite." : "Factory package is ready.",
        });
        return;
      } catch (error) {
        if (error.name === "GenerationError" && !/source transcript|Transcript missing|transcript fetch/i.test(error.message || "")) throw error;
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Factory package generator is not available.");
  } catch (error) {
    if (state.ideaProgress?.status !== "error") {
      updateIdeaProgress({
        status: "error",
        percent: state.ideaProgress?.percent || 0,
        step: "Generation failed",
        detail: error.message,
        error: error.message,
      });
    }
    state.channelError = lastError && /fetch|failed|NetworkError|Load failed/i.test(lastError)
      ? "Factory package generator is not available."
      : error.message;
    state.channelStatus = "";
  } finally {
    state.ideaGenerationLoading = false;
    update();
  }
}

function generateIdeasFromSelection() {
  generateRemakePackage();
}

function mergeAssetLists(existing = [], incoming = []) {
  const map = new Map();
  const remember = (item, position) => {
    if (!item) return;
    const parsedIndex = Number(item.index);
    const index = Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : position + 1;
    map.set(index, {
      ...item,
      index,
    });
  };
  for (const [position, item] of existing.entries()) {
    remember(item, position);
  }
  for (const [position, item] of incoming.entries()) {
    remember(item, position);
  }
  return [...map.values()].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
}

function thumbnailAssetList(assets = {}) {
  const raw = assets?.thumbnails;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([key, value]) => {
      const index = Number(key);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return {
          index: Number.isFinite(Number(value.index)) ? Number(value.index) : index,
          ...value,
        };
      }
      return {
        index,
        url: assetImageUrl(value),
      };
    });
  }
  return [];
}

function mergePackageAssets(existingAssets = {}, incomingAssets = {}) {
  return {
    ...existingAssets,
    ...incomingAssets,
    references: incomingAssets.references?.length ? incomingAssets.references : existingAssets.references || [],
    thumbnails: mergeAssetLists(thumbnailAssetList(existingAssets), thumbnailAssetList(incomingAssets)),
    visualHooks: mergeAssetLists(existingAssets.visualHooks || [], incomingAssets.visualHooks || []),
  };
}

function saveAssetsToCurrentPackage(assets = {}) {
  const current = latestPackage();
  if (!current) return null;
  const updatedPackage = {
    ...current,
    assets: mergePackageAssets(current.assets || {}, assets || {}),
  };
  state.remakePackages = [updatedPackage, ...state.remakePackages.slice(1)];
  autosaveCurrentProject();
  return updatedPackage;
}

function mergeScriptRewritePackage(currentPackage, generatedPackage, projectId = "") {
  if (!currentPackage) {
    return projectId ? { ...generatedPackage, projectId } : generatedPackage;
  }
  const approvals = {
    ...(currentPackage.approvals || {}),
    ...(generatedPackage.approvals || {}),
  };
  delete approvals.script;
  return {
    ...currentPackage,
    ...generatedPackage,
    id: currentPackage.id || generatedPackage.id,
    createdAt: currentPackage.createdAt || generatedPackage.createdAt,
    projectId: projectId || currentPackage.projectId || generatedPackage.projectId || "",
    titles: Array.isArray(currentPackage.titles) && currentPackage.titles.length ? currentPackage.titles : generatedPackage.titles,
    thumbnailPrompts: Array.isArray(currentPackage.thumbnailPrompts) && currentPackage.thumbnailPrompts.length ? currentPackage.thumbnailPrompts : generatedPackage.thumbnailPrompts,
    thumbnailPromptEdits: currentPackage.thumbnailPromptEdits || generatedPackage.thumbnailPromptEdits,
    assets: mergePackageAssets(currentPackage.assets || {}, generatedPackage.assets || {}),
    approvals,
  };
}

function thumbnailPromptEdits(packageData) {
  return packageData?.thumbnailPromptEdits && typeof packageData.thumbnailPromptEdits === "object"
    ? packageData.thumbnailPromptEdits
    : {};
}

function isLegacyThumbnailPrompt(value) {
  const text = String(value || "");
  if (
    /image\s+map\s+(for\s+generation:|:) image\s+1\s+is\s+the\s+primary\s+jon\s+mac\s+identity\s+reference/i.test(text) &&
    !text.includes(THUMBNAIL_IDENTITY_PROMPT_PROTOCOL)
  ) {
    return true;
  }
  return /image\s+1\s+is\s+the\s+source\s+thumbnail|swap\s+the\s+visible\s+presenter\/person\s+in\s+image\s+1|using\s+images\s+2-4\s+as\s+identity\s+references|reverse\s+engineer\s+image\s+1/i.test(text);
}

function editableThumbnailPrompt(packageData, index) {
  const edits = thumbnailPromptEdits(packageData);
  const edited = edits[String(index)];
  return edited && !isLegacyThumbnailPrompt(edited) ? edited : writerStyleThumbnailPrompt(packageData, index);
}

function thumbnailPromptReady(index) {
  return state.thumbnailPromptReady?.has(Number(index || 0));
}

function revealThumbnailPrompt(index) {
  const targetIndex = Number(index || state.thumbnailPromptIndex || 1);
  if (!targetIndex) return;
  state.thumbnailPromptReady.add(targetIndex);
  state.thumbnailPromptIndex = targetIndex;
  state.channelError = "";
  state.channelStatus = `Prompt ready for thumbnail ${targetIndex}. Review it, then click Generate Image.`;
  autosaveCurrentProject();
  update();
  requestAnimationFrame(() => {
    const promptBox = document.querySelector(".thumb-prompt-text");
    promptBox?.focus();
    promptBox?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function thumbnailOptionCount(packageData) {
  const promptCount = Array.isArray(packageData?.thumbnailPrompts) ? packageData.thumbnailPrompts.length : 0;
  const assetMax = Math.max(0, ...(thumbnailAssetList(packageData?.assets).map((asset) => Number(asset?.index || 0))));
  return Math.max(5, promptCount, assetMax);
}

function nextThumbnailVariationIndex(packageData) {
  const used = new Set(thumbnailAssetList(packageData?.assets).map((asset) => Number(asset?.index || 0)).filter(Boolean));
  const baseCount = Math.max(5, Array.isArray(packageData?.thumbnailPrompts) ? packageData.thumbnailPrompts.length : 0);
  for (let index = 1; index <= baseCount; index += 1) {
    if (!used.has(index)) return index;
  }
  return Math.max(baseCount, ...used) + 1;
}

function openThumbnailPromptEditor(index) {
  const current = latestPackage();
  if (!current) return;
  state.editingThumbnailIndex = Number(index || state.thumbnailPromptIndex || 1);
  state.editingThumbnailPrompt = "";
  state.thumbnailPromptIndex = state.editingThumbnailIndex;
  update();
}

function closeThumbnailPromptEditor() {
  state.editingThumbnailIndex = 0;
  state.editingThumbnailPrompt = "";
  update();
}

function openAssetPreview(url, filename = "thumbnail-preview.png") {
  if (!url) return;
  state.previewAsset = { url, filename };
  update();
}

function closeAssetPreview() {
  state.previewAsset = null;
  update();
}

function deleteThumbnailAsset(index) {
  const targetIndex = Number(index || 0);
  if (!targetIndex) return;
  updateLatestPackage((pkg) => {
    const assets = pkg.assets || {};
    const approvals = { ...(pkg.approvals || {}) };
    const thumbnailPromptEditsNext = { ...thumbnailPromptEdits(pkg) };
    delete thumbnailPromptEditsNext[String(targetIndex)];
    if (approvals.thumbnailIndex === targetIndex - 1) {
      delete approvals.thumbnailIndex;
    }
    return {
      ...pkg,
      approvals,
      thumbnailPromptEdits: thumbnailPromptEditsNext,
      assets: {
        ...assets,
        thumbnails: (assets.thumbnails || []).filter((asset) => Number(asset?.index || 0) !== targetIndex),
      },
    };
  });
  const current = latestPackage();
  const nextCount = thumbnailOptionCount(current);
  if (Number(state.thumbnailPromptIndex) === targetIndex || Number(state.thumbnailPromptIndex) > nextCount) {
    state.thumbnailPromptIndex = Math.min(Math.max(1, targetIndex - 1), nextCount);
  }
  state.channelError = "";
  state.channelStatus = `Deleted thumbnail ${targetIndex}.`;
  update();
}

function generateEditedThumbnailPrompt(mode = "replace") {
  const sourceIndex = Number(state.editingThumbnailIndex || 0);
  const prompt = String(state.editingThumbnailPrompt || "").trim();
  if (!sourceIndex || !prompt) {
    state.channelError = "Add prompt changes before regenerating.";
    state.channelStatus = "";
    update();
    return;
  }
  const current = latestPackage();
  const targetIndex = mode === "variation" ? nextThumbnailVariationIndex(current) : sourceIndex;
  updateLatestPackage((pkg) => ({
    ...pkg,
    thumbnailPromptEdits: {
      ...thumbnailPromptEdits(pkg),
      [String(targetIndex)]: prompt,
    },
  }));
  state.thumbnailPromptIndex = targetIndex;
  state.editingThumbnailIndex = 0;
  state.editingThumbnailPrompt = "";
  generateKieAssetsForLatestPackage({
    thumbnails: [targetIndex],
    visualHooks: [],
    editThumbnail: true,
    editThumbnailSourceIndex: sourceIndex,
  });
}

function renderThumbnailPromptModal(packageData) {
  const index = Number(state.editingThumbnailIndex || 0);
  if (!index || !packageData) return "";
  return `
    <div class="prompt-modal-backdrop" data-close-thumb-edit-modal>
      <form class="prompt-modal" data-thumb-edit-form>
        <div class="prompt-modal-head">
          <div>
            <p class="eyebrow">Thumbnail ${index}</p>
            <h4>Edit Prompt</h4>
          </div>
          <button type="button" aria-label="Close edit prompt" data-cancel-thumb-edit>Close</button>
        </div>
        <textarea data-edit-thumb-text spellcheck="true">${escapeHtml(state.editingThumbnailPrompt)}</textarea>
        <div class="prompt-modal-actions">
          <button type="button" data-cancel-thumb-edit>Cancel</button>
          <button type="submit" name="thumbnailEditMode" value="variation">Create New Variation</button>
          <button type="submit" class="primary" name="thumbnailEditMode" value="replace">Replace Current</button>
        </div>
      </form>
    </div>
  `;
}

function renderAssetPreviewModal() {
  const asset = state.previewAsset;
  if (!asset?.url) return "";
  const filename = asset.filename || "youtube-gen-thumbnail.png";
  const isVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(asset.url) || /\.(mp4|webm|mov)$/i.test(filename);
  const media = isVideo
    ? `<video src="${escapeHtml(asset.url)}" controls preload="metadata"></video>`
    : `<img src="${escapeHtml(asset.url)}" alt="${escapeHtml(filename)}" />`;
  const downloadControl = isVideo
    ? `<a href="${escapeHtml(asset.url)}" download="${escapeHtml(filename)}">Download</a>`
    : `<button type="button" data-download-asset="${escapeHtml(asset.url)}" data-download-filename="${escapeHtml(filename)}">Save to Downloads</button>`;
  return `
    <div class="asset-preview-backdrop" data-close-asset-preview>
      <div class="asset-preview-modal" role="dialog" aria-modal="true" aria-label="Asset preview">
        <div class="asset-preview-head">
          <div>
            <p class="eyebrow">Preview</p>
            <h4>${escapeHtml(filename)}</h4>
          </div>
          <button type="button" data-close-asset-preview-button>Close</button>
        </div>
        ${media}
        <div class="asset-preview-actions">
          ${downloadControl}
        </div>
      </div>
    </div>
  `;
}

async function generateKieAssetsForLatestPackage(targets = null) {
  const latestPackage = state.remakePackages[0];
  if (!latestPackage || state.assetGenerationLoading) return;
  const targetLabel = targets?.thumbnails?.length === 1
    ? `thumbnail ${targets.thumbnails[0]}`
    : targets?.visualHooks?.length === 1
      ? `visual hook ${targets.visualHooks[0]}`
      : targets?.thumbnails?.length > 1
        ? `${targets.thumbnails.length} thumbnails`
        : "thumbnails and visual hooks";

  state.assetGenerationLoading = true;
  state.assetGenerationTarget = targets;
  state.assetProgress = {
    percent: 0,
    step: "Starting Kie",
    detail: `Preparing ${targetLabel}.`,
    status: "progress",
    partialAssets: { references: [], thumbnails: [], visualHooks: [] },
    events: [],
  };
  state.channelError = "";
  state.channelStatus = `Generating ${targetLabel} with Nano Banana Pro...`;
  update();

  let lastError = "";
  try {
    for (const apiUrl of KIE_ASSET_API_URLS) {
      try {
        const kieApiKey = loadKieApiKey();
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(kieApiKey ? { "x-kie-api-key": kieApiKey } : {}),
          },
          body: JSON.stringify({
            package: latestPackage,
            targets,
            existingAssets: latestPackage.assets || {},
            promptOverrides: thumbnailPromptEdits(latestPackage),
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Kie generation failed with ${response.status}`);
        }
        const assets = await readProgressStream(response, updateAssetProgress, "assets");
        saveAssetsToCurrentPackage(assets);
        if (!assetsSatisfyTargets(assets, targets)) {
          const partialCount = assetResultCount(assets);
          state.assetProgress = {
            percent: Math.max(60, state.assetProgress?.percent || 0),
            step: "Partial assets saved",
            detail: `Saved ${partialCount} generated asset${partialCount === 1 ? "" : "s"}. Regenerate the missing option${partialCount === 1 ? "" : "s"}.`,
            status: "partial",
            partialAssets: assets,
            events: [],
          };
          state.channelStatus = `Saved ${partialCount} generated asset${partialCount === 1 ? "" : "s"}. Regenerate the missing option${partialCount === 1 ? "" : "s"}.`;
          state.channelError = "";
          return;
        }
        state.channelStatus = `Generated ${targetLabel}.`;
        state.channelError = "";
        return;
      } catch (error) {
        const partialAssets = assetsFromProgress(state.assetProgress);
        if (assetsSatisfyTargets(partialAssets, targets)) {
          saveAssetsToCurrentPackage(partialAssets);
          state.assetProgress = {
            percent: 100,
            step: "Kie assets complete",
            detail: `Generated ${targetLabel}.`,
            status: "complete",
            partialAssets,
            events: [],
          };
          state.channelStatus = `Generated ${targetLabel}.`;
          state.channelError = "";
          return;
        }
        const partialCount = assetResultCount(partialAssets);
        if (partialCount > 0) {
          saveAssetsToCurrentPackage(partialAssets);
          state.assetProgress = {
            percent: Math.max(60, state.assetProgress?.percent || 0),
            step: "Partial assets saved",
            detail: `Saved ${partialCount} generated asset${partialCount === 1 ? "" : "s"}. Regenerate the missing option${partialCount === 1 ? "" : "s"}.`,
            status: "partial",
            partialAssets,
            events: [],
          };
          state.channelStatus = `Saved ${partialCount} generated asset${partialCount === 1 ? "" : "s"}. Regenerate the missing option${partialCount === 1 ? "" : "s"}.`;
          state.channelError = "";
          return;
        }
        if (error.name === "GenerationError") throw error;
        lastError = error.message;
      }
    }
    throw new Error(lastError || "Kie asset generator is not configured.");
  } catch (error) {
    if (state.assetProgress?.status !== "error") {
      updateAssetProgress({
        status: "error",
        percent: state.assetProgress?.percent || 0,
        step: "Asset generation failed",
        detail: error.message,
        error: error.message,
      });
    }
    state.channelError = lastError && /fetch|failed|NetworkError|Load failed/i.test(lastError)
      ? "Kie asset generator is not configured."
      : error.message;
    state.channelStatus = "";
  } finally {
    state.assetGenerationLoading = false;
    state.assetGenerationTarget = null;
    update();
  }
}

function displayValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value.title) return String(value.title);
  if (value.prompt) return String(value.prompt);
  if (value.text) return String(value.text);
  return JSON.stringify(value);
}

function sourceRowsForPackage(packageData) {
  const sources = Array.isArray(packageData?.sourceVideos) ? packageData.sourceVideos : [];
  return sources.map((source) => {
    const row = state.rows.find((item) => item.id === source.id);
    if (row) return row;
    return {
      ...source,
      thumbnail: source.thumbnail || `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg`,
      url: source.url || `https://www.youtube.com/watch?v=${source.id}`,
      topicBucket: source.topicBucket || "",
      topicBuckets: source.topicBucket ? String(source.topicBucket).split(",").map((item) => item.trim()) : [],
      contentStyle: source.contentStyle || "",
      views_vs_median: source.views_vs_median || 0,
      outlierMultiple: source.views_vs_median || 0,
      duration_seconds: source.duration_seconds || 0,
    };
  });
}

function formatMultiline(value) {
  if (Array.isArray(value)) return value.map(displayValue).join("\n");
  return displayValue(value);
}

function renderSourceCard(row, isSelected = false) {
  const videoUrl = row.url || `https://www.youtube.com/watch?v=${row.id}`;
  const subscriberCount = Number(row.channel_subscribers || row.channelSubscribers || 0);
  const tags = [
    `${Number(row.views_vs_median || row.outlierMultiple || 0).toFixed(2)}x outlier`,
    `${compactNumber(Number(row.views || 0))} views`,
    subscriberCount ? `${compactNumber(subscriberCount)} subs` : "",
    row.topicBuckets?.join(", ") || row.topicBucket || row.trendQuery || "Source signal",
    row.contentStyle,
    isSelected ? "Selected" : "",
  ].filter(Boolean);
  return `
    <article class="idea-source-card${isSelected ? " selected" : ""}" data-select-remake="${escapeHtml(row.id)}" tabindex="0" role="button" aria-pressed="${isSelected ? "true" : "false"}">
      <div class="thumb-link" aria-hidden="true">
        <img class="thumb" src="${row.thumbnail}" alt="" loading="lazy" />
        <span class="duration">${formatDuration(row.duration_seconds)}</span>
      </div>
      <div class="idea-source-body">
        <a class="title" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener noreferrer" data-video-title-link>${escapeHtml(row.title)}</a>
        <div class="meta">
          <span class="channel">${escapeHtml(channelHandle(row))}</span>
          <span class="dot">•</span>
          <span>${escapeHtml(rowAgeLabel(row))}</span>
        </div>
        <div class="idea-source-tags">
          ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderPackageList(items, className = "") {
  const list = Array.isArray(items) ? items : [];
  return `
    <ol class="package-card-list ${className}">
      ${list.map((item, index) => `
        <li>
          <span>${index + 1}</span>
          <p>${escapeHtml(displayValue(item))}</p>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderHooks(hooks, selectedIndex = null) {
  const list = Array.isArray(hooks) ? hooks : [];
  return list.map((hook, index) => `
    <article class="hook-item ${selectedIndex === index ? "selected" : ""}" data-select-word-hook="${index}" tabindex="0" role="button" aria-pressed="${selectedIndex === index ? "true" : "false"}">
      <div class="hook-summary">
        <span>Hook ${index + 1}</span>
        <strong>${escapeHtml(hook.textOverlay || hook.overlay || "Open loop")}</strong>
      </div>
      <div class="hook-body" ${selectedIndex === index ? "" : "hidden"}>
        <div>
          <h5>Word-For-Word Intro</h5>
          <p>${escapeHtml(hook.spokenIntro || hook.spoken || "").replaceAll("\n", "<br>")}</p>
        </div>
      </div>
    </article>
  `).join("");
}

function renderScript(script) {
  if (!script) return "";
  const fullText = scriptFullText(script);
  const wordCount = countWords(fullText);
  const targetWords = typeof script === "object" && script?.targetLengthWords ? Number(script.targetLengthWords) : 0;
  const isShort = targetWords > 0 && wordCount > 0 && wordCount < targetWords;
  const isAnalysis = scriptLooksLikeAnalysis(fullText);
  if (fullText) {
    return `
      <div class="script-full-read ${isShort || isAnalysis ? "short" : ""}">
        <div class="script-full-meta">
          <span>${wordCount.toLocaleString()} words</span>
        </div>
        ${isShort ? `<div class="script-short-alert">This script is under target. Generate the package again to auto-retry until the full script reaches the target word count.</div>` : ""}
        ${isAnalysis ? `<div class="script-short-alert">This saved draft is old analysis text, not a word-for-word script. Regenerate the package to replace it.</div>` : ""}
        <div class="script-full-text">${escapeHtml(fullText).replaceAll("\n", "<br>")}</div>
      </div>
    `;
  }
  return `
    <div class="script-full-read">
      <div class="script-full-text empty">No full word-for-word script was generated. Generate the package again.</div>
    </div>
  `;
}

function renderScriptCompare(packageData) {
  const script = packageData?.script || {};
  const originalText = originalTranscriptText(packageData);
  const rewriteText = scriptFullText(script);
  const originalWords = countWords(originalText);
  const rewriteWords = countWords(rewriteText);
  const targetWords = typeof script === "object" && script?.targetLengthWords ? Number(script.targetLengthWords) : 0;
  const isShort = targetWords > 0 && rewriteWords > 0 && rewriteWords < targetWords;
  const isAnalysis = scriptLooksLikeAnalysis(rewriteText);
  const missingSourceTranscript = Boolean(rewriteText) && !scriptHasSourceTranscript(packageData);
  const rewrittenAt = script?.rewrittenAt ? new Date(script.rewrittenAt) : null;
  const rewrittenLabel = rewrittenAt && !Number.isNaN(rewrittenAt.getTime())
    ? `Rewritten ${rewrittenAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";
  const rewriteMode = script?.rewriteMode === "source-adapted"
    ? "Adapted source rewrite"
    : script?.rewriteMode === "source-order"
      ? "Source-order rewrite"
      : "";
  const rewriteMeta = [rewrittenLabel, rewriteMode].filter(Boolean).join(" • ");

  return `
    <div class="script-compare-grid">
      <section class="script-compare-pane">
        <div class="script-pane-head">
          <div>
            <h5>Original Transcript</h5>
            <p>${escapeHtml(originalTranscriptSourceLabel(packageData))}</p>
          </div>
          <span>${originalWords.toLocaleString()} words</span>
        </div>
        <div class="script-pane-body">
          ${originalText
            ? escapeHtml(originalText).replaceAll("\n", "<br>")
            : `<span class="script-pane-empty">No transcript is saved on this project yet. Click Rewrite Script to fetch the source transcript and rebuild the script.</span>`}
        </div>
      </section>
      <section class="script-compare-pane rewrite">
        <div class="script-pane-head">
          <div>
            <h5>Rewrite</h5>
            <p>${escapeHtml(rewriteMeta || "Ready-to-record spoken script")}</p>
          </div>
          <span>${rewriteWords.toLocaleString()} words</span>
        </div>
        ${isShort ? `<div class="script-short-alert">This script is under target. Rewrite it again to auto-retry until the full script reaches the target word count.</div>` : ""}
        ${isAnalysis ? `<div class="script-short-alert">This saved draft is old analysis text, not a word-for-word script. Rewrite it to replace the draft.</div>` : ""}
        ${missingSourceTranscript ? `<div class="script-short-alert">This rewrite is missing the original transcript, so it is not valid. Click Rewrite Script to fetch the source transcript and rebuild it.</div>` : ""}
        <div class="script-pane-body">
          ${rewriteText
            ? escapeHtml(rewriteText).replaceAll("\n", "<br>")
            : `<span class="script-pane-empty">No rewritten script was generated yet.</span>`}
        </div>
      </section>
    </div>
  `;
}

function renderScriptEditCompare(packageData) {
  const originalText = originalTranscriptText(packageData);
  const originalWords = countWords(originalText);
  return `
    <div class="script-compare-grid editing">
      <section class="script-compare-pane">
        <div class="script-pane-head">
          <div>
            <h5>Original Transcript</h5>
            <p>${escapeHtml(originalTranscriptSourceLabel(packageData))}</p>
          </div>
          <span>${originalWords.toLocaleString()} words</span>
        </div>
        <div class="script-pane-body">
          ${originalText
            ? escapeHtml(originalText).replaceAll("\n", "<br>")
            : `<span class="script-pane-empty">No transcript is saved on this project yet. Rewrite Script will fetch it.</span>`}
        </div>
      </section>
      <form class="script-editor script-compare-pane rewrite" data-script-edit-form>
        <div class="script-pane-head">
          <div>
            <h5>Rewrite</h5>
            <p>Editable spoken script</p>
          </div>
          <span>${countWords(state.scriptDraft).toLocaleString()} words</span>
        </div>
        <textarea data-script-draft spellcheck="true">${escapeHtml(state.scriptDraft)}</textarea>
        <div class="script-editor-actions">
          <button type="button" data-cancel-script-edit>Cancel</button>
          <button type="submit" class="primary">Save Script</button>
        </div>
      </form>
    </div>
  `;
}

function scriptFullText(script) {
  if (!script) return "";
  if (typeof script === "string") return script.trim();
  const direct = script.fullScript || script.wordForWordScript || script.scriptText || script.finalScript || "";
  if (direct) return String(direct).trim();
  return "";
}

function originalTranscriptText(packageData) {
  const script = packageData?.script;
  if (script && typeof script === "object" && script.originalTranscript) {
    return String(script.originalTranscript || "").trim();
  }
  const analysis = packageData?.sourceAnalysis;
  if (analysis && typeof analysis === "object" && analysis.originalTranscript) {
    return String(analysis.originalTranscript || "").trim();
  }
  return "";
}

function originalTranscriptSourceLabel(packageData) {
  const script = packageData?.script;
  if (script && typeof script === "object" && script.originalTranscriptSource) {
    return `Fetched from ${script.originalTranscriptSource}`;
  }
  const status = packageData?.sourceAnalysis?.transcriptStatus || "";
  if (/Transcript fetched/i.test(status)) return status;
  return "Fetched when the script is rewritten";
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function scriptHasSourceTranscript(packageData) {
  const originalText = originalTranscriptText(packageData);
  return countWords(originalText) >= 100;
}

function scriptLooksLikeAnalysis(text) {
  return /This source video worked because|first thing I would pull|the job is to ask why|For this package|I would build around|The opening should be direct|The source is the blueprint/i.test(String(text || ""));
}

function scriptMeetsTarget(script, packageData = null) {
  const fullText = scriptFullText(script);
  if (!fullText) return false;
  if (scriptLooksLikeAnalysis(fullText)) return false;
  if (packageData && !scriptHasSourceTranscript(packageData)) return false;
  const targetWords = typeof script === "object" && script?.targetLengthWords ? Number(script.targetLengthWords) : 0;
  return !targetWords || countWords(fullText) >= targetWords;
}

function beginScriptEdit(packageData) {
  state.editingScript = true;
  state.scriptDraft = scriptFullText(packageData?.script);
  update();
}

function cancelScriptEdit() {
  state.editingScript = false;
  state.scriptDraft = "";
  update();
}

function saveScriptEdit() {
  const text = String(state.scriptDraft || "").trim();
  if (!text) {
    state.channelError = "Add script text before saving.";
    state.channelStatus = "";
    update();
    return;
  }
  updateLatestPackage((pkg) => {
    const script = typeof pkg.script === "object" && pkg.script ? pkg.script : {};
    return {
      ...pkg,
      script: {
        ...script,
        fullScript: text,
        wordForWordIntro: script.wordForWordIntro || text.split(/\s+/).slice(0, 250).join(" "),
        editedAt: new Date().toISOString(),
      },
    };
  });
  state.editingScript = false;
  state.scriptDraft = "";
  state.channelError = "";
  state.channelStatus = "Script saved.";
  update();
}

function copyTextSynchronously(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function copyTextToClipboard(text, successMessage = "Copied.") {
  const value = String(text || "").trim();
  if (!value) {
    state.channelError = "Nothing to copy yet.";
    state.channelStatus = "";
    update();
    return false;
  }

  try {
    let copied = false;
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
    if (!copied) copied = copyTextSynchronously(value);
    if (!copied) throw new Error("Clipboard copy was blocked by the browser.");
    state.channelError = "";
    state.channelStatus = successMessage;
    update();
    return true;
  } catch (error) {
    try {
      if (!copyTextSynchronously(value)) throw error;
      state.channelError = "";
      state.channelStatus = successMessage;
      update();
      return true;
    } catch (fallbackError) {
      state.channelError = fallbackError.message || "Copy failed.";
      state.channelStatus = "";
      update();
      return false;
    }
  }
}

async function copyTextToClipboardFromClick(text, successMessage = "Copied.") {
  const value = String(text || "").trim();
  if (!value) {
    state.channelError = "Nothing to copy yet.";
    state.channelStatus = "";
    update();
    return false;
  }

  try {
    if (copyTextSynchronously(value)) {
      state.channelError = "";
      state.channelStatus = successMessage;
      update();
      return true;
    }
  } catch {
    // Try the async Clipboard API below.
  }

  return copyTextToClipboard(value, successMessage);
}

function normalizeAvatarBrowserUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "https://app.heygen.com/";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function currentAvatarBrowserUrl() {
  return normalizeAvatarBrowserUrl(state.avatarBrowserUrl || "https://app.heygen.com/");
}

function avatarVideoForPackage(packageData) {
  return packageData?.assets?.avatarVideo || null;
}

function avatarVideoUrl(packageData) {
  return assetPrimaryUrl(avatarVideoForPackage(packageData));
}

function avatarVideoHasWorkingSource(packageData) {
  const video = avatarVideoForPackage(packageData);
  const url = assetPrimaryUrl(video);
  if (video?.localFileId) {
    return avatarVideoFiles.has(video.localFileId);
  }
  return Boolean(url && !String(url).startsWith("blob:"));
}

function avatarVideoHasStaleBrowserSource(packageData) {
  const video = avatarVideoForPackage(packageData);
  const url = assetPrimaryUrl(video);
  if (!video || !url) return false;
  if (String(url).startsWith("blob:")) return !avatarVideoHasWorkingSource(packageData);
  return Boolean(video.localFileId && !avatarVideoFiles.has(video.localFileId));
}

function avatarVideoNeedsCodexReattach(packageData) {
  const video = avatarVideoForPackage(packageData);
  if (video?.localFileId) return false;
  const job = heygenCodexJobForPackage(packageData);
  const hasKnownJob = Boolean(job?.id && job.statusUrl);
  return Boolean((hasKnownJob || avatarVideoHasStaleBrowserSource(packageData)) && !avatarVideoHasWorkingSource(packageData));
}

function showReattachAvatarVideoError() {
  state.assetProgress = {
    percent: 0,
    step: "Reattach finished MP4",
    detail: "The browser lost access to the selected HeyGen file. Click Replace Finished MP4 and choose the downloaded video again.",
    status: "error",
    events: [],
  };
  state.channelError = "The browser lost access to the selected HeyGen MP4. Click Replace Finished MP4 and choose the downloaded file again.";
  state.channelStatus = "";
  update();
}

function currentEditorHandoffDriveFolderOverride(packageData) {
  const title = selectedPackageTitle(packageData);
  const folder = packageData?.assets?.driveFolder || null;
  const folderId = folder?.id || "";
  if (title !== CURRENT_EDITOR_HANDOFF_TITLE) return null;
  if (!folder || STALE_EDITOR_HANDOFF_DRIVE_FOLDER_IDS.has(folderId)) {
    return CURRENT_EDITOR_HANDOFF_DRIVE_FOLDER;
  }
  return null;
}

function driveFolderForPackage(packageData) {
  return currentEditorHandoffDriveFolderOverride(packageData) || packageData?.assets?.driveFolder || null;
}

function driveFolderUrl(packageData) {
  const folder = driveFolderForPackage(packageData);
  return folder?.webViewLink || folder?.url || "";
}

function avatarScriptText(packageData) {
  return scriptFullText(packageData?.script);
}

function avatarFileId() {
  return `avatar_file_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function cleanAvatarFilename(filename, fallbackTitle = "heygen-avatar") {
  const name = String(filename || "").trim();
  if (name) return name;
  const cleanTitle = String(fallbackTitle || "heygen-avatar")
    .replace(/[^\w\s().+-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 100);
  return `${cleanTitle || "heygen-avatar"}.mp4`;
}

function readVideoDuration(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration || 0);
      video.removeAttribute("src");
      video.load();
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    video.onerror = () => resolve(0);
    video.src = url;
  });
}

async function attachAvatarVideoFile(file) {
  const current = latestPackage();
  if (!current) return;
  if (!file || !String(file.type || "").startsWith("video/")) {
    state.channelError = "Choose the finished HeyGen MP4 video file.";
    state.channelStatus = "";
    update();
    return;
  }

  const previous = avatarVideoForPackage(current);
  if (previous?.localFileId) {
    const previousUrl = avatarVideoObjectUrls.get(previous.localFileId);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    avatarVideoFiles.delete(previous.localFileId);
    avatarVideoObjectUrls.delete(previous.localFileId);
  }

  const localFileId = avatarFileId();
  const url = URL.createObjectURL(file);
  const durationSeconds = await readVideoDuration(url);
  avatarVideoFiles.set(localFileId, file);
  avatarVideoObjectUrls.set(localFileId, url);

  updateLatestPackage((pkg) => ({
    ...pkg,
    assets: {
      ...(pkg.assets || {}),
      avatarVideo: {
        id: localFileId,
        localFileId,
        title: selectedPackageTitle(pkg),
        status: "completed",
        url,
        filename: cleanAvatarFilename(file.name, selectedPackageTitle(pkg)),
        durationSeconds,
        sizeBytes: file.size,
        source: "HeyGen",
        importedAt: new Date().toISOString(),
        settings: {
          avatar: HEYGEN_LOCKED_SETTINGS.avatarName,
          voice: HEYGEN_LOCKED_SETTINGS.voiceName,
          motionEngine: HEYGEN_LOCKED_SETTINGS.motionEngine,
          output: `${HEYGEN_LOCKED_SETTINGS.aspectRatio} ${HEYGEN_LOCKED_SETTINGS.outputFormat}`,
          fps: 30,
        },
      },
    },
  }));
  state.assetProgress = {
    percent: 100,
    step: "HeyGen MP4 attached",
    detail: "The finished avatar video is now in the preview player and ready for Drive upload.",
    status: "complete",
    events: [],
  };
  state.channelError = "";
  state.channelStatus = "HeyGen MP4 attached to the preview player.";
  update();
}

function heygenCodexJobForPackage(packageData) {
  return packageData?.assets?.heygenCodexJob || null;
}

function heygenCodexJobIsActive(job) {
  return ["queued", "running", "processing"].includes(String(job?.status || ""));
}

function heygenCodexDownloadCheckIsDue(status, job) {
  if (String(status?.status || "") !== "processing") return false;
  const nextCheckAt = status?.nextCheckAt || job?.nextCheckAt || "";
  if (!nextCheckAt) return false;
  const nextCheckTime = Date.parse(nextCheckAt);
  if (!Number.isFinite(nextCheckTime)) return false;
  return Date.now() >= nextCheckTime && job?.downloadCheckFor !== nextCheckAt;
}

async function localNetworkPermissionState() {
  if (!navigator.permissions?.query) return "";
  for (const name of ["local-network-access", "local-network", "loopback-network"]) {
    try {
      const status = await navigator.permissions.query({ name });
      if (status?.state) return status.state;
    } catch {
      // Browser support is still uneven, so try the next known permission name.
    }
  }
  return "";
}

async function fetchLocalBridgeUrls(urls, path = "", init = {}) {
  const errors = [];
  for (const baseUrl of urls) {
    const url = path
      ? `${baseUrl}${path.startsWith("?") ? path : `/${path.replace(/^\/+/, "")}`}`
      : baseUrl;
    try {
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Cloud helper returned ${response.status}.`);
      }
      return { payload, baseUrl };
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  throw new Error(`AIOS cloud helper is not reachable. ${errors.filter(Boolean).join(" ")}`);
}

async function fetchLocalHeyGenCodexBridge(path = "", init = {}) {
  return fetchLocalBridgeUrls(LOCAL_HEYGEN_CODEX_BRIDGE_URLS, path, init);
}

async function uploadLocalAvatarFileWithBridge(sessionPayload, file) {
  const { payload } = await fetchLocalBridgeUrls(LOCAL_DRIVE_FILE_UPLOAD_BRIDGE_URLS, "", {
    method: "POST",
    headers: {
      "Content-Type": file?.type || "video/mp4",
      "X-Drive-Upload-Url": sessionPayload.uploadUrl,
      "X-Avatar-Mime-Type": file?.type || "video/mp4",
    },
    body: file,
  });
  if (!payload.videoFile?.id) {
    throw new Error("Local bridge uploaded the MP4, but Google Drive did not return a video file id.");
  }
  return payload.videoFile;
}

function driveMultipartUploadBody(metadata, file, mimeType) {
  const boundary = `youtube_gen_browser_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    body: new Blob([
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata || {}),
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--\r\n`,
    ], { type: `multipart/related; boundary=${boundary}` }),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

async function uploadLocalAvatarFileWithGoogleBrowserSession(sessionPayload, file) {
  const upload = sessionPayload?.browserUpload || {};
  if (!upload.endpoint || !upload.accessToken || !upload.metadata) {
    throw new Error("Google Drive browser upload session is missing.");
  }
  const mimeType = String(upload.mimeType || file?.type || "video/mp4").split(";")[0] || "video/mp4";
  const { body, contentType } = driveMultipartUploadBody(upload.metadata, file, mimeType);
  const response = await fetch(upload.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${upload.accessToken}`,
      "Content-Type": contentType,
    },
    body,
  });
  const uploadedVideo = await response.json().catch(() => ({}));
  if (!response.ok || !uploadedVideo.id) {
    throw new Error(uploadedVideo.error?.message || `Video upload failed with ${response.status}.`);
  }
  return uploadedVideo;
}

async function startHeyGenCodexDownloadCheck(jobId, nextCheckAt = "") {
  if (!jobId) return;
  const { payload } = await fetchLocalHeyGenCodexBridge("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "download",
      jobId,
    }),
  });
  updateLatestPackage((pkg) => ({
    ...pkg,
    assets: {
      ...(pkg.assets || {}),
      heygenCodexJob: {
        ...(pkg.assets?.heygenCodexJob || {}),
        status: payload.status?.status || "running",
        step: payload.status?.step || "Checking HeyGen download",
        message: payload.status?.message || "Codex is briefly checking HeyGen for the finished MP4.",
        downloadCheckFor: nextCheckAt || payload.status?.nextCheckAt || new Date().toISOString(),
        updatedAt: payload.status?.updatedAt || new Date().toISOString(),
      },
    },
  }));
  state.channelStatus = "Codex is briefly checking HeyGen for the finished MP4.";
  update();
}

async function fetchLatestCompletedHeyGenCodexStatus() {
  const { payload } = await fetchLocalHeyGenCodexBridge("?latest=1", {
    cache: "no-store",
  });
  return payload.status || null;
}

async function startHeyGenCodexAutomation(packageData) {
  const current = packageData || latestPackage();
  if (!current) return;
  const script = avatarScriptText(current);
  if (!script) {
    state.channelError = "No Step 5 script is ready for Codex.";
    state.channelStatus = "";
    update();
    return;
  }

  state.assetGenerationLoading = true;
  state.assetGenerationTarget = { heygenCodex: true };
  state.assetProgress = {
    percent: 5,
    step: "Starting Codex HeyGen job",
    detail: "Connecting to the AIOS cloud helper.",
    status: "active",
    events: [],
  };
  state.channelError = "";
  state.channelStatus = "Starting Codex HeyGen automation...";
  update();

  try {
    const { payload, baseUrl } = await fetchLocalHeyGenCodexBridge("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedPackageTitle(current),
        script,
        projectId: current.projectId || current.id || "",
      }),
    });
    const job = {
      id: payload.job?.id,
      statusUrl: payload.statusUrl || `${baseUrl}?jobId=${encodeURIComponent(payload.job?.id || "")}`,
      title: selectedPackageTitle(current),
      status: payload.status?.status || "queued",
      step: payload.status?.step || "Queued",
      message: payload.status?.message || "Codex HeyGen job queued.",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateLatestPackage((pkg) => ({
      ...pkg,
      assets: {
        ...(pkg.assets || {}),
        heygenCodexJob: job,
      },
    }));
    state.assetProgress = {
      percent: 15,
      step: "Codex job queued",
      detail: "Codex is using the HeyGen Avatar Web UI skill. This can take 20 minutes or more.",
      status: "active",
      events: [],
    };
    state.channelError = "";
    state.channelStatus = "Codex HeyGen job started. Keep this app open to auto-attach the finished MP4.";
    pollHeyGenCodexJob(job.id, job.statusUrl, true);
  } catch (error) {
    state.assetProgress = {
      percent: 0,
      step: "Codex bridge unavailable",
      detail: error.message || "Could not start Codex HeyGen automation.",
      status: "error",
      events: [],
    };
    state.channelError = error.message || "Could not start Codex HeyGen automation.";
    state.channelStatus = "";
  } finally {
    state.assetGenerationLoading = false;
    state.assetGenerationTarget = null;
    update();
  }
}

async function pollHeyGenCodexJob(jobId, statusUrl, immediate = false) {
  if (!jobId || !statusUrl) return;
  if (heygenCodexPollTimers.has(jobId)) {
    clearTimeout(heygenCodexPollTimers.get(jobId));
    heygenCodexPollTimers.delete(jobId);
  }

  const run = async () => {
    try {
      const response = await fetch(statusUrl, {
        mode: "cors",
        cache: "no-store",
        targetAddressSpace: "loopback",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Status check failed with ${response.status}.`);
      const status = payload.status || {};
      const current = latestPackage();
      const nextJob = {
        ...(heygenCodexJobForPackage(current) || {}),
        id: jobId,
        statusUrl,
        status: status.status || "running",
        step: status.step || "Running",
        message: status.message || "Codex HeyGen automation is running.",
        updatedAt: status.updatedAt || new Date().toISOString(),
        submittedAt: status.submittedAt || "",
        nextCheckAt: status.nextCheckAt || "",
        videoUrl: status.videoUrl || "",
        videoFilename: status.videoFilename || "",
      };
      updateLatestPackage((pkg) => ({
        ...pkg,
        assets: {
          ...(pkg.assets || {}),
          heygenCodexJob: nextJob,
        },
      }));
      state.assetProgress = {
        percent: status.status === "complete" ? 95 : 35,
        step: status.step || "Codex HeyGen job",
        detail: status.message || "Codex is working in HeyGen.",
        status: status.status === "error" ? "error" : status.status === "complete" ? "complete" : "active",
        events: [],
      };
      state.channelError = status.status === "error" ? (status.error || status.message || "Codex HeyGen job failed.") : "";
      state.channelStatus = status.status === "error" ? "" : (status.message || "Codex HeyGen job checked.");
      update();

      if (status.status === "complete" && status.videoUrl) {
        await attachAvatarVideoFromCodexJob(status);
        return;
      }
      if (heygenCodexDownloadCheckIsDue(status, nextJob)) {
        await startHeyGenCodexDownloadCheck(jobId, status.nextCheckAt || "");
        const timer = setTimeout(() => pollHeyGenCodexJob(jobId, statusUrl), 30_000);
        heygenCodexPollTimers.set(jobId, timer);
        return;
      }
      if (status.status !== "error") {
        const timer = setTimeout(() => pollHeyGenCodexJob(jobId, statusUrl), 30_000);
        heygenCodexPollTimers.set(jobId, timer);
      }
    } catch (error) {
      state.channelError = error.message || "Could not check Codex HeyGen job.";
      state.channelStatus = "";
      update();
      const timer = setTimeout(() => pollHeyGenCodexJob(jobId, statusUrl), 60_000);
      heygenCodexPollTimers.set(jobId, timer);
    }
  };

  if (immediate) {
    await run();
  } else {
    const timer = setTimeout(run, 30_000);
    heygenCodexPollTimers.set(jobId, timer);
  }
}

function maybeAutoAttachCompletedHeyGenVideo() {
  const current = latestPackage();
  const job = heygenCodexJobForPackage(current);
  if (!current) return;
  if (!avatarVideoNeedsCodexReattach(current)) return;
  const savedStatus = String(job?.status || "").toLowerCase();
  if (job?.id && job.statusUrl && !["complete", "stopped", "error"].includes(savedStatus)) return;
  if (job?.id && heygenCodexPollTimers.has(job.id)) return;
  const key = job?.id && job.statusUrl
    ? `${job.id}:${job.statusUrl}`
    : `latest:${assetPrimaryUrl(avatarVideoForPackage(current))}:${selectedPackageTitle(current)}`;
  if (heygenCodexAutoAttachAttempts.has(key)) return;
  heygenCodexAutoAttachAttempts.add(key);
  queueMicrotask(() => {
    if (job?.id && job.statusUrl) {
      pollHeyGenCodexJob(job.id, job.statusUrl, true);
    } else {
      recoverAvatarVideoFromCodexJob(current);
    }
  });
}

async function attachAvatarVideoFromCodexJob(status) {
  const videoUrl = status.videoUrl || "";
  if (!videoUrl) return;
  state.channelError = "";
  state.channelStatus = "Downloading completed HeyGen MP4 from local Codex...";
  update();
  const response = await fetch(videoUrl, {
    mode: "cors",
    targetAddressSpace: "loopback",
  });
  if (!response.ok) throw new Error(`Could not fetch Codex-downloaded MP4. Status ${response.status}.`);
  const blob = await response.blob();
  const filename = status.videoFilename || "heygen-avatar.mp4";
  const file = new File([blob], filename, { type: blob.type || "video/mp4" });
  await attachAvatarVideoFile(file);
  updateLatestPackage((pkg) => ({
    ...pkg,
    assets: {
      ...(pkg.assets || {}),
      heygenCodexJob: {
        ...(pkg.assets?.heygenCodexJob || {}),
        id: status.jobId || pkg.assets?.heygenCodexJob?.id || "",
        videoUrl: status.videoUrl || pkg.assets?.heygenCodexJob?.videoUrl || "",
        videoFilename: status.videoFilename || pkg.assets?.heygenCodexJob?.videoFilename || "",
        status: "complete",
        step: "HeyGen MP4 attached",
        message: "Codex downloaded the HeyGen MP4 and attached it to the preview player.",
        completedAt: new Date().toISOString(),
      },
      avatarVideo: {
        ...(pkg.assets?.avatarVideo || {}),
        source: "Codex HeyGen",
        codexJobId: status.jobId || pkg.assets?.heygenCodexJob?.id || "",
        codexVideoUrl: status.videoUrl || "",
      },
    },
    approvals: {
      ...(pkg.approvals || {}),
      avatar: true,
    },
  }));
  state.channelError = "";
  state.channelStatus = "Codex downloaded the HeyGen MP4 and attached it to the preview player.";
  update();
}

async function recoverAvatarVideoFromCodexJob(packageData) {
  const job = heygenCodexJobForPackage(packageData);
  state.channelError = "";
  state.channelStatus = "Recovering the finished HeyGen MP4 from local Codex...";
  state.assetProgress = {
    percent: 25,
    step: "Recovering HeyGen MP4",
    detail: "The browser lost the refreshed file handle, so AIOS is pulling the completed MP4 back from Codex.",
    status: "active",
    events: [],
  };
  update();
  try {
    let status = null;
    if (job?.id && job.statusUrl) {
      try {
        const response = await fetch(job.statusUrl, {
          mode: "cors",
          cache: "no-store",
          targetAddressSpace: "loopback",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || `Codex status check failed with ${response.status}.`);
        }
        status = payload.status || null;
      } catch {
        const latestStatus = await fetchLatestCompletedHeyGenCodexStatus();
        status = latestStatus || null;
      }
    } else {
      status = await fetchLatestCompletedHeyGenCodexStatus();
    }
    if ((status?.status !== "complete" || !status.videoUrl) && avatarVideoHasStaleBrowserSource(packageData)) {
      status = await fetchLatestCompletedHeyGenCodexStatus();
    }
    if (status?.status !== "complete" || !status.videoUrl) {
      throw new Error(status?.message || "The finished HeyGen MP4 is not available from Codex yet.");
    }
    await attachAvatarVideoFromCodexJob(status);
    return avatarVideoHasWorkingSource(latestPackage());
  } catch (error) {
    state.assetProgress = {
      percent: 0,
      step: "HeyGen MP4 recovery failed",
      detail: error.message || "Could not recover the finished HeyGen MP4 from Codex.",
      status: "error",
      events: [],
    };
    state.channelError = error.message || "Could not recover the finished HeyGen MP4 from Codex.";
    state.channelStatus = "";
    update();
    return false;
  }
}

async function prepareHeyGenPluginHandoff() {
  const current = latestPackage();
  if (!current) return;
  const script = avatarScriptText(current);
  if (!script) {
    state.channelError = "No full script is available for HeyGen.";
    state.channelStatus = "";
    update();
    return;
  }
  const copied = await copyTextToClipboardFromClick(script, "Word-for-word script copied.");
  if (!copied) return;
  const openedHeyGen = openExternalUrlFromClick(HEYGEN_STUDIO_URL);
  updateLatestPackage((pkg) => ({
    ...pkg,
    assets: {
      ...(pkg.assets || {}),
      avatarPluginHandoff: {
        preparedAt: new Date().toISOString(),
        scriptWordCount: countWords(script),
        settings: HEYGEN_LOCKED_SETTINGS,
      },
    },
  }));
  state.assetProgress = {
    percent: 100,
    step: "HeyGen script copied",
    detail: `Copied only the ${countWords(script).toLocaleString()} word-for-word script. HeyGen settings stay visible here: Jon Mac Office, Jon Eleven, Avatar III, 16:9 MP4, 30 FPS.`,
    status: "complete",
    events: [],
  };
  state.channelError = "";
  state.channelStatus = openedHeyGen
    ? "HeyGen opened and only the word-for-word script was copied. Paste it into HeyGen, use the locked settings shown here, then return with the MP4."
    : "Only the word-for-word script was copied. Open HeyGen, paste it, use the locked settings shown here, then return with the MP4.";
  update();
}

async function loadCloudConfigStatus(force = false) {
  if (state.cloudConfigLoading) return state.cloudConfigStatus;
  if (state.cloudConfigStatus && !force) return state.cloudConfigStatus;
  state.cloudConfigLoading = true;
  try {
    const response = await fetch("/api/cloud/youtube-gen/config-status");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Cloud status check failed.");
    }
    state.cloudConfigStatus = payload.config || null;
  } catch (error) {
    state.cloudConfigStatus = {
      error: error.message || "Cloud status check failed.",
      googleDrive: { configured: false, missing: [] },
      whatsapp: { configured: false, missing: [] },
    };
  } finally {
    state.cloudConfigLoading = false;
    update();
  }
  return state.cloudConfigStatus;
}

function ensureCloudConfigStatus() {
  if (!state.cloudConfigStatus && !state.cloudConfigLoading) {
    window.setTimeout(() => loadCloudConfigStatus(), 0);
  }
}

function configMissingText(key) {
  const config = state.cloudConfigStatus?.[key];
  if (!config || config.configured) return "";
  if (config.missing?.length) return `Missing ${config.missing.join(", ")} in Cloudflare.`;
  return state.cloudConfigStatus?.error || "Cloud configuration could not be checked.";
}

function renderCloudConfigNotice(key, readyLabel, blockedLabel, readyActionHtml = "") {
  ensureCloudConfigStatus();
  if (!state.cloudConfigStatus || state.cloudConfigLoading) {
    return `
      <div class="cloud-config-notice checking">
        <strong>Checking cloud setup</strong>
        <span>Verifying the Cloudflare settings for this step.</span>
      </div>
    `;
  }
  const config = state.cloudConfigStatus?.[key];
  if (config?.configured) {
    return `
      <div class="cloud-config-notice ready">
        <strong>${escapeHtml(readyLabel)}</strong>
        <span>Cloud credentials are present.</span>
        ${readyActionHtml}
      </div>
    `;
  }
  return `
    <div class="cloud-config-notice blocked">
      <span>
        <strong>${escapeHtml(blockedLabel)}</strong>
        ${escapeHtml(configMissingText(key))}
      </span>
      <button type="button" data-recheck-cloud-config>Recheck</button>
    </div>
  `;
}

function isDriveUploadProgress(progress = state.assetProgress) {
  if (!progress) return false;
  const target = state.assetGenerationTarget || {};
  const text = `${progress.step || ""} ${progress.detail || ""}`.toLowerCase();
  return Boolean(target.driveUpload || text.includes("drive upload") || text.includes("google drive") || text.includes("drive folder"));
}

function isDriveUploadFailure(progress = state.assetProgress) {
  return Boolean(progress?.status === "error" && isDriveUploadProgress(progress));
}

function clearDriveUploadFailure() {
  if (!isDriveUploadFailure()) return;
  state.assetProgress = null;
  state.channelError = "";
  state.channelStatus = "";
}

async function uploadAvatarToDrive(packageData) {
  let currentPackage = packageData;
  let video = avatarVideoForPackage(currentPackage);
  let url = assetPrimaryUrl(video);
  let filename = video?.filename || "youtube-gen-heygen-avatar.mp4";
  const script = avatarScriptText(packageData);
  if (driveFolderUrl(currentPackage)) {
    return true;
  }
  if (avatarVideoNeedsCodexReattach(currentPackage)) {
    const recovered = await recoverAvatarVideoFromCodexJob(currentPackage);
    if (!recovered) return false;
    currentPackage = latestPackage();
    video = avatarVideoForPackage(currentPackage);
    url = assetPrimaryUrl(video);
    filename = video?.filename || "youtube-gen-heygen-avatar.mp4";
  }
  if (!url) {
    state.channelError = "No avatar video is ready to upload.";
    state.channelStatus = "";
    update();
    return false;
  }
  if (!script) {
    state.channelError = "No full script is ready to upload with the video.";
    state.channelStatus = "";
    update();
    return false;
  }
  if (video?.localFileId) {
    const file = avatarVideoFiles.get(video.localFileId);
    if (!file) {
      showReattachAvatarVideoError();
      return false;
    }
    return await uploadLocalAvatarFileToDrive(currentPackage, video, file, script);
  }
  const config = await loadCloudConfigStatus(true);
  if (!config?.googleDrive?.configured) {
    state.channelError = configMissingText("googleDrive") || "Google Drive is not configured in the Cloudflare control plane.";
    state.channelStatus = "";
    update();
    return false;
  }
  state.assetGenerationLoading = true;
  state.assetGenerationTarget = { driveUpload: true };
  state.assetProgress = {
    percent: 10,
    step: "Preparing Drive folder",
    detail: "Uploading the avatar MP4 and full script doc to Google Drive.",
    status: "active",
    events: [],
  };
  state.channelError = "";
  state.channelStatus = "Uploading avatar package to Google Drive...";
  update();
  try {
    state.assetProgress = {
      ...state.assetProgress,
      percent: 35,
      step: "Uploading video and script",
      detail: "This can take a minute for a long HeyGen MP4.",
    };
    update();
    const response = await fetch("/api/cloud/youtube-gen/drive-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedPackageTitle(packageData),
        scriptText: script,
        avatarVideoUrl: new URL(url, window.location.href).toString(),
        avatarFilename: filename,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Drive upload failed.");
    }
    state.assetProgress = {
      ...state.assetProgress,
      percent: 100,
      step: "Drive folder ready",
      detail: "Avatar video and script doc are in one shared folder.",
      status: "complete",
    };
    updateLatestPackage((pkg) => ({
      ...pkg,
      assets: {
        ...(pkg.assets || {}),
        driveFolder: payload.driveFolder,
      },
    }));
    state.channelError = "";
    state.channelStatus = "Drive folder created with the avatar video and script doc.";
    return true;
  } catch (error) {
    state.assetProgress = {
      percent: 100,
      step: "Drive upload failed",
      detail: error.message || "Drive upload failed.",
      status: "error",
      events: [],
    };
    state.channelError = error.message || "Drive upload failed.";
    state.channelStatus = "";
    return false;
  } finally {
    state.assetGenerationLoading = false;
    state.assetGenerationTarget = null;
    update();
  }
}

function codexJobIdForAvatarUpload(packageData, video) {
  return String(video?.codexJobId || packageData?.assets?.avatarVideo?.codexJobId || heygenCodexJobForPackage(packageData)?.id || "").trim();
}

function avatarLooksCodexGenerated(packageData, video) {
  if (video?.localFileId && avatarVideoFiles.has(video.localFileId)) return false;
  const source = String(video?.source || packageData?.assets?.avatarVideo?.source || "").toLowerCase();
  return Boolean(codexJobIdForAvatarUpload(packageData, video) || source.includes("codex"));
}

async function uploadLocalAvatarFileWithCodexBridge(sessionPayload, packageData, video, file) {
  const { payload } = await fetchLocalHeyGenCodexBridge("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "uploadToDriveSession",
      jobId: codexJobIdForAvatarUpload(packageData, video),
      uploadUrl: sessionPayload.uploadUrl,
      avatarMimeType: file?.type || "video/mp4",
    }),
  });
  if (!payload.videoFile?.id) {
    throw new Error("Codex uploaded the MP4, but Google Drive did not return a video file id.");
  }
  return payload.videoFile;
}

async function uploadLocalAvatarFileToDrive(packageData, video, file, script) {
  const filename = video?.filename || file.name || "youtube-gen-heygen-avatar.mp4";
  const config = await loadCloudConfigStatus(true);
  if (!config?.googleDrive?.configured) {
    state.channelError = configMissingText("googleDrive") || "Google Drive is not configured in the Cloudflare control plane.";
    state.channelStatus = "";
    update();
    return false;
  }
  state.assetGenerationLoading = true;
  state.assetGenerationTarget = { driveUpload: true };
  state.assetProgress = {
    percent: 10,
    step: "Preparing Drive folder",
    detail: "Creating the Drive folder and upload session.",
    status: "active",
    events: [],
  };
  state.channelError = "";
  state.channelStatus = "Preparing direct Drive upload...";
  update();
  try {
    const sessionResponse = await fetch("/api/cloud/youtube-gen/drive-upload-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedPackageTitle(packageData),
        scriptText: script,
        avatarFilename: filename,
        avatarMimeType: file.type || "video/mp4",
        avatarSize: file.size || 0,
      }),
    });
    const sessionPayload = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok || !sessionPayload.ok || !sessionPayload.uploadUrl) {
      throw new Error(sessionPayload.error || "Could not create Drive upload session.");
    }

    let uploadedVideo = null;
    if (avatarLooksCodexGenerated(packageData, video)) {
      state.assetProgress = {
        ...state.assetProgress,
        percent: 45,
        step: "Uploading HeyGen MP4",
        detail: "Streaming the finished MP4 from local Codex to Google Drive.",
      };
      state.channelStatus = "Uploading HeyGen MP4 to Drive through Codex...";
      update();
      uploadedVideo = await uploadLocalAvatarFileWithCodexBridge(sessionPayload, packageData, video, file);
    } else {
      state.assetProgress = {
        ...state.assetProgress,
        percent: 45,
        step: "Uploading HeyGen MP4",
        detail: "Sending the finished MP4 to Google Drive with the browser upload session.",
      };
      state.channelStatus = "Uploading HeyGen MP4 to Drive...";
      update();

      try {
        uploadedVideo = await uploadLocalAvatarFileWithGoogleBrowserSession(sessionPayload, file);
      } catch (browserUploadError) {
        state.assetProgress = {
          ...state.assetProgress,
          percent: 55,
          step: "Using cloud upload helper",
          detail: "Google browser upload was blocked, so the cloud upload helper is taking over.",
        };
        state.channelStatus = "Uploading HeyGen MP4 to Drive through the cloud helper...";
        update();
        try {
          uploadedVideo = await uploadLocalAvatarFileWithBridge(sessionPayload, file);
        } catch (bridgeError) {
          throw new Error(`${browserUploadError.message || "Google browser upload failed."} Cloud upload helper also failed: ${bridgeError.message || "unknown error"}`);
        }
      }
    }

    state.assetProgress = {
      ...state.assetProgress,
      percent: 85,
      step: "Finalizing Drive folder",
      detail: "Sharing the folder and attaching the script doc.",
    };
    update();

    const folder = sessionPayload.driveFolder || {};
    const finalizeResponse = await fetch("/api/cloud/youtube-gen/drive-upload-session/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: folder.id,
        folderName: folder.name,
        folderWebViewLink: folder.webViewLink,
        videoFile: uploadedVideo,
        scriptFile: sessionPayload.scriptFile,
      }),
    });
    const finalizePayload = await finalizeResponse.json().catch(() => ({}));
    if (!finalizeResponse.ok || !finalizePayload.ok) {
      throw new Error(finalizePayload.error || "Could not finalize Drive folder.");
    }

    state.assetProgress = {
      ...state.assetProgress,
      percent: 100,
      step: "Drive folder ready",
      detail: "Avatar video and script doc are in one shared folder.",
      status: "complete",
    };
    updateLatestPackage((pkg) => ({
      ...pkg,
      assets: {
        ...(pkg.assets || {}),
        driveFolder: finalizePayload.driveFolder,
      },
      approvals: {
        ...(pkg.approvals || {}),
        avatar: true,
      },
    }));
    state.channelError = "";
    state.channelStatus = "Drive folder created with the HeyGen MP4 and script doc.";
    return true;
  } catch (error) {
    state.assetProgress = {
      ...state.assetProgress,
      percent: 0,
      step: "Drive upload failed",
      detail: error.message || "Drive upload failed.",
      status: "error",
    };
    state.channelError = error.message || "Drive upload failed.";
    state.channelStatus = "";
    return false;
  } finally {
    state.assetGenerationLoading = false;
    state.assetGenerationTarget = null;
    update();
  }
}

async function sendEditorHandoff(packageData) {
  const folderUrl = driveFolderUrl(packageData);
  if (!folderUrl) {
    state.channelError = "Upload the Drive folder in Step 6 before sending the editor handoff.";
    state.channelStatus = "";
    update();
    return;
  }
  const editorName = String(state.editorDraftName || "Editor").trim();
  const editorPhone = String(state.editorDraftPhone || "").trim();
  if (!editorPhone) {
    state.channelError = "Add the editor WhatsApp number first.";
    state.channelStatus = "";
    update();
    return;
  }
  if (!normalizeWhatsAppPhone(editorPhone)) {
    state.channelError = "Use a WhatsApp number with country code, like +15551234567.";
    state.channelStatus = "";
    update();
    return;
  }
  const message = editorHandoffMessageDraft(packageData);
  if (!message) {
    state.channelError = "Add a message before sending the editor handoff.";
    state.channelStatus = "";
    update();
    return;
  }

  openEditorWhatsAppFallback(packageData, editorName, editorPhone);
}

function openEditorWhatsAppFallback(packageData, editorName, editorPhone) {
  const whatsappUrl = editorWhatsAppAppUrl(packageData);
  if (!whatsappUrl) {
    state.channelError = "Use a WhatsApp number with country code, like +15551234567.";
    state.channelStatus = "";
    update();
    return;
  }
  state.assetProgress = {
    percent: 100,
    step: "WhatsApp app ready",
    detail: "Opening WhatsApp with the editable handoff message. Hit Send there.",
    status: "complete",
    events: [],
  };
  updateLatestPackage((pkg) => ({
    ...pkg,
    approvals: {
      ...(pkg.approvals || {}),
      edit: true,
    },
    assets: {
      ...(pkg.assets || {}),
      editorHandoff: {
        editorName,
        editorPhone,
        method: "whatsapp_web",
        message: editorHandoffMessageDraft(packageData),
        openedAt: new Date().toISOString(),
      },
    },
  }));
  openExternalUrl(whatsappUrl, "WhatsApp opened with the handoff message. Hit Send there.");
}

function markEditorHandoffOpened(packageData) {
  const whatsappUrl = editorWhatsAppAppUrl(packageData);
  const editorName = String(state.editorDraftName || "Editor").trim();
  const editorPhone = String(state.editorDraftPhone || "").trim();
  state.assetProgress = {
    percent: 100,
    step: "WhatsApp app ready",
    detail: "WhatsApp opened with the editable handoff message. Hit Send there.",
    status: "complete",
    events: [],
  };
  updateLatestPackage((pkg) => ({
    ...pkg,
    approvals: {
      ...(pkg.approvals || {}),
      edit: true,
    },
    assets: {
      ...(pkg.assets || {}),
      editorHandoff: {
        editorName,
        editorPhone,
        method: "whatsapp_web",
        message: editorHandoffMessageDraft(packageData),
        url: whatsappUrl,
        openedAt: new Date().toISOString(),
      },
    },
  }));
}

function normalizeWhatsAppPhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function editorHandoffMessage(packageData) {
  const folderUrl = driveFolderUrl(packageData);
  const editorName = String(state.editorDraftName || "Editor").trim();
  const title = selectedPackageTitle(packageData);
  const source = sourceRowsForPackage(packageData)[0] || packageData?.sourceVideos?.[0] || {};
  const sourceUrl = source.url || (source.id ? `https://www.youtube.com/watch?v=${source.id}` : "Original source video URL");
  return [
    `Hey ${editorName}, the next video is ready for editing.`,
    "",
    `Name: ${title}`,
    "",
    `Example: ${sourceUrl}`,
    "",
    `Folder: ${folderUrl}`,
    "",
    "It has the avatar video and script doc. Due in 3 days, thank you.",
  ].join("\n");
}

function editorHandoffMessageDraft(packageData) {
  return state.editorMessageTouched
    ? String(state.editorMessageDraft || "").trim()
    : editorHandoffMessage(packageData);
}

function applyEditorDraftFromPackage(packageData) {
  const draft = packageData?.assets?.editorDraft || {};
  state.editorDraftName = draft.editorName || "";
  state.editorDraftPhone = draft.editorPhone || "";
  state.editorMessageDraft = draft.message || "";
  state.editorMessageTouched = Boolean(draft.touched);
}

function saveEditorDraftToPackage() {
  if (!latestPackage()) return;
  updateLatestPackage((pkg) => ({
    ...pkg,
    assets: {
      ...(pkg.assets || {}),
      editorDraft: {
        editorName: state.editorDraftName,
        editorPhone: state.editorDraftPhone,
        message: state.editorMessageDraft,
        touched: state.editorMessageTouched,
        updatedAt: new Date().toISOString(),
      },
    },
  }));
}

function editorWhatsAppUrl(packageData) {
  return editorWhatsAppAppUrl(packageData);
}

function editorWhatsAppAppUrl(packageData) {
  const phone = normalizeWhatsAppPhone(state.editorDraftPhone);
  if (!phone) return "";
  const params = new URLSearchParams({ text: editorHandoffMessageDraft(packageData) });
  return `whatsapp://send?phone=${phone}&${params.toString()}`;
}

function editorWhatsAppWebUrl(packageData) {
  const phone = normalizeWhatsAppPhone(state.editorDraftPhone);
  if (!phone) return "";
  const params = new URLSearchParams({ text: editorHandoffMessageDraft(packageData) });
  return `https://wa.me/${phone}?${params.toString()}`;
}

function refreshEditorWhatsAppLink() {
  const link = els.grid?.querySelector("[data-whatsapp-handoff-link]");
  const fallbackLink = els.grid?.querySelector("[data-whatsapp-web-fallback]");
  const current = latestPackage();
  const whatsappUrl = editorWhatsAppAppUrl(current);
  const webUrl = editorWhatsAppWebUrl(current);
  if (link) {
    link.setAttribute("href", whatsappUrl || "#");
    link.setAttribute("aria-disabled", whatsappUrl ? "false" : "true");
  }
  if (fallbackLink) {
    fallbackLink.setAttribute("href", webUrl || "#");
    fallbackLink.setAttribute("aria-disabled", webUrl ? "false" : "true");
  }
}

function assetPrimaryUrl(asset) {
  if (Array.isArray(asset?.urls) && asset.urls.length) return asset.urls[0];
  return asset?.url || asset?.imageUrl || asset?.thumbnailUrl || asset?.downloadUrl || asset?.publicUrl || asset?.src || asset?.videoUrl || asset?.resultUrl || "";
}

function assetImageUrl(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = assetImageUrl(item);
      if (url) return url;
    }
    return "";
  }
  const directUrl = assetPrimaryUrl(value) || value.thumbnail || value.image || value.asset || "";
  if (typeof directUrl === "string" && directUrl) return directUrl;
  for (const key of ["thumbnail", "image", "asset", "media", "output", "result"]) {
    const url = assetImageUrl(value[key]);
    if (url) return url;
  }
  return "";
}

function packageThumbnailUrl(packageData) {
  const assets = packageData?.assets || {};
  const thumbnails = thumbnailAssetList(assets);
  const approvedIndex = Number(packageData?.approvals?.thumbnailIndex);
  const candidates = [];
  if (Number.isInteger(approvedIndex)) {
    candidates.push(
      thumbnails.find((asset) => Number(asset?.index) === approvedIndex + 1),
      thumbnails.find((asset) => Number(asset?.index) === approvedIndex),
    );
  }
  candidates.push(
    assets.selectedThumbnail,
    assets.thumbnail,
    packageData?.selectedThumbnail,
    packageData?.thumbnail,
    packageData?.thumbnailUrl,
    ...thumbnails,
  );
  for (const candidate of candidates) {
    const url = assetImageUrl(candidate);
    if (url) return url;
  }
  return sourceThumbnailUrl(packageData);
}

function projectThumbnailUrl(project) {
  return packageThumbnailUrl(project?.package || project);
}

async function downloadAsset(fileUrl, filename) {
  if (!fileUrl) return;
  const safeFilename = filename || "youtube-gen-asset";
  try {
    const url = new URL(fileUrl, window.location.href).toString();
    state.channelError = "";
    state.channelStatus = `Starting download for ${safeFilename}...`;
    update();

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: "youtube-gen-download-url",
        url,
        filename: safeFilename,
      }, "*");
      state.channelError = "";
      state.channelStatus = `Download started for ${safeFilename}.`;
      update();
      return;
    }

    const link = document.createElement("a");
    link.href = url;
    link.download = safeFilename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    state.channelError = "";
    state.channelStatus = `Download started for ${safeFilename}.`;
    update();
  } catch (error) {
    state.channelError = error.message || "Download failed.";
    state.channelStatus = "";
    update();
  }
}

function renderGeneratedAssets(packageData) {
  const assets = packageData?.assets || {};
  const thumbnails = thumbnailAssetList(assets).filter((asset) => hasDisplayableAssetUrl(asset));
  const visualHooks = Array.isArray(assets.visualHooks) ? assets.visualHooks : [];
  if (!thumbnails.length && !visualHooks.length) return "";
  return `
    <section class="asset-gallery">
      <div class="section-head">
        <span>05</span>
        <h4>Generated Assets</h4>
      </div>
      ${thumbnails.length ? `
        <div class="asset-block">
          <h5>Thumbnails</h5>
          <div class="asset-grid thumbnails">
            ${thumbnails.map((asset) => {
              const url = assetImageUrl(asset);
              return `
                <article class="asset-card">
                  ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="Generated thumbnail ${asset.index || ""}" loading="lazy" /></a>` : ""}
                  <div>
                    <strong>Thumbnail ${escapeHtml(asset.index || "")}</strong>
                    <span>${escapeHtml(asset.taskId || "")}</span>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}
      ${visualHooks.length ? `
        <div class="asset-block">
          <h5>Visual Hooks</h5>
          <div class="asset-grid videos">
            ${visualHooks.map((asset) => {
              const url = assetPrimaryUrl(asset);
              return `
                <article class="asset-card">
                  ${url ? `<video src="${url}" controls playsinline preload="metadata"></video>` : ""}
                  <div>
                    <strong>Hook ${escapeHtml(asset.index || "")}</strong>
                    <a href="${url}" target="_blank" rel="noopener noreferrer">Open asset</a>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}
    </section>
  `;
}

function assetByIndex(assets, key, index) {
  const list = key === "thumbnails"
    ? thumbnailAssetList(assets)
    : Array.isArray(assets?.[key]) ? assets[key] : [];
  const targetIndex = Number(index);
  const indexed = list.find((asset) => {
    const assetIndex = Number(asset?.index);
    if (!Number.isFinite(assetIndex) || assetIndex !== targetIndex) return false;
    if (key === "thumbnails") return hasDisplayableAssetUrl(asset);
    return true;
  });
  if (indexed) return indexed;
  const positional = list[targetIndex - 1];
  if (key === "thumbnails") return hasDisplayableAssetUrl(positional) ? positional : null;
  return positional || null;
}

function hasDisplayableAssetUrl(asset) {
  return Boolean(assetImageUrl(asset));
}

function isDisplayableThumbnailAsset(asset) {
  if (!hasDisplayableAssetUrl(asset)) return false;
  const version = String(asset?.promptVersion || "");
  if (!version) return true;
  if (SUPPORTED_THUMBNAIL_PROMPT_VERSIONS.has(version)) return true;
  return version.startsWith(`${THUMBNAIL_PROMPT_VERSION}-`);
}

function sourceThumbnailUrl(packageData) {
  const source = (packageData?.sourceVideos || [])[0];
  if (source?.thumbnail) return source.thumbnail;
  if (!source?.id) return "";
  return `https://img.youtube.com/vi/${source.id}/hqdefault.jpg`;
}

function cleanThumbnailConcept(value) {
  return displayValue(value)
    .replace(/\bmid[\s-]*30s\b/gi, "presenter")
    .replace(/\bclean[\s-]*cut\b/gi, "recognizable from the reference photos")
    .replace(/\bJon Mac blue\b/gi, `Jon Mac blue (${BRAND_COLORS.jonMacBlue})`)
    .replace(/\bClaude orange\b/gi, `Claude orange (${BRAND_COLORS.claudeOrange})`)
    .replace(/\bHiggsfield lime(?:\/green)?\b/gi, `Higgsfield lime (${BRAND_COLORS.higgsfieldLime})`)
    .replace(/\bHiggsfield green\b/gi, `Higgsfield lime (${BRAND_COLORS.higgsfieldLime})`);
}

function thumbnailTextLines(packageData, index) {
  const titles = packageData?.titles || [];
  const source = (packageData?.sourceVideos || [])[0] || {};
  const title = cleanThumbnailConcept(titles[index - 1] || titles[0] || source.title || "AI workflow");
  const base = title
    .replace(/[—–]/g, "-")
    .split(/\s+\|\s+|\s+-\s+|:\s+/)
    .map((part) => normalizeKeyword(part).replace(/[^\w\s.+#]/g, ""))
    .filter(Boolean);
  const first = base[0] || "AI WORKFLOW";
  const second = base.find((part) => /review|tutorial|workflow|tool|system|platform|app/i.test(part)) || "REVIEW 2026";
  const third = base.find((part) => /all.in.one|replace|multiple|creator|video|code/i.test(part)) || "ALL IN ONE";
  return [first, second, third]
    .map((line) => line.toUpperCase().slice(0, 24))
    .filter(Boolean)
    .slice(0, 3);
}

function writerStyleThumbnailPrompt(packageData, index) {
  const source = (packageData?.sourceVideos || [])[0] || {};
  const sourceTitle = cleanThumbnailConcept(source.title || "source thumbnail");
  const replacementText = thumbnailTextLines(packageData, index);
  return [
    "Render one finished 16:9 YouTube thumbnail. Do not output a prompt, description, mockup, or explanation.",
    `Prompt protocol: ${THUMBNAIL_IDENTITY_PROMPT_PROTOCOL}.`,
    "Image map for generation: image 1 is the primary Jon Mac identity reference. Image 2 is the source thumbnail and layout lock. Images 3-4 are secondary Jon Mac identity references.",
    "Identity pass/fail gate: before rendering, compare the visible presenter face to image 1. If it would not be instantly recognizable as Jon Mac from image 1, revise the face until it is. A result that looks like a generic male presenter, celebrity lookalike, younger or older substitute, or the source creator is a failed thumbnail.",
    "Face replacement rule: perform an identity-preserving face swap into the source layout. Use image 1 for the face first: eye shape, brows, nose, mouth, jawline, facial hair pattern, hairline, skin tone, and recognizable likeness. Use images 3-4 only to reinforce that same identity.",
    "Use image 2 only for the layout, pose, gaze direction, crop, lighting angle, body placement, and clothing silhouette. Do not inherit face identity, brow shape, beard style, hairline, age, or facial likeness from image 2.",
    "If identity and layout conflict, preserve Jon Mac's face from image 1 first and loosen the layout second. One visible presenter only, and that presenter must be Jon Mac.",
    "Reverse engineer image 2 as the layout lock. Recreate its composition exactly: same scene type, same crop, same background style, same subject scale, same subject position, same text-block positions, same icon/logo areas, same contrast, and same visual weight.",
    "If image 2 has no presenter, do not add one. If image 2 has a presenter, keep the same presenter position but replace the face identity with Jon Mac from image 1.",
    "Replace source logos, product names, and headline text only where those elements already exist in image 2. Do not add new banners, new arrows, new panels, new people, phone mockups, grids, chat windows, or portrait-only framing.",
    `Source thumbnail topic to preserve structurally: ${sourceTitle}.`,
    `Replacement text lines, only if the matching text areas exist in image 2: ${replacementText.join(" / ")}.`,
    "Text must be short, spelled correctly, separated by spaces, and placed inside the same text areas as image 2. If text cannot be rendered cleanly, use less text rather than inventing new words.",
    "Final output: one 16:9 thumbnail that looks like the original thumbnail was reshot for Jon Mac's channel with Jon Mac as the same person from image 1, not redesigned from scratch."
  ].join("\n");
}

function packageTopicText(packageData, hook = null) {
  const parts = [
    packageData?.topicAngle,
    packageData?.recommendedStyle,
  ];
  for (const source of packageData?.sourceVideos || []) {
    parts.push(source?.title, source?.description, source?.pattern, source?.topicBucket);
    if (Array.isArray(source?.tokens)) parts.push(source.tokens.join(" "));
  }
  if (hook) parts.push(hook.textOverlay, hook.visualHook, hook.spokenIntro);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function isAiUgcPackage(packageData, hook = null) {
  const text = packageTopicText(packageData, hook);
  return [
    "ai ugc",
    "ugc ad",
    "ugc ads",
    "ugc studio",
    "ai ads",
    "ad generator",
    "commercial",
    "tiktok",
    "short-form ad",
    "scroll stopping ad",
    "product demo ad",
    "selfie ad",
    "vertical ad",
  ].some((term) => text.includes(term));
}

function visualHookAspectRatio(packageData, hook = null) {
  return isAiUgcPackage(packageData, hook) ? "9:16" : "16:9";
}

function visualHookSettingsLabel(packageData, hook = null) {
  const aspect = visualHookAspectRatio(packageData, hook);
  const format = aspect === "9:16" ? "AI UGC vertical" : "YouTube wide";
  return `Kling 3.0 Standard · audio on · 10 sec · ${aspect} ${format}`;
}

function tenSecondVisualPlan(hook = {}) {
  const timeline = formatMultiline(hook.visualHook || "");
  const overlay = displayValue(hook.textOverlay || hook.overlay || "");
  if (!timeline) return overlay || "Best finished AI video output, then one proof cut.";
  const matches = [...timeline.matchAll(/(0:\d{2}\s*[-–]\s*0:\d{2}.*?)(?=\s+0:\d{2}\s*[-–]\s*0:\d{2}|$)/g)];
  const selected = matches
    .map((match) => match[1].trim())
    .filter((segment) => {
      const endMatch = segment.match(/[-–]\s*0:(\d{2})/);
      return endMatch ? Number(endMatch[1]) <= 12 : false;
    });
  if (selected.length) return selected.join(" ");
  return timeline.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 420);
}

function isGeneratingAsset(kind, index = null) {
  if (!state.assetGenerationLoading) return false;
  const target = state.assetGenerationTarget;
  if (!target) return kind === "all";
  if (kind === "thumbnail") return (target.thumbnails || []).includes(index);
  if (kind === "thumbnail-all") return (target.thumbnails || []).length > 1 && !(target.visualHooks || []).length;
  if (kind === "visualHook") return (target.visualHooks || []).includes(index);
  if (kind === "visual-all") return (target.visualHooks || []).length > 1 && !(target.thumbnails || []).length;
  return false;
}

const PACKAGE_STEPS = [
  ["source", "Source", "1"],
  ["titles", "Title", "2"],
  ["thumbnails", "Thumbnail", "3"],
  ["script", "Script", "4"],
  ["avatar", "Avatar", "5"],
  ["edit", "Edit", "6"],
  ["post", "Post", "7"],
  ["email", "Email", "8"],
  ["community", "Community", "9"],
  ["short", "Short", "10"],
];

function packageStepComplete(packageData, step) {
  const approvals = packageData?.approvals || {};
  if (step === "source") return Boolean(approvals.sourceVideoId || state.selectedRemakeVideoId);
  if (step === "titles") return Number.isInteger(approvals.titleIndex);
  if (step === "thumbnails") return Number.isInteger(approvals.thumbnailIndex);
  if (step === "script") return Boolean(approvals.script) && scriptMeetsTarget(packageData?.script, packageData);
  if (step === "avatar") return Boolean(approvals.avatar || driveFolderUrl(packageData));
  if (step === "edit") return Boolean(packageData?.assets?.editorHandoff?.messageId || approvals.edit);
  return Boolean(approvals[step]);
}

function nextPackageStep(step) {
  const index = PACKAGE_STEPS.findIndex(([key]) => key === step);
  if (index < 0 || index >= PACKAGE_STEPS.length - 1) return null;
  return PACKAGE_STEPS[index + 1];
}

function renderNextStepButton(packageData, step) {
  const next = nextPackageStep(step);
  if (!next || !packageStepComplete(packageData, step)) return "";
  const avatarToEditWithoutDrive = step === "avatar" && next[0] === "edit" && !driveFolderUrl(packageData);
  const label = avatarToEditWithoutDrive
    ? "Upload to Drive + Next: Edit"
    : `Next: ${escapeHtml(next[1])}`;
  return `
    <div class="next-step-row">
      <button type="button" class="next-step-button" data-next-package-step="${next[0]}">
        ${label}
      </button>
    </div>
  `;
}

function renderPackageStepper(packageData) {
  return `
    <nav class="package-stepper" aria-label="Package steps">
      ${PACKAGE_STEPS.map(([key, label, num]) => `
        <button type="button" class="${state.packageStep === key ? "active" : ""} ${packageStepComplete(packageData, key) ? "done" : ""}" data-package-step="${key}">
          <span>${num}</span>
          ${label}
        </button>
      `).join("")}
    </nav>
  `;
}

function renderPackageWorkspace(packageData, sourceRows) {
  const allowedSteps = new Set(PACKAGE_STEPS.map(([key]) => key));
  const step = allowedSteps.has(state.packageStep) ? state.packageStep : "titles";
  const assets = packageData?.assets || {};
  if (step === "source") {
    const sourceChoices = autoSelectedRemakeRows();
    const packageSources = sourceRowsForPackage(packageData);
    const pinnedPackageSources = packageSources.filter((source) => (
      source.id === state.selectedRemakeVideoId
      && !sourceChoices.some((row) => row.id === source.id)
    ));
    const rows = [...pinnedPackageSources, ...sourceChoices];
    if (!rows.length) rows.push(...packageSources);
    const selectedSource = rows.find((row) => row.id === state.selectedRemakeVideoId);
    const canGenerate = Boolean(selectedSource) && !state.ideaGenerationLoading;
    const buttonLabel = packageData?.id ? "Regenerate Factory Package" : "Generate Factory Package";
    const progressLabel = state.ideaGenerationLoading && state.ideaProgress
      ? `${state.ideaProgress.step || "Generating"} ${Math.round(Number(state.ideaProgress.percent || 0))}%`
      : buttonLabel;
    return `
      <div class="package-workspace">
        <section class="workflow-card">
          <div class="workflow-card-head">
            <div>
              <h4>Choose Source Video</h4>
              <p>Pick one of the five 2x+ outliers, then ${packageData?.id ? "rebuild the Factory package from that video." : "build the first Factory package."}</p>
            </div>
            <button class="primary${canGenerate ? " ready" : ""}" type="button" data-generate-remake ${canGenerate ? "" : "disabled"}>
              ${escapeHtml(progressLabel)}
            </button>
          </div>
          ${state.ideaGenerationLoading || state.ideaProgress ? renderIdeaProgress() : ""}
          <div class="source-choice-list">
            ${rows.map((row) => renderSourceCard(row, row.id === state.selectedRemakeVideoId)).join("")}
          </div>
          ${renderNextStepButton(packageData, "source")}
        </section>
      </div>
    `;
  }
  if (step === "titles") {
    return `
      <div class="package-workspace">
        <section class="workflow-card">
          <h4>Title Options</h4>
          ${renderSelectableList(packageData.titles, "title", packageData.approvals?.titleIndex)}
          ${renderNextStepButton(packageData, "titles")}
        </section>
      </div>
    `;
  }
  if (step === "thumbnails") {
    const optionCount = thumbnailOptionCount(packageData);
    const selectedIndex = Math.min(Math.max(Number(state.thumbnailPromptIndex || 1), 1), optionCount);
    const selectedPrompt = editableThumbnailPrompt(packageData, selectedIndex);
    const selectedAsset = assetByIndex(assets, "thumbnails", selectedIndex);
    const selectedUrl = assetImageUrl(selectedAsset);
    const sourceThumb = sourceThumbnailUrl(packageData);
    const kieApiKey = loadKieApiKey();
    const promptReady = thumbnailPromptReady(selectedIndex);
    const selectedButtonLabel = isGeneratingAsset("thumbnail", selectedIndex)
      ? "Generating..."
      : promptReady
        ? selectedUrl ? "Regenerate Image" : "Generate Image"
        : "Generate Prompt";
    return `
      <div class="package-workspace thumbnail-lab">
        <section class="workflow-card thumbnail-reference-panel">
          <div class="workflow-card-head">
            <div>
              <h4>Reference + Prompt</h4>
              <p>Matches the thumbnail writer flow from jonmac.pro.</p>
            </div>
          </div>
          ${state.assetGenerationLoading || state.assetProgress ? renderAssetProgress() : ""}
          <div class="reference-thumb">
            ${sourceThumb ? `<img src="${sourceThumb}" alt="Source thumbnail reference" loading="lazy" />` : `<span>No source thumbnail</span>`}
          </div>
          <div class="thumb-prompt-tabs">
            ${Array.from({ length: optionCount }, (_, index) => {
              const optionIndex = index + 1;
              const asset = assetByIndex(assets, "thumbnails", optionIndex);
              const isActive = optionIndex === selectedIndex;
              return `
                <button type="button" class="${isActive ? "active" : ""}" data-select-thumb-prompt="${optionIndex}">
                  Option ${optionIndex}${asset ? " · ready" : ""}
                </button>
              `;
            }).join("")}
          </div>
          <textarea class="thumb-prompt-text" readonly>${escapeHtml(selectedPrompt)}</textarea>
          ${kieApiKey ? `
            <div class="kie-key-panel ready">
              <span>Kie key ready in this browser.</span>
              <button type="button" data-clear-kie-api-key>Clear</button>
            </div>
          ` : `
            <form class="kie-key-panel" data-save-kie-api-key>
              <label>
                <span>Kie key</span>
                <input type="password" name="kieApiKey" placeholder="Paste Kie API key" autocomplete="off" />
              </label>
              <button type="submit">Save</button>
            </form>
          `}
          <div class="thumb-actions">
            <button type="button" data-generate-kie-assets data-target-kind="thumbnail" data-target-index="${selectedIndex}" ${state.assetGenerationLoading ? "disabled" : ""}>
              ${selectedButtonLabel}
            </button>
            <button type="button" data-generate-kie-assets data-target-kind="thumbnail-all" ${state.assetGenerationLoading ? "disabled" : ""}>
              ${isGeneratingAsset("thumbnail-all") ? "Generating..." : "Generate All Thumbnails"}
            </button>
          </div>
        </section>
        <section class="workflow-card thumbnail-results-panel">
          <div class="workflow-card-head">
            <div>
              <h4>Generated Thumbnails</h4>
              <p>Select an option to preview and regenerate it.</p>
            </div>
          </div>
          <div class="generated-thumb-list">
            ${Array.from({ length: optionCount }, (_, index) => {
              const optionIndex = index + 1;
              const asset = assetByIndex(assets, "thumbnails", optionIndex);
              const url = assetImageUrl(asset);
              const isGeneratingThis = isGeneratingAsset("thumbnail", optionIndex);
              return `
                <article class="generated-thumb ${optionIndex === selectedIndex ? "active" : ""} ${isGeneratingThis ? "generating" : ""}" data-select-thumb-prompt="${optionIndex}">
                  ${url ? `<img src="${url}" alt="Generated thumbnail ${optionIndex}" loading="lazy" />` : `<div class="thumb-placeholder"><span>${isGeneratingThis ? `Generating option ${optionIndex}` : `Option ${optionIndex}`}</span></div>`}
                  <div class="generated-thumb-actions">
                    ${url ? `<button type="button" data-preview-asset="${escapeHtml(url)}" data-preview-filename="youtube-gen-thumbnail-${optionIndex}.png">Preview</button>` : `<button type="button" data-select-thumb-prompt="${optionIndex}">Select</button>`}
                    ${url ? `<button type="button" class="asset-download-link" data-download-asset="${escapeHtml(url)}" data-download-filename="youtube-gen-thumbnail-${optionIndex}.png">Download</button>` : ""}
                    <button type="button" data-edit-thumbnail-prompt="${optionIndex}">Edit</button>
                    ${url ? `<button type="button" class="danger" data-delete-thumbnail="${optionIndex}">Delete</button>` : ""}
                    ${url ? `<button type="button" class="${packageData.approvals?.thumbnailIndex === index ? "approved" : ""}" data-approve-step="thumbnail" data-approve-index="${index}">${packageData.approvals?.thumbnailIndex === index ? "Undo" : "Approve"}</button>` : ""}
                  </div>
                </article>
              `;
            }).join("")}
          </div>
          ${renderNextStepButton(packageData, "thumbnails")}
        </section>
      </div>
    `;
  }
  if (step === "avatar") {
    return renderAvatarStep(packageData);
  }
  if (step === "edit") {
    return renderEditorHandoffStep(packageData);
  }
  if (step === "post") {
    return renderPostWorkflow(packageData);
  }
  if (step === "email") {
    return renderEmailWorkflow(packageData);
  }
  if (step === "community") {
    return renderCommunityWorkflow(packageData);
  }
  if (step === "short") {
    return renderShortWorkflow(packageData);
  }
  const scriptProgressStep = String(state.ideaProgress?.step || "");
  const scriptRewriteComplete = !state.ideaGenerationLoading && /rewrite replaced/i.test(scriptProgressStep);
  const regenerateLabel = state.ideaGenerationLoading
    ? "Rewriting Script..."
    : scriptRewriteComplete
      ? "Rewrite Again"
      : "Rewrite Script";
  return `
    <div class="package-workspace">
      <section class="workflow-card script-workflow-card">
        <div class="workflow-card-head">
          <div>
            <h4>Source-Length Script</h4>
            <p>Original source transcript beside the ready-to-record rewrite.</p>
          </div>
          <div class="script-head-actions">
            <button type="button" class="primary ready script-regenerate-button ${state.ideaGenerationLoading ? "loading" : ""}" data-generate-remake ${state.ideaGenerationLoading ? "disabled" : ""}>
              ${escapeHtml(regenerateLabel)}
            </button>
            <button type="button" data-edit-script>${state.editingScript ? "Editing" : "Edit Script"}</button>
            <button type="button" class="${packageData.approvals?.script ? "approved" : ""}" data-approve-step="script" ${scriptMeetsTarget(packageData.script, packageData) ? "" : "disabled"}>
              ${packageData.approvals?.script ? "Unapprove Script" : "Approve Script"}
            </button>
          </div>
        </div>
        ${state.ideaGenerationLoading || state.ideaProgress ? renderIdeaProgress() : ""}
        ${state.editingScript ? renderScriptEditCompare(packageData) : renderScriptCompare(packageData)}
        ${renderNextStepButton(packageData, "script")}
      </section>
    </div>
  `;
}

function renderAvatarStep(packageData) {
  const approved = Boolean(packageData?.approvals?.avatar);
  const settings = HEYGEN_LOCKED_SETTINGS;
  const script = avatarScriptText(packageData);
  const wordTotal = countWords(script);
  const avatarVideo = avatarVideoForPackage(packageData);
  const rawVideoUrl = assetPrimaryUrl(avatarVideo);
  const videoUrl = avatarVideoHasWorkingSource(packageData) ? rawVideoUrl : "";
  const staleVideoUrl = Boolean(rawVideoUrl && !videoUrl);
  const videoFilename = avatarVideo?.filename || "youtube-gen-heygen-avatar.mp4";
  const codexJob = heygenCodexJobForPackage(packageData);
  const codexJobActive = heygenCodexJobIsActive(codexJob);
  const codexJobNeedsAttachment = Boolean(codexJob?.statusUrl && !videoUrl);
  const folder = driveFolderForPackage(packageData);
  const folderUrl = driveFolderUrl(packageData);
  const driveBlocked = state.cloudConfigStatus && !state.cloudConfigStatus.googleDrive?.configured;
  const showAssetProgress = state.assetProgress && !isDriveUploadFailure();
  return `
    <div class="package-workspace">
      <section class="workflow-card avatar-workflow-card">
        <div class="workflow-card-head">
          <div>
            <h4>HeyGen Avatar</h4>
            <p>Open HeyGen with the script copied, then attach the finished MP4 here for preview and Drive upload.</p>
          </div>
          <div class="workflow-actions">
            <button type="button" class="primary ready" data-start-heygen-codex ${codexJobActive ? "disabled" : ""}>
              ${codexJobActive ? "Codex Running HeyGen" : videoUrl ? "Regenerate with Codex" : "Generate with Codex"}
            </button>
            <button type="button" class="primary ready" data-prepare-heygen-plugin>
              ${videoUrl ? "Open HeyGen + Copy Script Again" : "Open HeyGen + Copy Script"}
            </button>
            <button type="button" data-pick-avatar-video>
              ${videoUrl ? "Replace Finished MP4" : "Add Finished MP4"}
            </button>
            <input class="avatar-file-input" type="file" accept="video/mp4,video/webm,video/quicktime" data-avatar-video-file />
            <button type="button" class="${approved ? "approved" : ""}" data-approve-step="avatar">
              ${approved ? "Unapprove" : "Approve Avatar"}
            </button>
          </div>
        </div>
        <div class="avatar-plugin-layout avatar-clean-layout">
          <section class="avatar-browser-panel avatar-generate-panel">
            ${videoUrl ? `
              <div class="avatar-video-panel">
                <video class="avatar-video-player" src="${escapeHtml(videoUrl)}" controls preload="metadata"></video>
                <div class="avatar-video-meta">
                  <strong>${escapeHtml(avatarVideo?.title || selectedPackageTitle(packageData))}</strong>
                  <span>${escapeHtml(formatDuration(avatarVideo?.durationSeconds || 0))} · ${escapeHtml(settings.avatarName)} · ${escapeHtml(settings.motionEngine)} · 30 FPS</span>
                </div>
                <div class="avatar-video-actions">
                  <button type="button" data-preview-asset="${escapeHtml(videoUrl)}" data-preview-filename="${escapeHtml(videoFilename)}">Preview</button>
                  <button type="button" data-download-asset="${escapeHtml(videoUrl)}" data-download-filename="${escapeHtml(videoFilename)}">Download</button>
                  ${folderUrl ? `
                    <button type="button" data-open-drive-folder="${escapeHtml(folderUrl)}">Open Drive Folder</button>
                    <button type="button" data-upload-avatar-drive ${driveBlocked ? "disabled" : ""}>Replace Drive Folder</button>
                  ` : `<button type="button" data-upload-avatar-drive ${driveBlocked ? "disabled" : ""}>Create Drive Folder</button>`}
                </div>
              </div>
            ` : `
              <div class="avatar-generate-empty">
                <h5>${staleVideoUrl ? "Recover finished MP4" : "Waiting on finished MP4"}</h5>
                <p>${staleVideoUrl
                  ? "The browser lost the refreshed MP4 handle. Recover it from the local Codex HeyGen job, or replace the file manually."
                  : "When the HeyGen render is done, download the MP4 from HeyGen and click Add Finished MP4. It will appear in this preview player and stay ready for the Drive package."
                }</p>
                <div class="avatar-empty-actions">
                  ${staleVideoUrl ? `<button type="button" class="primary ready" data-recover-avatar-video>Recover from Codex</button>` : ""}
                  <button type="button" class="primary ready" data-pick-avatar-video>Add Finished MP4</button>
                </div>
              </div>
            `}
            <div class="heygen-settings-lock" aria-label="Locked HeyGen settings">
              <article>
                <span>Avatar</span>
                <strong>${escapeHtml(settings.avatarName)}</strong>
              </article>
              <article>
                <span>Voice</span>
                <strong>${escapeHtml(settings.voiceName)}</strong>
              </article>
              <article>
                <span>Motion Engine</span>
                <strong>${escapeHtml(settings.motionEngine)}</strong>
              </article>
              <article>
                <span>Output</span>
                <strong>${escapeHtml(settings.aspectRatio)} ${escapeHtml(settings.outputFormat)}</strong>
              </article>
              <article>
                <span>FPS</span>
                <strong>30</strong>
              </article>
            </div>
            <div class="avatar-auth-note">
              <strong>Full script:</strong>
              <span>${wordTotal.toLocaleString()} words are ready from Step 5.</span>
            </div>
            ${codexJob ? `
              <div class="avatar-codex-card ${codexJob.status === "error" ? "error" : codexJob.status === "complete" ? "ready" : ""}">
                <strong>${escapeHtml(codexJob.step || "Codex HeyGen job")}</strong>
                <span>${escapeHtml(codexJob.message || "Codex is working through the HeyGen Avatar Web UI skill.")}</span>
                ${codexJob.statusUrl && (codexJob.status !== "complete" || codexJobNeedsAttachment) ? `<button type="button" class="primary ready avatar-attach-codex-button" data-check-heygen-codex="${escapeHtml(codexJob.id || "")}" data-status-url="${escapeHtml(codexJob.statusUrl)}">${codexJobNeedsAttachment ? "Attach Finished HeyGen Video" : "Check HeyGen Status"}</button>` : ""}
              </div>
            ` : ""}
            ${folderUrl ? `
              <div class="avatar-drive-card">
                <strong>Drive folder ready</strong>
                <span>${escapeHtml(folder?.name || "Avatar video and script doc")}</span>
                <a href="${escapeHtml(folderUrl)}" target="_blank" rel="noreferrer" data-open-drive-folder="${escapeHtml(folderUrl)}">Open folder</a>
              </div>
            ` : ""}
            ${renderCloudConfigNotice(
              "googleDrive",
              "Google Drive ready",
              "Google Drive upload blocked",
              `<button type="button" class="cloud-continue-button" data-next-package-step="edit">${folderUrl ? "Continue to Edit" : "Upload to Drive + Next: Edit"}</button>`,
            )}
            ${showAssetProgress ? renderAssetProgress() : ""}
          </section>
          <aside class="avatar-script-panel avatar-sidebar-minimal avatar-clean-sidebar">
            <button type="button" data-copy-avatar-script>Copy Script</button>
          </aside>
        </div>
        ${renderNextStepButton(packageData, "avatar")}
      </section>
    </div>
  `;
}

function renderEditorHandoffStep(packageData) {
  const folder = driveFolderForPackage(packageData);
  const folderUrl = driveFolderUrl(packageData);
  const sent = packageData?.assets?.editorHandoff || null;
  const title = selectedPackageTitle(packageData);
  const message = editorHandoffMessageDraft(packageData);
  const openedAt = sent?.openedAt || sent?.sentAt || "";
  const sending = Boolean(state.editorHandoffLoading);
  const primaryLabel = sent ? "Open WhatsApp Again" : "Open WhatsApp Handoff";
  const whatsappAppUrl = editorWhatsAppAppUrl(packageData);
  const whatsappWebUrl = editorWhatsAppWebUrl(packageData);
  const successLabel = `WhatsApp opened ${escapeHtml(openedAt ? new Date(openedAt).toLocaleString() : "just now")}`;
  return `
    <div class="package-workspace">
      <section class="workflow-card editor-handoff-card">
        <div class="workflow-card-head">
          <div>
            <h4>Editor Handoff</h4>
            <p>Send the editor a WhatsApp handoff with the Drive folder link.</p>
          </div>
          <div class="workflow-actions">
            ${folderUrl ? `<button type="button" data-open-drive-folder="${escapeHtml(folderUrl)}">Open Drive Folder</button>` : ""}
            <button type="button" class="${sent ? "approved" : ""}" data-approve-step="edit">${sent ? "Ready" : "Mark Ready"}</button>
          </div>
        </div>
        ${state.assetProgress ? renderAssetProgress() : ""}
        <div class="cloud-config-notice ready">
          <strong>WhatsApp app handoff ready</strong>
          <span>Review the message here, then open the desktop app with this draft prefilled.</span>
        </div>
        ${folderUrl ? `
          <div class="editor-handoff-grid">
            <article class="editor-folder-card">
              <span>Drive folder</span>
              <strong>${escapeHtml(folder?.name || title)}</strong>
              <p>Contains the avatar MP4 and Google Doc script.</p>
              <a href="${escapeHtml(folderUrl)}" target="_blank" rel="noreferrer" data-open-drive-folder="${escapeHtml(folderUrl)}">${escapeHtml(folderUrl)}</a>
            </article>
            <form class="editor-handoff-form" data-editor-handoff-form>
              <div class="editor-preset-block">
                <span>Editors</span>
                <div class="editor-preset-list">
                  ${EDITOR_PRESETS.map((editor, index) => `
                    <button
                      type="button"
                      class="${state.editorDraftName === editor.name ? "active" : ""}"
                      data-select-editor="${index}"
                    >${escapeHtml(editor.name)}</button>
                  `).join("")}
                </div>
              </div>
              <label>
                <span>Editor name</span>
                <input value="${escapeHtml(state.editorDraftName)}" placeholder="Editor" data-editor-name />
              </label>
              <label>
                <span>WhatsApp number</span>
                <input value="${escapeHtml(state.editorDraftPhone)}" placeholder="+15551234567" data-editor-phone />
              </label>
              <div class="editor-message-preview">
                <span>Message</span>
                <textarea data-editor-message spellcheck="true">${escapeHtml(message)}</textarea>
              </div>
              <div class="editor-handoff-actions">
                <button type="button" data-copy-editor-message>Copy Message</button>
                <a
                  class="primary ready whatsapp-handoff-button"
                  href="${escapeHtml(whatsappAppUrl || "#")}"
                  target="_top"
                  rel="noreferrer"
                  data-editor-handoff-open
                  data-whatsapp-handoff-link
                  aria-disabled="${whatsappAppUrl ? "false" : "true"}"
                >${sending ? "Opening..." : primaryLabel}</a>
              </div>
              <div class="whatsapp-fallback-row">
                <span>If the desktop app does not open:</span>
                <a
                  href="${escapeHtml(whatsappWebUrl || "#")}"
                  target="_top"
                  rel="noreferrer"
                  data-whatsapp-web-fallback
                  aria-disabled="${whatsappWebUrl ? "false" : "true"}"
                >Open WhatsApp Web</a>
              </div>
            </form>
          </div>
          ${sent ? `
            <div class="handoff-success">
              <strong>Ready:</strong>
              <span>${escapeHtml(sent.editorName || "Editor")} · ${successLabel}</span>
              ${sent.url ? `<a href="${escapeHtml(sent.url)}" target="_blank" rel="noreferrer">Open WhatsApp app</a>` : ""}
            </div>
          ` : ""}
          ${renderNextStepButton(packageData, "edit")}
        ` : `
          <div class="empty editor-empty">
            <strong>Waiting on Step 6 Drive folder</strong>
            <span>WhatsApp is checked above. Upload the avatar video and script to Google Drive in Step 6, then Step 7 will show the editor form and send button.</span>
          </div>
          <div class="next-step-row">
            <button type="button" class="secondary" data-package-step="avatar">Go to Step 6 Avatar</button>
          </div>
        `}
      </section>
    </div>
  `;
}

function selectedPackageTitle(packageData) {
  const index = packageData?.approvals?.titleIndex;
  const titles = Array.isArray(packageData?.titles) ? packageData.titles : [];
  return displayValue(Number.isInteger(index) ? titles[index] : titles[0]) || "Approved video title";
}

function selectedPackageHook(packageData) {
  const index = packageData?.approvals?.wordHookIndex;
  const hooks = Array.isArray(packageData?.hooks) ? packageData.hooks : [];
  if (Number.isInteger(index) && hooks[index]) return hooks[index];
  if (hooks[0]) return hooks[0];
  return {
    textOverlay: packageData?.sourceAnalysis?.hook || packageData?.topicAngle || selectedPackageTitle(packageData),
    spokenIntro: packageData?.script?.wordForWordIntro || "",
  };
}

function jonmacWorkflowUrl(tab) {
  return `https://jonmac.pro/videos/${tab}`;
}

function renderWorkflowField(label, value, kind = "input") {
  const safeValue = escapeHtml(value || "");
  if (kind === "textarea") {
    return `
      <label class="workflow-field wide">
        <span>${escapeHtml(label)}</span>
        <textarea readonly>${safeValue}</textarea>
      </label>
    `;
  }
  return `
    <label class="workflow-field">
      <span>${escapeHtml(label)}</span>
      <input value="${safeValue}" readonly />
    </label>
  `;
}

function renderWorkflowShell({ title, kicker, urlTab, fields, actions, approvedKey }) {
  const approved = Boolean(latestPackage()?.approvals?.[approvedKey]);
  return `
    <div class="package-workspace">
      <section class="workflow-card publishing-workflow">
        <div class="workflow-card-head">
          <div>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(kicker)}</p>
          </div>
          <div class="workflow-actions">
            <a href="${jonmacWorkflowUrl(urlTab)}" target="_blank" rel="noreferrer">Open jonmac.pro</a>
            <button type="button" class="${approved ? "approved" : ""}" data-approve-step="${escapeHtml(approvedKey)}">
              ${approved ? "Unapprove" : "Approve Step"}
            </button>
          </div>
        </div>
        <div class="workflow-form-grid">${fields.join("")}</div>
        <ol class="workflow-route-list">
          ${actions.map((item, index) => `
            <li>
              <span>${index + 1}</span>
              <p>${escapeHtml(item)}</p>
            </li>
          `).join("")}
        </ol>
        ${renderNextStepButton(latestPackage(), approvedKey)}
      </section>
    </div>
  `;
}

function renderPostWorkflow(packageData) {
  const title = selectedPackageTitle(packageData);
  const description = [
    packageData?.topicAngle || "AI video production workflow.",
    "Tools: Claude Code, Seedance 2.0, Higgsfield, AI UGC production.",
    "Chapters get added after the edit timing is final."
  ].join("\n\n");
  return renderWorkflowShell({
    title: "YouTube Post",
    kicker: "Same workflow as jonmac.pro Post: metadata, channel, playlist, visibility, then upload-ready confirmation.",
    urlTab: "post",
    approvedKey: "post",
    fields: [
      renderWorkflowField("Title", title),
      renderWorkflowField("Visibility", "Private draft"),
      renderWorkflowField("Category", "Education"),
      renderWorkflowField("Altered Content", "Yes"),
      renderWorkflowField("Description Starter", description, "textarea"),
      renderWorkflowField("Tags", "Claude Code, Seedance 2.0, Higgsfield, AI UGC, AI video production", "textarea"),
    ],
    actions: [
      "Auto-fill metadata from the approved package.",
      "Save title, description, tags, category, playlist, and altered-content flag.",
      "Upload or confirm the edited video through the YouTube upload workflow."
    ],
  });
}

function renderEmailWorkflow(packageData) {
  const title = selectedPackageTitle(packageData);
  const hook = selectedPackageHook(packageData);
  const subject = hook?.textOverlay ? `${hook.textOverlay}: ${title}` : title;
  return renderWorkflowShell({
    title: "Email Promo",
    kicker: "Same workflow as jonmac.pro Email: video link, generated subject and body, test send, then GHL blast.",
    urlTab: "email",
    approvedKey: "email",
    fields: [
      renderWorkflowField("Video Title", title),
      renderWorkflowField("YouTube Link", "Paste final YouTube URL after upload"),
      renderWorkflowField("Subject Starter", subject),
      renderWorkflowField("Email Angle", packageData?.topicAngle || "AI video production workflow", "textarea"),
    ],
    actions: [
      "Generate the email from the approved title and final YouTube link.",
      "Send a test email before the blast.",
      "Schedule the final email through the existing GHL email workflow."
    ],
  });
}

function renderCommunityWorkflow(packageData) {
  const title = selectedPackageTitle(packageData);
  const hook = selectedPackageHook(packageData);
  const prompt = hook?.textOverlay || "Which part of this AI video workflow would you try first?";
  return renderWorkflowShell({
    title: "Community Post",
    kicker: "Same workflow as jonmac.pro Community: generate the post, append the YouTube link, copy, then open the channel community tab.",
    urlTab: "community",
    approvedKey: "community",
    fields: [
      renderWorkflowField("Video Title", title),
      renderWorkflowField("YouTube Link", "Paste final YouTube URL after upload"),
      renderWorkflowField("Post Starter", `${prompt}\n\nFull walkthrough: [paste YouTube link]`, "textarea"),
    ],
    actions: [
      "Generate a short curiosity post from the title and final YouTube link.",
      "Append the YouTube link if it is missing.",
      "Copy the post and open the Jon Mac YouTube Community page."
    ],
  });
}

function renderShortWorkflow(packageData) {
  const hook = selectedPackageHook(packageData);
  return renderWorkflowShell({
    title: "Short Cutdowns",
    kicker: "Same workflow as jonmac.pro Shorts: select final video or paste YouTube URL, generate clips, review virality score, upload selected Shorts.",
    urlTab: "shorts",
    approvedKey: "short",
    fields: [
      renderWorkflowField("Source", "Final long-form video or YouTube URL"),
      renderWorkflowField("Short Hook", hook?.textOverlay || "Use the strongest approved opening"),
      renderWorkflowField("Clip Direction", hook?.spokenIntro || "Open with the finished result, then reveal the workflow.", "textarea"),
    ],
    actions: [
      "Generate Shorts from the final long-form video.",
      "Review clip previews and virality scores.",
      "Upload the strongest clips with a link back to the full walkthrough."
    ],
  });
}

function renderSelectableList(items, kind, selectedIndex) {
  const list = Array.isArray(items) ? items : [];
  return `
    <ol class="package-card-list selectable-list">
      ${list.map((item, index) => `
        <li class="${selectedIndex === index ? "selected" : ""}" data-approve-step="${kind}" data-approve-index="${index}" tabindex="0" role="button" aria-pressed="${selectedIndex === index ? "true" : "false"}">
          <span>${index + 1}</span>
          <p>${escapeHtml(displayValue(item))}</p>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderProductionStep(title, items) {
  const stepKey = state.packageStep;
  const approved = Boolean(latestPackage()?.approvals?.[stepKey]);
  return `
    <div class="package-workspace">
      <section class="workflow-card production-step">
        <div class="workflow-card-head">
          <div>
            <h4>${escapeHtml(title)}</h4>
            <p>Production checklist for after the core package is approved.</p>
          </div>
          <button type="button" class="${approved ? "approved" : ""}" data-approve-step="${escapeHtml(stepKey)}">
            ${approved ? "Unapprove" : "Approve Step"}
          </button>
        </div>
        <ol class="production-checklist">
          ${items.map((item, index) => `
            <li>
              <span>${index + 1}</span>
              <p>${escapeHtml(item)}</p>
            </li>
          `).join("")}
        </ol>
        ${renderNextStepButton(latestPackage(), stepKey)}
      </section>
    </div>
  `;
}

function renderProgress(progress, label = "Generation progress") {
  if (!progress) return "";
  const percent = Math.round(Number(progress.percent || 0));
  const errors = progress.status === "error"
    ? (progress.events || []).filter((event) => event.status === "error")
    : [];
  const latestError = errors[0];
  const recentEvents = (progress.events || [])
    .filter((event) => event.step || event.detail)
    .slice(0, 3);
  const latestEvent = recentEvents[0];
  return `
    <div class="idea-progress ${progress.status === "error" ? "error" : ""}">
      <div class="idea-progress-head">
        <strong>${escapeHtml(progress.step || "Working")}</strong>
        <span>${percent}%</span>
      </div>
      <div class="idea-progress-track" aria-label="${escapeHtml(label)}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <div style="width:${percent}%"></div>
      </div>
      ${progress.detail ? `<p>${escapeHtml(progress.detail)}</p>` : ""}
      ${latestError ? `<p class="idea-progress-error-detail">Issue: ${escapeHtml(latestError.error || latestError.detail || latestError.step || "Generation error")}</p>` : ""}
      ${recentEvents.length ? `
        <details class="progress-event-list">
          <summary>
            <span>${escapeHtml(latestEvent?.at || "")}</span>
            <strong>${escapeHtml(latestEvent?.step || "Latest update")}</strong>
            <em>${escapeHtml(latestEvent?.detail || "View recent updates")}</em>
          </summary>
          <ol>
            ${recentEvents.slice(1).map((event) => `
              <li>
                <span>${escapeHtml(event.at || "")}</span>
                <strong>${escapeHtml(event.step || "Working")}</strong>
                ${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ""}
              </li>
            `).join("")}
          </ol>
        </details>
      ` : ""}
    </div>
  `;
}

function renderIdeaProgress() {
  return renderProgress(state.ideaProgress, "Package generation progress");
}

function renderAssetProgress() {
  return renderProgress(state.assetProgress, "Kie asset generation progress");
}

function renderSavedProjectsShelf() {
  const current = latestPackage();
  return `
    <section class="saved-projects-shelf" aria-label="Saved remake projects">
      <div class="saved-projects-head">
        <div>
          <p class="eyebrow">Projects</p>
          <strong>${state.savedProjects.length} saved</strong>
        </div>
        <div class="saved-projects-actions">
          <span>${state.savedProjects.length ? "Load a saved package or keep building." : "Save a package here so it does not disappear when you clear."}</span>
          ${current ? `<button type="button" data-save-project>Save Current</button>` : ""}
        </div>
      </div>
      <div class="saved-project-list">
        ${state.savedProjects.length ? state.savedProjects.map((project) => {
          const thumbUrl = projectThumbnailUrl(project);
          return `
            <article class="saved-project-card">
              <button type="button" class="saved-project-thumb ${thumbUrl ? "" : "missing"}" data-load-project="${escapeHtml(project.id)}" aria-label="Load project ${escapeHtml(project.name || "Untitled project")}">
                ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy" />` : `<span>No thumbnail yet</span>`}
              </button>
              <button type="button" class="saved-project-load" data-load-project="${escapeHtml(project.id)}">
                <strong>${escapeHtml(project.name || "Untitled project")}</strong>
                <span>${escapeHtml(projectUpdatedLabel(project.updatedAt))}</span>
              </button>
              <button type="button" class="saved-project-remove" data-remove-project="${escapeHtml(project.id)}" aria-label="Delete saved project ${escapeHtml(project.name || "Untitled project")}">Delete</button>
            </article>
          `;
        }).join("") : `
          <div class="saved-project-empty">
            <strong>No saved projects yet</strong>
            <span>Generate a package, then click Save Project or Save Current.</span>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderScratchProjectCreator() {
  const status = state.channelError || state.channelStatus || "";
  return `
    <section class="scratch-project-panel" aria-label="Create custom YouTube Gen project">
      <div class="scratch-project-head">
        <div>
          <p class="eyebrow">New Project</p>
          <strong>Create from scratch</strong>
          <span>Paste a script, add a YouTube URL, then use the same title, script, thumbnail, avatar, and editor workflow.</span>
        </div>
        <button type="submit" form="scratchProjectForm" class="scratch-new-project-button">New Project</button>
      </div>
      ${status ? `<div class="idea-status ${state.channelError ? "error" : ""}">${escapeHtml(status)}</div>` : ""}
      <form class="scratch-project-form" data-scratch-project-form id="scratchProjectForm">
        <label>
          <span>Project name</span>
          <input name="projectName" placeholder="Optional working title..." autocomplete="off" />
        </label>
        <label>
          <span>YouTube URL</span>
          <input name="youtubeUrl" placeholder="Paste a YouTube URL to pull title and thumbnail..." autocomplete="off" />
        </label>
        <label>
          <span>Manual thumbnail</span>
          <input name="thumbnail" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        <label class="wide">
          <span>Script</span>
          <textarea name="script" placeholder="Paste your script here. Rewrite Script will use this as the source text." spellcheck="true"></textarea>
        </label>
        <div class="scratch-project-actions">
          <button type="submit" class="primary ready">Create Project</button>
        </div>
      </form>
    </section>
  `;
}

function renderFactoryManualSourceCreator() {
  return `
    <section class="scratch-project-panel factory-manual-source" aria-label="Manual Factory source">
      <div class="scratch-project-head">
        <div>
          <p class="eyebrow">Manual source</p>
          <strong>Build from your own video, script, or thumbnail</strong>
          <span>Paste a YouTube URL to pull the title, paste your source script, or upload a thumbnail reference, then build the same Factory package.</span>
        </div>
        <button type="submit" form="factoryManualSourceForm" class="scratch-new-project-button">Create Source</button>
      </div>
      <form class="scratch-project-form" data-factory-manual-source-form id="factoryManualSourceForm">
        <label>
          <span>Project title</span>
          <input name="projectName" placeholder="Optional working title..." autocomplete="off" />
        </label>
        <label>
          <span>YouTube URL</span>
          <input name="youtubeUrl" placeholder="Paste a source YouTube URL..." autocomplete="off" />
        </label>
        <label>
          <span>Manual thumbnail</span>
          <input name="thumbnail" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        <label class="wide">
          <span>Manual source script</span>
          <textarea name="script" placeholder="Paste the original/source script here. Rewrite Script will rebuild it for Jon Mac." spellcheck="true"></textarea>
        </label>
        <div class="scratch-project-actions">
          <button type="submit" class="primary ready">Create Manual Factory Source</button>
        </div>
      </form>
    </section>
  `;
}

function renderScratchProjectTools(packageData) {
  if (!packageData?.customProject) return "";
  const source = packageData.sourceVideos?.[0] || {};
  return `
    <section class="scratch-project-tools">
      <div class="scratch-project-tools-head">
        <div>
          <p class="eyebrow">Scratch Inputs</p>
          <strong>${escapeHtml(source.title || "Custom project")}</strong>
          <span>Update the source script or pull a YouTube title and thumbnail without leaving this project.</span>
        </div>
      </div>
      <div class="scratch-tool-grid">
        <form class="scratch-tool-card" data-scratch-script-form>
          <label>
            <span>Source script</span>
            <textarea name="script" spellcheck="true">${escapeHtml(originalTranscriptText(packageData) || source.customTranscript || "")}</textarea>
          </label>
          <button type="submit">Save Source Script</button>
        </form>
        <form class="scratch-tool-card" data-scratch-url-form>
          <label>
            <span>YouTube URL</span>
            <input name="youtubeUrl" value="${escapeHtml(source.url || "")}" placeholder="Paste a YouTube URL..." autocomplete="off" />
          </label>
          <button type="submit">Pull Title + Thumbnail</button>
          ${source.thumbnail ? `<div class="scratch-thumb-preview"><img src="${escapeHtml(source.thumbnail)}" alt="Imported thumbnail" loading="lazy" /></div>` : ""}
        </form>
        <form class="scratch-tool-card" data-scratch-thumbnail-form>
          <label>
            <span>Manual thumbnail</span>
            <input name="thumbnail" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <button type="submit">Save Thumbnail Reference</button>
          ${source.thumbnail ? `<div class="scratch-thumb-preview"><img src="${escapeHtml(source.thumbnail)}" alt="Current thumbnail reference" loading="lazy" /></div>` : ""}
        </form>
      </div>
    </section>
  `;
}

function renderProjects() {
  els.grid.className = "projects-panel";
  els.resultTitle.textContent = "Projects";
  els.resultMeta.textContent = `${state.savedProjects.length} saved YouTube Gen project${state.savedProjects.length === 1 ? "" : "s"}`;
  els.grid.innerHTML = `
    ${renderScratchProjectCreator()}
    ${renderSavedProjectsShelf()}
  `;
}

function renderIdeas() {
  const eligible = remakeEligibleRows();
  const selected = autoSelectedRemakeRows();
  const sourceDays = sourcePoolDays();
  const sourceMinMultiple = sourcePoolMinMultiple();
  const sourceMultipleLabel = formatOutlierMultiple(sourceMinMultiple);
  const latestPackage = repairActivePackageTitleOptions() || state.remakePackages[0];
  const packageSources = latestPackage ? sourceRowsForPackage(latestPackage) : [];
  const selectedInPool = selected.some((row) => row.id === state.selectedRemakeVideoId);
  const selectedInPackage = packageSources.some((row) => row.id === state.selectedRemakeVideoId);
  if (state.selectedRemakeVideoId && !selectedInPool && !selectedInPackage) {
    state.selectedRemakeVideoId = "";
  }
  const selectedSource = selected.find((row) => row.id === state.selectedRemakeVideoId)
    || packageSources.find((row) => row.id === state.selectedRemakeVideoId);
  els.grid.className = "idea-builder";
  els.resultTitle.textContent = "Factory";
  els.resultMeta.textContent = "Choose an outlier, reverse engineer it, then build the full production package";

  const status = state.channelError || state.channelStatus || "";
  const statusMarkup = state.channelRefreshProgress ? channelRefreshStatusMarkup() : (status ? escapeHtml(status) : "");
  const canGenerate = Boolean(selectedSource) && !state.ideaGenerationLoading;
  const canRefreshSources = !state.channelLoading && !state.channelRefreshing && Boolean(state.rows.length);
  const refreshSourcesLabel = state.channelRefreshing ? "Refreshing Videos..." : "Refresh Videos";
  const factoryButtonLabel = state.ideaGenerationLoading && state.ideaProgress
    ? `${state.ideaProgress.step || "Building"} ${Math.round(Number(state.ideaProgress.percent || 0))}%`
    : state.ideaGenerationLoading
      ? "Building..."
      : "Generate Factory Package";
  const emptyMessage = selected.length === 0
    ? `No sources match last ${sourceDays} days at ${sourceMultipleLabel}x+. Widen the date range or lower the multiple.`
    : "Click one source video before generating a Factory package.";

  els.grid.innerHTML = `
    ${!latestPackage ? `${renderFactoryManualSourceCreator()}<section class="idea-builder-panel">
      <div class="idea-builder-head">
        <div>
          <p class="eyebrow">Source pool</p>
          <h3>${eligible.length} matching source option${eligible.length === 1 ? "" : "s"}</h3>
          <p>Showing ${escapeHtml(sourcePoolRangeLabel(eligible.length))}. Last ${sourceDays} days, ${sourceMultipleLabel}x+ outlier multiple required.</p>
          <div class="source-pool-controls" aria-label="Source pool filters">
            <label>
              <span>Date range</span>
              <strong>${sourceDays} day${sourceDays === 1 ? "" : "s"}</strong>
              <input
                type="range"
                min="${SOURCE_POOL_MIN_DAYS}"
                max="${SOURCE_POOL_MAX_DAYS}"
                step="1"
                value="${sourceDays}"
                data-source-pool-days
                aria-label="Source date range"
              />
            </label>
            <label>
              <span>Minimum multiple</span>
              <strong>${sourceMultipleLabel}x</strong>
              <input
                type="range"
                min="${SOURCE_POOL_MIN_MULTIPLE}"
                max="${SOURCE_POOL_MAX_MULTIPLE}"
                step="${SOURCE_POOL_MULTIPLE_STEP}"
                value="${sourceMinMultiple}"
                data-source-pool-multiple
                aria-label="Source minimum outlier multiple"
              />
            </label>
          </div>
        </div>
        <div class="source-pool-actions">
          <button type="button" class="secondary refresh-all" data-refresh-source-videos ${canRefreshSources ? "" : "disabled"}>
            ${escapeHtml(refreshSourcesLabel)}
          </button>
          <button type="button" class="secondary" data-reload-source-pool ${eligible.length > SOURCE_POOL_PAGE_SIZE ? "" : "disabled"}>
            ${eligible.length > SOURCE_POOL_PAGE_SIZE ? "Load 6 more" : "No more matches"}
          </button>
          <button class="primary${canGenerate ? " ready" : ""}" type="button" data-generate-remake ${canGenerate ? "" : "disabled"}>
            ${escapeHtml(factoryButtonLabel)}
          </button>
        </div>
      </div>
      ${statusMarkup ? `<div class="idea-status ${state.channelError ? "error" : ""}">${statusMarkup}</div>` : ""}
      ${renderIdeaProgress()}
      ${selected.length ? `<div class="idea-source-grid">${selected.map((row) => renderSourceCard(row, row.id === state.selectedRemakeVideoId)).join("")}</div>` : `<div class="empty">${emptyMessage}</div>`}
    </section>` : ""}
    ${latestPackage ? `
      <section class="package-panel">
        <div class="package-workbar">
          <div>
            <p class="eyebrow">Package workspace</p>
            <strong>${escapeHtml(latestPackage.recommendedStyle || "Ready for review")}</strong>
          </div>
          <div class="package-workbar-actions">
            <span>${latestPackage.assets ? "Generated assets ready" : "Review one step at a time"}</span>
            <button type="button" data-save-project>${latestPackage.projectId ? "Auto-saved" : "Save Project"}</button>
          </div>
        </div>
        ${renderScratchProjectTools(latestPackage)}
        ${renderPackageStepper(latestPackage)}
        ${renderPackageWorkspace(latestPackage)}
        ${renderThumbnailPromptModal(latestPackage)}
        ${renderAssetPreviewModal()}
      </section>
    ` : ""}
  `;
}

function renderPerformance() {
  els.grid.className = "performance-panel";
  els.resultTitle.textContent = "Performance Log";
  els.resultMeta.textContent = `${state.performanceLogs.length} logged checkpoints feeding the learning loop`;
  els.grid.innerHTML = `
    <form class="performance-form" id="performanceForm">
      <input name="title" placeholder="Video title..." required />
      <select name="window">
        <option value="48h">48h</option>
        <option value="7d">7d</option>
        <option value="30d">30d</option>
      </select>
      <input name="views" type="number" min="0" placeholder="Views" required />
      <input name="ctr" type="number" min="0" step="0.1" placeholder="CTR %" />
      <input name="avd" placeholder="AVD" />
      <input name="subs" type="number" placeholder="Subs" />
      <button type="submit">Log</button>
    </form>
    <div class="performance-list">
      ${state.performanceLogs.map((log) => `
        <article>
          <div>
            <strong>${escapeHtml(log.title)}</strong>
            <button type="button" data-remove-log="${escapeHtml(log.id)}">Remove</button>
          </div>
          <span>${escapeHtml(log.window)} · ${compactNumber(Number(log.views || 0))} views · ${log.ctr || 0}% CTR · ${escapeHtml(log.avd || "AVD n/a")} · ${log.subs || 0} subs</span>
        </article>
      `).join("") || `<div class="empty">No performance logs yet.</div>`}
    </div>
  `;
}

function renderKeywords() {
  const items = keywordItems();
  els.grid.className = "keyword-list";
  els.resultTitle.textContent = "Trend Keywords";
  const customCount = state.customKeywords.length;
  els.resultMeta.textContent = `${items.length} unique YouTube Search keyword${items.length === 1 ? "" : "s"} from ${state.rows.length} videos, ${FOCUS_KEYWORDS.length} focus${customCount ? `, ${customCount} added` : ""}`;

  if (!items.length) {
    els.grid.innerHTML = `<div class="empty">No keywords match this search.</div>`;
    return;
  }

  els.grid.innerHTML = items.map((item) => {
    const url = trendsUrl(item.query);
    const path = sparklinePath(item.points, 260, 58);
    const loading = isTrendLoading(item.query);
    const error = state.trendErrors[item.query.toLowerCase()];
    const line = path
      ? `<path class="keyword-line" d="${path}" />`
      : `<path class="keyword-line muted" d="M0 45 C44 42 58 19 95 28 S168 43 260 20" />`;
    const topTitle = item.topVideo
      ? `<a class="video-title-link" href="${item.topVideo.url}" target="_blank" rel="noopener noreferrer" title="Open on YouTube">${escapeHtml(item.topVideo.title)}</a>`
      : item.focus ? "Focus keyword" : "Added keyword";
    const topChannel = item.topVideo ? escapeHtml(item.topVideo.channel) : item.focus ? "Focus" : "Custom";
    const customAction = item.custom ? `<button class="keyword-remove" type="button" data-remove-keyword="${escapeHtml(item.query)}">Remove</button>` : "";
    const status = loading ? "loading trend..." : error ? error : trendSummary(item.points);
    const volumeDisplay = keywordVolumeDisplay(item.query);
    return `
      <article class="keyword-row ${loading ? "loading" : ""} ${error ? "error" : ""}">
        <div class="keyword-main">
          <div class="keyword-titleline">
            <a class="keyword-name" href="${url}" target="_blank" rel="noreferrer">${escapeHtml(item.query)}</a>
            ${customAction}
          </div>
          <div class="keyword-meta">
            <span>${item.count} video${item.count === 1 ? "" : "s"}</span>
            <span>${compactNumber(item.views)} views</span>
            <span>${item.topOutlier.toFixed(2)}x top outlier</span>
          </div>
          <div class="keyword-top-video">
            <span>${topChannel}</span>
            <span>${topTitle}</span>
          </div>
        </div>
          <div class="keyword-graph">
          <div class="keyword-graph-head">
            <span>YT Search 12m</span>
            <span>${escapeHtml(status)}</span>
          </div>
          <svg viewBox="0 0 260 58" role="img" aria-label="Google Trends YouTube Search interest for ${escapeHtml(item.query)}">
            <path class="keyword-grid" d="M0 14.5H260 M0 29.5H260 M0 44.5H260" />
            ${line}
          </svg>
          <div class="keyword-volume ${volumeDisplay.className}" title="${escapeHtml(volumeDisplay.title)}">
            <span>YouTube search volume</span>
            <strong>${escapeHtml(volumeDisplay.value)}</strong>
            <small>${escapeHtml(volumeDisplay.detail)}</small>
          </div>
        </div>
      </article>
    `;
  }).join("");
  queueMicrotask(() => queueKeywordVolumeLoads(items));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function update() {
  const isOutliers = state.view === "videos";
  const isProjects = state.view === "projects";
  const isFactory = state.view === "ideas";
  renderChips();
  els.saved.hidden = !isOutliers || state.channelsHidden;
  if (els.toggleChannels) {
    els.toggleChannels.hidden = !isOutliers;
    els.toggleChannels.textContent = state.channelsHidden ? "Show Channels" : "Hide Channels";
    els.toggleChannels.setAttribute("aria-pressed", state.channelsHidden ? "true" : "false");
  }
  els.filters.hidden = !isOutliers;
  els.topSearch.hidden = !isOutliers;
  els.sortControl.hidden = !isOutliers;
  els.keywordAddForm.hidden = true;
  els.channelAddForm.hidden = !isOutliers;
  els.channelInput.disabled = state.channelLoading || state.channelRefreshing;
  els.analyze.disabled = state.channelLoading || state.channelRefreshing;
  if (els.refreshChannels) {
    els.refreshChannels.disabled = state.channelLoading || state.channelRefreshing || !state.rows.length;
    els.refreshChannels.textContent = state.channelRefreshing ? "Refreshing..." : "Refresh Videos";
  }
  els.channelStatus.textContent = state.channelError || state.channelStatus;
  els.channelStatus.classList.toggle("error", Boolean(state.channelError));
  els.channelStatus.hidden = !state.channelError && !state.channelStatus;
  els.resultActionStatus.innerHTML = channelRefreshStatusMarkup();
  els.resultActionStatus.classList.toggle("error", Boolean(state.channelError));
  els.resultActionStatus.hidden = !state.channelError && !state.channelStatus;
  els.clear.hidden = isProjects;
  els.generateIdeas.hidden = !isOutliers || state.selectedVideos.size < 1;
  els.generateIdeas.textContent = `Generate Idea${state.selectedVideos.size === 1 ? "" : "s"} (${state.selectedVideos.size})`;
  if (isFactory || isProjects) {
    els.generateIdeas.hidden = true;
  }
  els.outliersPath.classList.toggle("active", isOutliers);
  els.projectsPath.classList.toggle("active", isProjects);
  els.factoryPath.classList.toggle("active", isFactory);
  if (state.view === "keywords") {
    renderKeywords();
  } else if (isFactory) {
    renderIdeas();
  } else if (isProjects) {
    renderProjects();
  } else if (state.view === "performance") {
    renderPerformance();
  } else {
    renderCards();
  }
  if (isFactory) {
    maybeAutoAttachCompletedHeyGenVideo();
  }
}

function clearFilters() {
  state.view = "videos";
  state.selectedChannels.clear();
  state.search = "";
  state.date = "all";
  state.duration = "all";
  state.minViews = 0;
  state.onlyOutliers = false;
  state.sort = "viewAll";
  state.selectedVideos.clear();
  els.search.value = "";
  els.date.value = "all";
  els.duration.value = "all";
  els.minViews.value = "0";
  els.onlyOutliers.checked = false;
  els.sort.value = "viewAll";
  update();
}

function resetFactoryWorkspace(status = "") {
  state.view = "ideas";
  state.selectedVideos.clear();
  state.selectedRemakeVideoId = "";
  state.packageStep = "source";
  state.thumbnailPromptIndex = 1;
  state.editingThumbnailIndex = 0;
  state.editingThumbnailPrompt = "";
  state.previewAsset = null;
  state.editingScript = false;
  state.scriptDraft = "";
  state.editorDraftName = "";
  state.editorDraftPhone = "";
  state.editorMessageDraft = "";
  state.editorMessageTouched = false;
  state.channelError = "";
  state.channelStatus = status;
  state.ideaProgress = null;
  state.assetProgress = null;
  state.ideaGenerationLoading = false;
  state.assetGenerationLoading = false;
  state.assetGenerationTarget = null;
  state.remakePackages = [];
  state.sourcePoolOffset = 0;
  clearActiveFactoryStorage();
  update();
}

function clearIdeasState() {
  resetFactoryWorkspace("Workspace cleared. Saved projects are still available.");
}

function handleClear() {
  if (state.view === "ideas") {
    clearIdeasState();
    return;
  }
  clearFilters();
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.search = event.target.value;
    update();
  });

  els.sort.addEventListener("change", (event) => {
    if (event.target.value === "viewAll") {
      clearFilters();
      return;
    }
    state.sort = event.target.value;
    if (state.sort === "viewsMultiple") state.metric = "views";
    if (state.sort === "velocityMultiple") state.metric = "velocity";
    if (state.sort === "combinedScore") state.metric = "combined";
    els.metric.value = state.metric;
    update();
  });

  els.date.addEventListener("change", (event) => {
    state.date = event.target.value;
    update();
  });

  els.duration.addEventListener("change", (event) => {
    state.duration = event.target.value;
    update();
  });

  els.minViews.addEventListener("change", (event) => {
    state.minViews = Number(event.target.value);
    update();
  });

  els.metric.addEventListener("change", (event) => {
    state.metric = event.target.value;
    update();
  });

  els.onlyOutliers.addEventListener("change", (event) => {
    state.onlyOutliers = event.target.checked;
    update();
  });

  els.chips.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-channel]");
    if (removeButton) {
      const key = removeButton.dataset.removeChannel;
      const channel = channelSummary(state.rows).find((item) => item.key === key);
      if (channel) removeChannelData(channel.key, channel.name, channel.count);
      return;
    }
    const chip = event.target.closest("[data-channel]");
    if (!chip) return;
    const key = chip.dataset.channel;
    if (state.selectedChannels.has(key)) {
      state.selectedChannels.delete(key);
    } else {
      state.selectedChannels.add(key);
    }
    update();
  });

  els.clear.addEventListener("click", handleClear);
  els.refreshChannels?.addEventListener("click", () => refreshAllChannels());
  els.toggleChannels?.addEventListener("click", () => {
    state.channelsHidden = !state.channelsHidden;
    saveChannelsHidden();
    update();
  });
  els.outliersPath.addEventListener("click", () => {
    state.view = "videos";
    update();
  });
  els.projectsPath.addEventListener("click", () => {
    state.view = "projects";
    update();
  });
  els.factoryPath.addEventListener("click", () => {
    resetFactoryWorkspace();
  });
  els.generateIdeas.addEventListener("click", generateIdeasFromSelection);
  els.keywordAddForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const keyword = normalizeKeyword(els.keywordInput.value);
    if (!keyword) return;
    const existing = new Set([
      ...state.customKeywords.map((value) => value.toLowerCase()),
      ...state.rows.map((row) => row.trendQuery.toLowerCase()),
    ]);
    if (!existing.has(keyword.toLowerCase())) {
      state.customKeywords.push(keyword);
      saveCustomKeywords();
    }
    state.view = "keywords";
    state.search = keyword;
    els.search.value = keyword;
    els.keywordInput.value = "";
    update();
    loadTrendData(keyword);
    loadKeywordVolumeData(keyword);
  });
  els.channelAddForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const channel = normalizeKeyword(els.channelInput.value);
    if (!channel) return;
    els.channelInput.value = "";
    loadChannelData(channel);
  });
  els.grid.addEventListener("keydown", (event) => {
    const sourceCard = event.target.closest("[data-select-remake]");
    const wordHookCard = event.target.closest("[data-select-word-hook]");
    const approveCard = event.target.closest("[data-approve-step]");
    if (!["Enter", " "].includes(event.key)) return;
    const target = sourceCard || wordHookCard || approveCard;
    if (!target) return;
    event.preventDefault();
    target.click();
  });
  els.grid.addEventListener("click", async (event) => {
    const closePreview = event.target.closest("[data-close-asset-preview]");
    if (closePreview && event.target === closePreview) {
      closeAssetPreview();
      return;
    }
    const closePreviewButton = event.target.closest("[data-close-asset-preview-button]");
    if (closePreviewButton) {
      closeAssetPreview();
      return;
    }
    const downloadButton = event.target.closest("[data-download-asset]");
    if (downloadButton) {
      event.preventDefault();
      event.stopPropagation();
      downloadAsset(downloadButton.dataset.downloadAsset, downloadButton.dataset.downloadFilename);
      return;
    }
    const previewButton = event.target.closest("[data-preview-asset]");
    if (previewButton) {
      event.preventDefault();
      event.stopPropagation();
      openAssetPreview(previewButton.dataset.previewAsset, previewButton.dataset.previewFilename);
      return;
    }
    const pickAvatarVideo = event.target.closest("[data-pick-avatar-video]");
    if (pickAvatarVideo) {
      event.preventDefault();
      event.stopPropagation();
      const input = els.grid.querySelector("[data-avatar-video-file]");
      if (input) {
        input.value = "";
        input.click();
      }
      return;
    }
    const startHeygenCodex = event.target.closest("[data-start-heygen-codex]");
    if (startHeygenCodex) {
      event.preventDefault();
      event.stopPropagation();
      startHeyGenCodexAutomation(latestPackage());
      return;
    }
    const recoverAvatarVideo = event.target.closest("[data-recover-avatar-video]");
    if (recoverAvatarVideo) {
      event.preventDefault();
      event.stopPropagation();
      recoverAvatarVideoFromCodexJob(latestPackage());
      return;
    }
    const checkHeygenCodex = event.target.closest("[data-check-heygen-codex]");
    if (checkHeygenCodex) {
      event.preventDefault();
      event.stopPropagation();
      pollHeyGenCodexJob(checkHeygenCodex.dataset.checkHeygenCodex, checkHeygenCodex.dataset.statusUrl, true);
      return;
    }
    const uploadAvatarDrive = event.target.closest("[data-upload-avatar-drive]");
    if (uploadAvatarDrive) {
      event.preventDefault();
      event.stopPropagation();
      uploadAvatarToDrive(latestPackage());
      return;
    }
    const recheckCloudConfig = event.target.closest("[data-recheck-cloud-config]");
    if (recheckCloudConfig) {
      event.preventDefault();
      event.stopPropagation();
      loadCloudConfigStatus(true);
      return;
    }
    const openDriveFolder = event.target.closest("[data-open-drive-folder]");
    if (openDriveFolder) {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(openDriveFolder.dataset.openDriveFolder, "Drive folder opened in a new window.");
      return;
    }
    const deleteThumbnail = event.target.closest("[data-delete-thumbnail]");
    if (deleteThumbnail) {
      event.preventDefault();
      event.stopPropagation();
      deleteThumbnailAsset(Number(deleteThumbnail.dataset.deleteThumbnail));
      return;
    }
    if (event.target.closest(".asset-preview-link")) {
      return;
    }
    const closeThumbEdit = event.target.closest("[data-close-thumb-edit-modal]");
    if (closeThumbEdit && event.target === closeThumbEdit) {
      closeThumbnailPromptEditor();
      return;
    }
    const cancelThumbEdit = event.target.closest("[data-cancel-thumb-edit]");
    if (cancelThumbEdit) {
      closeThumbnailPromptEditor();
      return;
    }
    const sendToFactory = event.target.closest("[data-send-to-factory]");
    if (sendToFactory) {
      event.preventDefault();
      event.stopPropagation();
      sendOutlierRowToFactory(sendToFactory.dataset.sendToFactory);
      return;
    }
    const videoLink = event.target.closest(".video-open-link");
    if (videoLink && videoLink.href) {
      event.preventDefault();
      event.stopPropagation();
      openVideoUrl(videoLink.href);
      return;
    }
    const generateRemake = event.target.closest("[data-generate-remake]");
    if (generateRemake) {
      event.preventDefault();
      event.stopPropagation();
      generateRemakePackage();
      return;
    }
    const nextPackage = event.target.closest("[data-next-package-step]");
    if (nextPackage) {
      const targetStep = nextPackage.dataset.nextPackageStep;
      const current = latestPackage();
      const skipAvatarDriveUpload = nextPackage.dataset.skipAvatarDriveUpload === "true";
      if (state.packageStep === "avatar" && targetStep === "edit" && !driveFolderUrl(current) && !skipAvatarDriveUpload) {
        event.preventDefault();
        event.stopPropagation();
        const uploaded = await uploadAvatarToDrive(current);
        if (!uploaded) return;
      }
      state.packageStep = targetStep;
      if (targetStep === "edit") {
        clearDriveUploadFailure();
        applyEditorDraftFromPackage(latestPackage());
      }
      autosaveCurrentProject();
      update();
      return;
    }
    const saveProject = event.target.closest("[data-save-project]");
    if (saveProject) {
      saveCurrentProject();
      return;
    }
    const loadProject = event.target.closest("[data-load-project]");
    if (loadProject) {
      loadSavedProject(loadProject.dataset.loadProject);
      return;
    }
    const removeProject = event.target.closest("[data-remove-project]");
    if (removeProject) {
      removeSavedProject(removeProject.dataset.removeProject);
      return;
    }
    const generateAssets = event.target.closest("[data-generate-kie-assets]");
    if (generateAssets) {
      const kind = generateAssets.dataset.targetKind || "all";
      const index = Number(generateAssets.dataset.targetIndex || 0);
      let targets = null;
      if (kind === "thumbnail" && index) {
        if (!thumbnailPromptReady(index)) {
          revealThumbnailPrompt(index);
          return;
        }
        targets = { thumbnails: [index], visualHooks: [] };
      }
      if (kind === "thumbnail-all") targets = { thumbnails: [1, 2, 3, 4, 5], visualHooks: [] };
      if (kind === "visualHook" && index) targets = { thumbnails: [], visualHooks: [index] };
      if (kind === "visual-all") targets = { thumbnails: [], visualHooks: [1, 2, 3, 4, 5] };
      generateKieAssetsForLatestPackage(targets);
      return;
    }
    const editThumbnailPrompt = event.target.closest("[data-edit-thumbnail-prompt]");
    if (editThumbnailPrompt) {
      event.preventDefault();
      event.stopPropagation();
      openThumbnailPromptEditor(Number(editThumbnailPrompt.dataset.editThumbnailPrompt));
      return;
    }
    const editScript = event.target.closest("[data-edit-script]");
    if (editScript) {
      const current = latestPackage();
      if (current) beginScriptEdit(current);
      return;
    }
    const copyAvatarScript = event.target.closest("[data-copy-avatar-script]");
    if (copyAvatarScript) {
      const current = latestPackage();
      const text = avatarScriptText(current);
      copyTextToClipboard(text, "Full script copied.");
      return;
    }
    const selectEditor = event.target.closest("[data-select-editor]");
    if (selectEditor) {
      const editor = EDITOR_PRESETS[Number(selectEditor.dataset.selectEditor || 0)];
      if (editor) {
        state.editorDraftName = editor.name;
        state.editorDraftPhone = editor.phone;
        state.editorMessageTouched = false;
        state.editorMessageDraft = "";
        saveEditorDraftToPackage();
        update();
      }
      return;
    }
    const copyEditorMessage = event.target.closest("[data-copy-editor-message]");
    if (copyEditorMessage) {
      copyTextToClipboard(editorHandoffMessageDraft(latestPackage()), "Editor WhatsApp message copied.");
      return;
    }
    const openEditorHandoff = event.target.closest("[data-editor-handoff-open]");
    if (openEditorHandoff) {
      const current = latestPackage();
      const editorPhone = String(state.editorDraftPhone || "").trim();
      const message = editorHandoffMessageDraft(current);
      const whatsappUrl = editorWhatsAppUrl(current);
      if (!driveFolderUrl(current)) {
        event.preventDefault();
        state.channelError = "Upload the Drive folder in Step 6 before opening WhatsApp.";
        state.channelStatus = "";
        update();
        return;
      }
      if (!editorPhone || !normalizeWhatsAppPhone(editorPhone)) {
        event.preventDefault();
        state.channelError = "Paste the editor WhatsApp number with country code first.";
        state.channelStatus = "";
        update();
        return;
      }
      if (!message) {
        event.preventDefault();
        state.channelError = "Add a message before opening WhatsApp.";
        state.channelStatus = "";
        update();
        return;
      }
      openEditorHandoff.href = whatsappUrl;
      state.channelError = "";
      state.channelStatus = "Opening the WhatsApp desktop app with the editable handoff message.";
      setTimeout(() => markEditorHandoffOpened(current), 100);
      return;
    }
    const prepareHeygenPlugin = event.target.closest("[data-prepare-heygen-plugin]");
    if (prepareHeygenPlugin) {
      prepareHeyGenPluginHandoff();
      return;
    }
    const openAvatarSignin = event.target.closest("[data-open-avatar-signin]");
    if (openAvatarSignin) {
      openExternalUrl(openAvatarSignin.dataset.openAvatarSignin || "https://app.heygen.com/", "Opening HeyGen sign-in.");
      return;
    }
    const cancelScript = event.target.closest("[data-cancel-script-edit]");
    if (cancelScript) {
      cancelScriptEdit();
      return;
    }
    const wordHookCard = event.target.closest("[data-select-word-hook]");
    if (wordHookCard) {
      const index = Number(wordHookCard.dataset.selectWordHook);
      updateLatestPackage((pkg) => {
        const approvals = { ...(pkg.approvals || {}) };
        approvals.wordHookIndex = index;
        return { ...pkg, approvals };
      });
      update();
      return;
    }
    const approveStep = event.target.closest("[data-approve-step]");
    if (approveStep) {
      const step = approveStep.dataset.approveStep;
      const indexValue = approveStep.dataset.approveIndex;
      const index = indexValue === undefined ? null : Number(indexValue);
      updateLatestPackage((pkg) => {
        const approvals = { ...(pkg.approvals || {}) };
        if (step === "title") {
          if (approvals.titleIndex === index) delete approvals.titleIndex;
          else approvals.titleIndex = index;
        } else if (step === "thumbnail") {
          if (approvals.thumbnailIndex === index) delete approvals.thumbnailIndex;
          else approvals.thumbnailIndex = index;
        } else if (step === "wordHook") {
          if (approvals.wordHookIndex === index) delete approvals.wordHookIndex;
          else approvals.wordHookIndex = index;
        } else if (step === "visualHook") {
          if (approvals.visualHookIndex === index) delete approvals.visualHookIndex;
          else approvals.visualHookIndex = index;
        } else if (step === "script") {
          if (approvals.script) delete approvals.script;
          else if (scriptMeetsTarget(pkg.script, pkg)) approvals.script = true;
          else if (scriptLooksLikeAnalysis(scriptFullText(pkg.script))) state.channelError = "This saved draft is analysis, not a word-for-word script. Regenerate the package to replace it.";
          else state.channelError = "Script is under target. Generate the package again so it auto-retries to the full word count.";
        } else if (approvals[step]) {
          delete approvals[step];
        } else {
          approvals[step] = true;
        }
        return { ...pkg, approvals };
      });
      update();
      return;
    }
    const thumbPrompt = event.target.closest("[data-select-thumb-prompt]");
    if (thumbPrompt) {
      state.thumbnailPromptIndex = Number(thumbPrompt.dataset.selectThumbPrompt || 1);
      state.channelError = "";
      autosaveCurrentProject();
      update();
      return;
    }
    const packageStep = event.target.closest("[data-package-step]");
    if (packageStep) {
      const targetStep = packageStep.dataset.packageStep;
      state.packageStep = targetStep;
      if (targetStep === "edit") {
        clearDriveUploadFailure();
        applyEditorDraftFromPackage(latestPackage());
      }
      autosaveCurrentProject();
      update();
      return;
    }
    const clearKieApiKey = event.target.closest("[data-clear-kie-api-key]");
    if (clearKieApiKey) {
      saveKieApiKey("");
      state.channelStatus = "";
      state.channelError = "Kie key cleared from this browser.";
      update();
      return;
    }
    const selectVideo = event.target.closest("[data-select-video]");
    if (selectVideo) {
      const id = selectVideo.dataset.selectVideo;
      if (state.selectedVideos.has(id)) {
        state.selectedVideos.delete(id);
        state.channelError = "";
        state.channelStatus = state.selectedVideos.size
          ? `${state.selectedVideos.size} selected. Generate ideas or select up to 5.`
          : "";
      } else if (state.selectedVideos.size < 5) {
        state.selectedVideos.add(id);
        state.channelError = "";
        state.channelStatus = `${state.selectedVideos.size} selected. Generate ideas or select up to 5.`;
      } else {
        state.channelError = "Use up to 5 selected outliers at a time.";
        state.channelStatus = "";
      }
      update();
      return;
    }
    if (event.target.closest("[data-video-title-link]")) {
      return;
    }
    const selectRemake = event.target.closest("[data-select-remake]");
    if (selectRemake) {
      state.selectedRemakeVideoId = selectRemake.dataset.selectRemake;
      updateLatestPackage((pkg) => ({
        ...pkg,
        approvals: {
          ...(pkg.approvals || {}),
          sourceVideoId: state.selectedRemakeVideoId,
        },
      }));
      state.channelError = "";
      state.channelStatus = "Source video selected. Generate the package when ready.";
      update();
      return;
    }
    const refreshSourceVideos = event.target.closest("[data-refresh-source-videos]");
    if (refreshSourceVideos) {
      refreshAllChannels({ preserveView: "factory" });
      return;
    }
    const reloadSourcePool = event.target.closest("[data-reload-source-pool]");
    if (reloadSourcePool) {
      const eligible = remakeEligibleRows();
      if (eligible.length <= SOURCE_POOL_PAGE_SIZE) return;
      state.sourcePoolOffset = (state.sourcePoolOffset + SOURCE_POOL_PAGE_SIZE) % eligible.length;
      state.selectedRemakeVideoId = "";
      state.channelError = "";
      state.channelStatus = `Loaded ${SOURCE_POOL_PAGE_SIZE} more source options.`;
      update();
      return;
    }
    const approveIdea = event.target.closest("[data-approve-idea]");
    if (approveIdea) {
      setIdeaStatus(approveIdea.dataset.approveIdea, "approved");
      return;
    }
    const rejectIdea = event.target.closest("[data-reject-idea]");
    if (rejectIdea) {
      setIdeaStatus(rejectIdea.dataset.rejectIdea, "rejected");
      return;
    }
    const packageIdea = event.target.closest("[data-package-idea]");
    if (packageIdea) {
      setIdeaStatus(packageIdea.dataset.packageIdea, "approved");
      return;
    }
    const removeLog = event.target.closest("[data-remove-log]");
    if (removeLog) {
      state.performanceLogs = state.performanceLogs.filter((log) => log.id !== removeLog.dataset.removeLog);
      savePerformanceLogs();
      update();
      return;
    }
    const button = event.target.closest("[data-remove-keyword]");
    if (!button) return;
    const keyword = button.dataset.removeKeyword;
    state.customKeywords = state.customKeywords.filter((value) => value !== keyword);
    saveCustomKeywords();
    update();
  });
  els.grid.addEventListener("input", (event) => {
    const thumbPromptText = event.target.closest("[data-edit-thumb-text]");
    if (thumbPromptText) {
      state.editingThumbnailPrompt = thumbPromptText.value;
    }
    const scriptDraft = event.target.closest("[data-script-draft]");
    if (scriptDraft) {
      state.scriptDraft = scriptDraft.value;
    }
    const sourcePoolDaysInput = event.target.closest("[data-source-pool-days]");
    if (sourcePoolDaysInput) {
      state.sourcePoolDays = sourcePoolDaysInput.value;
      state.sourcePoolOffset = 0;
      state.selectedRemakeVideoId = "";
      state.channelError = "";
      state.channelStatus = "";
      update();
      return;
    }
    const sourcePoolMultipleInput = event.target.closest("[data-source-pool-multiple]");
    if (sourcePoolMultipleInput) {
      state.sourcePoolMinMultiple = sourcePoolMultipleInput.value;
      state.sourcePoolOffset = 0;
      state.selectedRemakeVideoId = "";
      state.channelError = "";
      state.channelStatus = "";
      update();
      return;
    }
    const editorName = event.target.closest("[data-editor-name]");
    if (editorName) {
      state.editorDraftName = editorName.value;
      saveEditorDraftToPackage();
    }
    const editorPhone = event.target.closest("[data-editor-phone]");
    if (editorPhone) {
      state.editorDraftPhone = editorPhone.value;
      saveEditorDraftToPackage();
      refreshEditorWhatsAppLink();
    }
    const editorMessage = event.target.closest("[data-editor-message]");
    if (editorMessage) {
      state.editorMessageDraft = editorMessage.value;
      state.editorMessageTouched = true;
      saveEditorDraftToPackage();
      refreshEditorWhatsAppLink();
    }
  });
  els.grid.addEventListener("change", (event) => {
    const avatarVideoInput = event.target.closest("[data-avatar-video-file]");
    if (avatarVideoInput) {
      const file = avatarVideoInput.files?.[0];
      attachAvatarVideoFile(file);
      return;
    }
  });
  els.grid.addEventListener("submit", (event) => {
    if (event.target.matches("[data-factory-manual-source-form]")) {
      event.preventDefault();
      createManualFactorySourceFromForm(event.target);
      return;
    }
    if (event.target.matches("[data-scratch-project-form]")) {
      event.preventDefault();
      createScratchProjectFromForm(event.target);
      return;
    }
    if (event.target.matches("[data-scratch-script-form]")) {
      event.preventDefault();
      const form = new FormData(event.target);
      saveScratchSourceScript(form.get("script"));
      return;
    }
    if (event.target.matches("[data-scratch-url-form]")) {
      event.preventDefault();
      const form = new FormData(event.target);
      importMetadataIntoScratchProject(form.get("youtubeUrl"));
      return;
    }
    if (event.target.matches("[data-scratch-thumbnail-form]")) {
      event.preventDefault();
      const file = new FormData(event.target).get("thumbnail");
      saveScratchSourceThumbnail(file);
      return;
    }
    if (event.target.matches("[data-editor-handoff-form]")) {
      event.preventDefault();
      sendEditorHandoff(latestPackage());
      return;
    }
    if (event.target.matches("[data-avatar-browser-form]")) {
      event.preventDefault();
      const input = event.target.querySelector("[data-avatar-browser-url]");
      state.avatarBrowserUrl = normalizeAvatarBrowserUrl(input?.value || "https://app.heygen.com/");
      state.channelError = "";
      state.channelStatus = "HeyGen browser loaded.";
      update();
      return;
    }
    if (event.target.matches("[data-thumb-edit-form]")) {
      event.preventDefault();
      generateEditedThumbnailPrompt(event.submitter?.value || "replace");
      return;
    }
    if (event.target.matches("[data-save-kie-api-key]")) {
      event.preventDefault();
      const form = new FormData(event.target);
      saveKieApiKey(form.get("kieApiKey"));
      state.channelError = "";
      state.channelStatus = "Kie key saved in this browser.";
      update();
      return;
    }
    if (event.target.matches("[data-script-edit-form]")) {
      event.preventDefault();
      saveScriptEdit();
      return;
    }
    if (event.target.id !== "performanceForm") return;
    event.preventDefault();
    const form = new FormData(event.target);
    state.performanceLogs = [{
      id: `perf_${Date.now()}`,
      title: normalizeKeyword(form.get("title")),
      window: form.get("window"),
      views: Number(form.get("views") || 0),
      ctr: Number(form.get("ctr") || 0),
      avd: normalizeKeyword(form.get("avd")),
      subs: Number(form.get("subs") || 0),
      createdAt: new Date().toISOString(),
    }, ...state.performanceLogs].slice(0, 200);
    savePerformanceLogs();
    update();
  });
}

async function init() {
  bindEvents();
  await hydrateCloudState();
  state.trends = window.OUTLIER_TRENDS?.topics || {};
  state.keywordVolumes = window.OUTLIER_KEYWORD_VOLUMES?.keywords || {};
  state.keywordVolumeOverrides = loadKeywordVolumeOverrides();
  state.keywordToolApiKey = loadKeywordToolApiKey();
  state.customKeywords = loadCustomKeywords();
  state.ideas = loadStoredList(IDEAS_STORAGE);
  const recoveredFactoryData = seedRecoveredFactoryData(
    loadStoredList(REMAKE_PACKAGES_STORAGE),
    loadStoredList(REMAKE_PROJECTS_STORAGE),
  );
  state.remakePackages = [];
  state.savedProjects = recoveredFactoryData.projects;
  state.selectedRemakeVideoId = "";
  state.packageStep = "source";
  clearActiveFactoryStorage();
  state.performanceLogs = loadStoredList(PERFORMANCE_STORAGE);
  state.channelsHidden = loadChannelsHidden();
  const shippedRows = Array.isArray(window.OUTLIER_ROWS) ? window.OUTLIER_ROWS : [];
  const refreshedRows = loadRefreshedRows() || [];
  const cloudRows = await loadCloudOutlierRows();
  let rows = mergeRowsById(shippedRows, refreshedRows, cloudRows);
  if (!rows.length) {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Could not load ${DATA_URL}`);
    rows = await response.json();
  }
  state.rows = rows.map(enrich);
  update();
}

init().catch((error) => {
  console.error(error);
  if (els.resultTitle) els.resultTitle.textContent = "Outliers";
  if (els.resultMeta) els.resultMeta.textContent = "Could not load videos";
  if (els.resultActionStatus) {
    els.resultActionStatus.hidden = false;
    els.resultActionStatus.textContent = "Load failed";
  }
  if (els.grid) {
    els.grid.innerHTML = `
      <div class="empty">
        Could not load outlier data: ${escapeHtml(error.message)}.
        Refresh this page and try the cloud app again.
      </div>
    `;
  }
});
