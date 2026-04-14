type SubmitModerationReportInput = {
  type: "post" | "comment" | "user";
  targetId: string;
  reason: string;
};

export async function submitModerationReport(input: SubmitModerationReportInput) {
  const response = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to submit report.");
  }

  return body as { ok?: boolean };
}