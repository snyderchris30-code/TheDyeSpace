export function formatMemberNumber(value?: number | null) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }

  return `#${String(value).padStart(4, "0")}`;
}