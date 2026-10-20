export const config = {
  apiBaseUrl: "http://127.0.0.1:8000",
  users: [
    { id: "faizan", name: "Faizan", role: "AP_PROCESSOR", roleLabel: "Processor" },
    { id: "sara", name: "Sara", role: "FINANCE_MANAGER", roleLabel: "Approver" },
  ],
  currentUserId: "faizan",
};

const STORAGE_KEY = "ap-console-user";

export function loadUserId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || config.currentUserId;
  } catch {
    return config.currentUserId;
  }
}

export function saveUserId(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getUser(userId = loadUserId()) {
  return config.users.find((u) => u.id === userId) || config.users[0];
}

export function canProcess(user = getUser()) {
  return ["AP_PROCESSOR", "ADMIN"].includes(user.role);
}

export function canApprove(user = getUser()) {
  return ["AP_APPROVER", "FINANCE_MANAGER"].includes(user.role);
}
