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
  if (!res.ok) throw { status: res.status, data };
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
};
