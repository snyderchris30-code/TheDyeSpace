export const APP_VERSION = "v0.1.5";

export const INVITE_EXPIRATION_DEFAULT_HOURS = 12;
export const INVITE_EXPIRATION_OPTIONS_HOURS = [1, 12, 24, 168] as const;

export function formatInviteDurationLabel(hours: number) {
  if (hours === 1) return "1 hour";
  if (hours === 168) return "7 days";
  return `${hours} hours`;
}
