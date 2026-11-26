const STORAGE_KEY = "ap-console-upload-session";

export function saveUploadSession(session) {
  try {
    if (!session?.caseId) {
      clearUploadSession();
      return;
    }
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        caseId: session.caseId,
        fileName: session.fileName || "",
        steps: session.steps || [],
        confidence: session.confidence || null,
        phase: session.phase || "complete",
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadUploadSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.caseId) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearUploadSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
