import { createClient as createServiceClient } from "@supabase/supabase-js";

export type AdminProfileStatus = {
  id: string;
  role?: string | null;
  muted_until?: string | null;
  voided_until?: string | null;
  blessed_until?: string | null;
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
    .select("id,role,muted_until,voided_until,blessed_until")
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

export function isBlessed(profile?: Pick<AdminProfileStatus, "blessed_until"> | null) {
  if (!profile?.blessed_until) return false;
  const until = new Date(profile.blessed_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

export function formatExpiration(expiration?: string | null) {
  if (!expiration) return null;
  const date = new Date(expiration);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}
