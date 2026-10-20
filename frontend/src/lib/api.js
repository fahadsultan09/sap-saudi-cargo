import { config, getUser } from "./config";

function headers(extra = {}) {
  const user = getUser();
  return {
    "X-User-Id": user.id || "",
    "X-User-Role": user.role || "",
    ...extra,
  };
}

function base() {
  return String(config.apiBaseUrl || "").replace(/\/$/, "");
}

async function parseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFromBody(body) {
  const detail = body?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const fields = Array.isArray(detail.fields) ? detail.fields : [];
    const base =
      detail.message ||
      body?.error?.message ||
      "Some required information is missing.";
    if (fields.length) {
      return `${base}: ${fields.join(", ")}`;
    }
    return base;
  }
  return (
    body?.error?.message ||
    (typeof detail === "string" ? detail : null) ||
    (typeof body?.message === "string" ? body.message : null) ||
    "Something went wrong. Please try again."
  );
}

async function send(method, path, body) {
  const opts = { method, headers: headers(), credentials: "include" };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(base() + path, opts);
  } catch {
    throw new Error("The application server cannot be reached. Check your connection and try again.");
  }
  if (!response.ok) {
    const parsed = await parseBody(response);
    const err = new Error(messageFromBody(parsed));
    err.status = response.status;
    err.body = parsed;
    throw err;
  }
  return response;
}

export async function apiJson(method, path, body) {
  const response = await send(method, path, body);
  if (response.status === 204) return null;
  return response.json();
}

export async function apiBlob(path) {
  const response = await send("GET", path);
  return response.blob();
}

export function casePath(caseId) {
  return `/api/v1/cases/${encodeURIComponent(caseId)}`;
}

/** Prefer gateway session (/auth/me); fall back to agentic /api/v1/me. */
export async function fetchSession() {
  try {
    const me = await apiJson("GET", "/auth/me");
    const authMode = me.authMode || (me.keycloakConfigured ? "keycloak" : "demo_session");
    // demo_session is API-backed but still allows the local role switcher.
    const source = authMode === "keycloak" || me.keycloakConfigured ? "gateway" : "gateway_demo";
    return {
      source,
      authMode,
      userId: me.userId || me.user_id || "",
      name: me.name || me.userId || me.user_id || "Signed in",
      email: me.email || null,
      roles: me.roles || (me.role ? [me.role] : []),
      role: (me.roles && me.roles[0]) || me.role || "",
      roleLabel: me.roleLabel || "",
    };
  } catch (err) {
    if (err?.status && err.status !== 404) {
      // Non-404 auth errors still try agentic me with headers.
    }
  }
  try {
    const me = await apiJson("GET", "/api/v1/me");
    return {
      source: "agentic",
      authMode: "agentic",
      userId: me.user_id || me.userId || "",
      name: me.name || me.user_id || me.userId || "Signed in",
      email: me.email || null,
      roles: me.role ? [me.role] : me.roles || [],
      role: me.role || (me.roles && me.roles[0]) || "",
    };
  } catch {
    return null;
  }
}

export function signOutUrl() {
  return `${base()}/auth/logout`;
}

export function signInUrl(returnTo = "/") {
  return `${base()}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
