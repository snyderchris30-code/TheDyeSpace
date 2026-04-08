export type AdminActionName =
  | "mute"
  | "cosmic_timeout"
  | "send_to_void"
  | "shadow_ban"
  | "clear_shadow_ban"
  | "give_verified_badge"
  | "remove_verified_badge"
  | "invite_smoke_room_2"
  | "revoke_smoke_room_2";

export type AdminActionRequest = {
  targetUserId: string;
  action: AdminActionName;
  durationHours?: number;
};

export type AdminActionMenuItem = {
  label: string;
  action: AdminActionName;
  durationHours?: number;
  tone: "pink" | "cyan" | "emerald" | "rose" | "teal" | "amber" | "slate";
};

export const ADMIN_USER_UID = "794077c7-ad51-47cc-8c25-20171edfb017";

export function hasAdminAccess(userId?: string | null, role?: string | null) {
  return userId === ADMIN_USER_UID || role === "admin";
}

export const ADMIN_ACTION_MENU_ITEMS: AdminActionMenuItem[] = [
  { label: "Mute 4h", action: "mute", durationHours: 4, tone: "pink" },
  { label: "Mute 8h", action: "mute", durationHours: 8, tone: "pink" },
  { label: "Mute 12h", action: "mute", durationHours: 12, tone: "pink" },
  { label: "Cosmic Timeout 4h", action: "cosmic_timeout", durationHours: 4, tone: "cyan" },
  { label: "Send to the Void (24h)", action: "send_to_void", tone: "emerald" },
  { label: "Shadow Ban 4h", action: "shadow_ban", durationHours: 4, tone: "rose" },
  { label: "Shadow Ban 8h", action: "shadow_ban", durationHours: 8, tone: "rose" },
  { label: "Shadow Ban 12h", action: "shadow_ban", durationHours: 12, tone: "rose" },
  { label: "Shadow Ban 24h", action: "shadow_ban", durationHours: 24, tone: "rose" },
  { label: "Remove Shadow Ban", action: "clear_shadow_ban", tone: "teal" },
  { label: "Give Verified Badge", action: "give_verified_badge", tone: "amber" },
  { label: "Remove Verified Badge", action: "remove_verified_badge", tone: "slate" },
  { label: "Invite to The Smoke Room 2.0", action: "invite_smoke_room_2", tone: "emerald" },
  { label: "Revoke 2.0 Invite", action: "revoke_smoke_room_2", tone: "slate" },
];

export async function runAdminUserAction(payload: AdminActionRequest) {
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Admin action failed.");
  }

  return body as {
    success?: boolean;
    message?: string;
    action?: AdminActionName;
    updates?: Record<string, string | boolean | null>;
  };
}