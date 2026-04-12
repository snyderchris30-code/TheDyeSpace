import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ADMIN_USER_UID } from "@/lib/admin-actions";

export type AdminProfileStatus = {
  id: string;
  role?: string | null;
  muted_until?: string | null;
  voided_until?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
  smoke_room_2_invited?: boolean | null;
  psychonautics_access?: boolean | null;
  admin_room_access?: boolean | null;
};

export function createAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }

  return createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function userIsAdmin(adminClient: ReturnType<typeof createAdminClient>, userId: string) {
  if (userId === ADMIN_USER_UID) {
    return true;
  }

  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return profile?.role === "admin";
}

export async function loadProfileStatus(adminClient: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id,role,muted_until,voided_until,verified_badge,member_number,shadow_banned,shadow_banned_until,smoke_room_2_invited,psychonautics_access,admin_room_access")
    .eq("id", userId)
    .limit(1)
    .maybeSingle<AdminProfileStatus>();

  if (error) {
    throw error;
  }

  return data;
}

export function isMuted(profile?: Pick<AdminProfileStatus, "muted_until"> | null) {
  if (!profile?.muted_until) return false;
  const until = new Date(profile.muted_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

export function isVoided(profile?: Pick<AdminProfileStatus, "voided_until"> | null) {
  if (!profile?.voided_until) return false;
  const until = new Date(profile.voided_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

export function hasVerifiedBadge(profile?: Pick<AdminProfileStatus, "verified_badge"> | null) {
  return profile?.verified_badge === true;
}

export function isShadowBanned(profile?: Pick<AdminProfileStatus, "shadow_banned" | "shadow_banned_until"> | null) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

export function formatExpiration(expiration?: string | null) {
  if (!expiration) return null;
  const date = new Date(expiration);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}
