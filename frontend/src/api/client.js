const BASE = "/api";

const ACCESS_KEY = "arciv_token";
const REFRESH_KEY = "arciv_refresh";

export function getToken() {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens({ access_token, refresh_token }) {
  if (access_token) localStorage.setItem(ACCESS_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// Flatten FastAPI's error shape into a readable string. `detail` is a plain
// string for HTTPExceptions, but an array of {loc,msg} for 422 validation
// errors (e.g. password strength) — surface the message instead of "[object]".
export function errMessage(err, fallback = "Something went wrong.") {
  const detail = err?.data?.detail;
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d?.msg || "").replace(/^Value error,\s*/, ""))
      .filter(Boolean)
      .join(". ") || fallback;
  }
  return fallback;
}

async function rawRequest(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

// Endpoints that carry no access token: a 401 from one of these is a real
// credential failure, so refreshing and retrying it is pointless. Every other
// route — `/auth/me` and `/auth/logout` included, since both send the bearer —
// must go through refresh on a 401.
//
// This used to be a `path.startsWith("/auth/")` test, which swept `/auth/me` in
// with the unauthenticated routes. With an expired access token, the dashboard's
// `Promise.all([getLinks, getLinks, getMe, getSettings])` then had `getMe` throw
// 401 while the two `getLinks` beside it refreshed and succeeded — so the whole
// `Promise.all` rejected, the catch swallowed it, and the page rendered its empty
// state until a manual reload (which worked, because the refresh had already
// stored new tokens).
const NO_REFRESH_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/verify-email",
  "/auth/resend-verification",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

// Single-flight refresh so concurrent 401s don't all hit /refresh.
let refreshing = null;

async function tryRefresh() {
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;
  if (!refreshing) {
    refreshing = rawRequest("POST", "/auth/refresh", { refresh_token })
      .then(async (res) => {
        if (!res.ok) {
          clearTokens();
          return false;
        }
        setTokens(await res.json());
        return true;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function request(method, path, body) {
  const refreshable = !NO_REFRESH_PATHS.has(path.split("?")[0]);
  let res = await rawRequest(method, path, body, getToken());

  // Access token expired? Refresh once and retry.
  if (res.status === 401 && refreshable && getRefreshToken()) {
    if (await tryRefresh()) {
      res = await rawRequest(method, path, body, getToken());
    }
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 after a refresh attempt (or on an unauthenticated route) means the
    // session is dead — clear tokens and bounce to login.
    if (res.status === 401 && refreshable) {
      clearTokens();
      window.location.reload();
    }
    throw { status: res.status, data };
  }
  return data;
}

// Build a query string, expanding arrays into repeated keys — `?tag=a&tag=b`,
// which is how FastAPI reads a `list[str]` param. Object.fromEntries + a plain
// URLSearchParams would stringify the array to "a,b" and the server would treat
// that as one topic key named "a,b", matching nothing.
function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      // An empty array means "no filter", not "filter by nothing".
      for (const item of v) if (item != null && item !== "") sp.append(k, String(item));
    } else {
      sp.append(k, String(v));
    }
  }
  const out = sp.toString();
  return out ? "?" + out : "";
}

// In-memory cache for semantic search responses, scoped to this page load. The
// same query is hit repeatedly (debounced typing settling on a term, blur/focus,
// tab switches), so caching the whole response skips the round-trip AND the
// server-side CPU embed. Any link mutation clears it — a stale result set that
// omits a just-saved link or still shows a deleted one is worse than re-fetching.
const SEARCH_CACHE_TTL = 60_000; // ms
const searchCache = new Map(); // `${limit}:${query}` -> { expires, data }

function clearSearchCache() {
  searchCache.clear();
}

// Download the account export as a JSON file. Bypasses the JSON-parsing
// `request` wrapper (we need the raw blob + filename), but reuses the same
// token + single-flight refresh handling.
async function downloadExport() {
  let res = await rawRequest("GET", "/account/export", undefined, getToken());
  if (res.status === 401 && getRefreshToken()) {
    if (await tryRefresh()) {
      res = await rawRequest("GET", "/account/export", undefined, getToken());
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { status: res.status, data };
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : "arciv-export.json";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (email, password) =>
    request("POST", "/auth/login", { email, password }),

  register: (email, password, captchaToken) =>
    request("POST", "/auth/register", {
      email,
      password,
      captcha_token: captchaToken,
    }),

  getConfig: () => request("GET", "/config"),

  verifyEmail: (token) => request("POST", "/auth/verify-email", { token }),
  resendVerification: (email) =>
    request("POST", "/auth/resend-verification", { email }),
  forgotPassword: (email) =>
    request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token, new_password) =>
    request("POST", "/auth/reset-password", { token, new_password }),
  logout: () => {
    const refresh_token = getRefreshToken();
    return refresh_token
      ? request("POST", "/auth/logout", { refresh_token }).catch(() => {})
      : Promise.resolve();
  },

  // `filters` accepts tag / content_type / domain / since / until, same names and
  // meaning as GET /api/links. They go into the cache key: without that, a
  // filtered search would be served the cached unfiltered result set.
  searchLinks: async (query, filters = {}, limit = 30) => {
    // Filters are part of the cache key: without them a filtered search would be
    // served the cached unfiltered result set. Tag arrays are sorted into the key
    // so picking the same two topics in the other order is one cache entry, and
    // JSON.stringify keeps ["a","b"] distinct from ["a,b"].
    const active = Object.entries(filters)
      .filter(([, v]) => v != null && v !== "" && (!Array.isArray(v) || v.length))
      .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])
      .sort(([a], [b]) => a.localeCompare(b));
    const key = `${limit}:${query}:${JSON.stringify(active)}`;
    const hit = searchCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;
    const data = await request(
      "GET",
      `/links/search${qs({ q: query, limit, ...Object.fromEntries(active) })}`
    );
    searchCache.set(key, { expires: Date.now() + SEARCH_CACHE_TTL, data });
    return data;
  },

  // Topics are derived from ai_tags on read, so this is re-fetched after any
  // mutation that can change tags rather than cached.
  getTopics: (params = {}) => request("GET", `/topics${qs(params)}`),

  getLinks: (params = {}) => request("GET", `/links${qs(params)}`),

  createLink: async (url) => {
    const r = await request("POST", "/links", { url });
    clearSearchCache();
    return r;
  },

  updateLink: async (id, patch) => {
    const r = await request("PATCH", `/links/${id}`, patch);
    clearSearchCache();
    return r;
  },

  deleteLink: async (id) => {
    const r = await request("DELETE", `/links/${id}`);
    clearSearchCache();
    return r;
  },

  retryAI: async (id) => {
    const r = await request("POST", `/links/${id}/retry-ai`);
    clearSearchCache();
    return r;
  },
  generateInsights: async (id) => {
    const r = await request("POST", `/links/${id}/insights`);
    clearSearchCache();
    return r;
  },
  getSimilar: (id, limit = 5) =>
    request("GET", `/links/${id}/similar?limit=${limit}`),

  getMe: () => request("GET", "/auth/me"),

  getSettings: () => request("GET", "/settings"),
  getUsage: () => request("GET", "/settings/usage"),
  updateSettings: (patch) => request("PATCH", "/settings", patch),
  testAI: () => request("POST", "/settings/ai/test"),
  // Body is optional: {provider, api_key} lists models for a key the user has
  // typed but not saved — POST so the key never lands in a URL or a log.
  listAIModels: (body) => request("POST", "/settings/ai/models", body || {}),

  exportData: () => downloadExport(),
  deleteAccount: (password) => request("DELETE", "/account", { password }),

  discoverFeed: (url) => request("POST", "/feeds/discover", { url }),
  subscribeFeed: (body) => request("POST", "/feeds", body),
  getFeeds: () => request("GET", "/feeds"),
  updateFeed: (id, patch) => request("PATCH", `/feeds/${id}`, patch),
  deleteFeed: (id) => request("DELETE", `/feeds/${id}`),
  checkFeedNow: (id) => request("POST", `/feeds/${id}/check-now`),

  getNotifications: () => request("GET", "/notifications"),
  getUnreadCount: () => request("GET", "/notifications/unread-count"),
  readNotification: (id) => request("POST", `/notifications/${id}/read`),
  readAllNotifications: () => request("POST", "/notifications/read-all"),


  adminListUsers: () => request("GET", "/admin/users"),
  adminDeleteUser: (id) => request("DELETE", `/admin/users/${id}`),
  adminStats: (days = 30) => request("GET", `/admin/stats?days=${days}`),
};