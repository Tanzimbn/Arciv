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
  let res = await rawRequest(method, path, body, getToken());

  // Access token expired? Refresh once and retry.
  if (res.status === 401 && getRefreshToken() && !path.startsWith("/auth/")) {
    if (await tryRefresh()) {
      res = await rawRequest(method, path, body, getToken());
    }
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 after a refresh attempt (or on an auth route) means the session is
    // dead — clear tokens and bounce to login.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      clearTokens();
      window.location.reload();
    }
    throw { status: res.status, data };
  }
  return data;
}

export const api = {
  login: (email, password) =>
    request("POST", "/auth/login", { email, password }),

  register: (email, password) =>
    request("POST", "/auth/register", { email, password }),

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

  searchLinks: (query, limit = 30) =>
    request("GET", `/links/search?q=${encodeURIComponent(query)}&limit=${limit}`),

  getLinks: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ).toString();
    return request("GET", `/links${qs ? "?" + qs : ""}`);
  },

  createLink: (url) => request("POST", "/links", { url }),

  updateLink: (id, patch) => request("PATCH", `/links/${id}`, patch),

  deleteLink: (id) => request("DELETE", `/links/${id}`),

  retryAI: (id) => request("POST", `/links/${id}/retry-ai`),
  generateInsights: (id) => request("POST", `/links/${id}/insights`),

  getMe: () => request("GET", "/auth/me"),

  getSettings: () => request("GET", "/settings"),
  updateSettings: (patch) => request("PATCH", "/settings", patch),
  testAI: () => request("POST", "/settings/ai/test"),

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

  generateTelegramToken: () => request("POST", "/telegram/link-token"),

  adminListUsers: () => request("GET", "/admin/users"),
  adminDeleteUser: (id) => request("DELETE", `/admin/users/${id}`),
  adminStats: (days = 30) => request("GET", `/admin/stats?days=${days}`),
};