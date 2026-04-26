let inFlightEnsureRequest: Promise<void> | null = null;
let lastSuccessAt = 0;
const SUCCESS_TTL_MS = 60_000;

export async function ensureProfileBucketsReady() {
  const now = Date.now();
  if (now - lastSuccessAt < SUCCESS_TTL_MS) {
    return;
  }

  if (!inFlightEnsureRequest) {
    inFlightEnsureRequest = (async () => {
      const response = await fetch("/api/storage/profile-buckets", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || "Storage is not ready for uploads right now.");
      }
      lastSuccessAt = Date.now();
    })().finally(() => {
      inFlightEnsureRequest = null;
    });
  }

  return inFlightEnsureRequest;
}
