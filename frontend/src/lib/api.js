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

async function errorMessage(response) {
  try {
    const body = await response.json();
    return body?.error?.message || "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
  }
}

async function send(method, path, body) {
  const opts = { method, headers: headers() };
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
    throw new Error(await errorMessage(response));
  }
  return response;
}

export async function apiJson(method, path, body) {
  const response = await send(method, path, body);
  return response.json();
}

export async function apiBlob(path) {
  const response = await send("GET", path);
  return response.blob();
}

export function casePath(caseId) {
  return `/api/v1/cases/${encodeURIComponent(caseId)}`;
}
