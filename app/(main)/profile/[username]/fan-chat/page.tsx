"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import FanChatRoomClient from "./FanChatRoomClient";
import { fetchProfileLookupByUsername, type ProfileLookupResponse } from "@/lib/profile-fetch";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";

const fanChatProfileLoadPromises = new Map<string, Promise<ProfileLookupResponse<FanChatProfile>>>();

type FanChatProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  verified_badge?: boolean;
  seller_background_url?: string;
};

function resolveParamUsername(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return decodeURIComponent(raw || "").trim().replace(/^@+/, "");
}

export default function FanChatPage() {
  const params = useParams<{ username?: string | string[] }>();
  const username = resolveParamUsername(params?.username);
  const [profile, setProfile] = useState<FanChatProfile | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.style.removeProperty("--seller-background-image");
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadKey = username || "";

    async function loadFanChat() {
      try {
        if (!username) {
          if (active) {
            setProfile(null);
            setAllowed(false);
            setLoading(false);
          }
          return;
        }

        setLoading(true);

        let profilePromise = fanChatProfileLoadPromises.get(loadKey);
        if (!profilePromise) {
          profilePromise = fetchProfileLookupByUsername<FanChatProfile>(username, controller.signal);
          fanChatProfileLoadPromises.set(loadKey, profilePromise);
          profilePromise.finally(() => {
            if (fanChatProfileLoadPromises.get(loadKey) === profilePromise) {
              fanChatProfileLoadPromises.delete(loadKey);
            }
          });
        }

        const lookup = await profilePromise;

        if (!active || controller.signal.aborted) {
          return;
        }

        const resolvedProfile = lookup.profile ?? null;
        setProfile(resolvedProfile);

        if (!resolvedProfile) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        const supabase = createClient();
        const { user } = await resolveClientAuth(supabase);
        const currentUserId = user?.id ?? null;

        if (!active || controller.signal.aborted) {
          return;
        }

        if (!currentUserId) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        if (currentUserId === resolvedProfile.id) {
          setAllowed(true);
          setLoading(false);
          return;
        }

        const viewerProfile = await fetchClientProfile<{ role?: string | null }>(
          supabase,
          currentUserId,
          "role",
          { ensureProfile: true }
        );

        if (active && !controller.signal.aborted) {
          setAllowed(viewerProfile?.role === "admin" || Boolean(currentUserId));
          setLoading(false);
        }
      } catch (error: any) {
        if (controller.signal.aborted || error?.name === "AbortError") {
          return;
        }

        if (active) {
          setAllowed(false);
          setLoading(false);
        }
      }
    }

    void loadFanChat();

    return () => {
      active = false;
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
  }, [username]);

  const sellerName = profile?.username || username || profile?.display_name || "Seller";
  const room = profile?.id ? `fan_chat_${profile.id}` : "fan_chat_pending";
  const profileHref = username ? `/profile/${encodeURIComponent(username)}` : "/profile";
  const shopHref = username ? `/profile/${encodeURIComponent(username)}/shop` : "/profile";
  const sellerUsername = profile?.username || username || null;

  return (
    <div className="min-h-[70vh] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/90 p-6 shadow-2xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-cyan-300/70">Fan Chat</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">{sellerName}&apos;s Fan Chat</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">Private fan chat.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={profileHref}
                className="rounded-2xl border border-slate-600 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                Back to Profile
              </Link>
              <Link
                href={shopHref}
                className="rounded-2xl border border-cyan-300/60 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                View Shop
              </Link>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-[1.75rem] border border-cyan-300/15 bg-slate-950/80 p-8 text-center text-slate-300 shadow-xl">
            Loading fan chat...
          </div>
        ) : (
          <FanChatRoomClient
            room={room}
            allowed={allowed}
            sellerDisplayName={sellerName}
            sellerUsername={sellerUsername}
          />
        )}
      </div>
    </div>
  );
}
