import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import FanChatRoomClient from "./FanChatRoomClient";

type Props = {
  params: {
    username: string;
  };
};

export default async function FanChatPage({ params: { username } }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: profileData } = await supabase
    .from("profiles")
    .select("id,username,display_name,verified_badge,member_number")
    .eq("username", username)
    .limit(1)
    .maybeSingle();

  if (!profileData || !profileData.verified_badge) {
    return notFound();
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData?.session?.user?.id ?? null;
  const isSeller = currentUserId === profileData.id;
  let allowed = false;

  if (isSeller) {
    allowed = true;
  } else if (currentUserId) {
    const { data: followData } = await supabase
      .from("user_follows")
      .select("follower_id")
      .eq("follower_id", currentUserId)
      .eq("followed_id", profileData.id)
      .limit(1);
    allowed = Array.isArray(followData) && followData.length > 0;
  }

  const room = `fan_chat_${profileData.id}`;
  const sellerName = profileData.display_name || profileData.username || "Verified Seller";

  return (
    <div className="min-h-[70vh] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/90 p-6 shadow-2xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-cyan-300/70">Fan Chat</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">{sellerName}'s Fan Chat</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                This is a private fan chat for the verified seller and their followers. Join the conversation, ask questions, and stay connected.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/profile/${encodeURIComponent(username)}`}
                className="rounded-2xl border border-slate-600 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                Back to Profile
              </Link>
              <Link
                href={`/profile/${encodeURIComponent(username)}/shop`}
                className="rounded-2xl border border-cyan-300/60 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                View Shop
              </Link>
            </div>
          </div>
        </div>
        <FanChatRoomClient
          room={room}
          allowed={allowed}
          sellerDisplayName={sellerName}
          sellerUsername={profileData.username}
        />
      </div>
    </div>
  );
}
