const BASE = "/api";

function getToken() {
  return localStorage.getItem("arciv_token");
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("arciv_token");
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
};
