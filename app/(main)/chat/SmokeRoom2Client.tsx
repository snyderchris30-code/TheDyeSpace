"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
  room: string;
}

type ProfileFlags = {
  id: string;
  role?: string | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
};

function profileIsShadowBanned(profile?: ProfileFlags | null) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

export default function SmokeRoom2Client({ allowed }: { allowed: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const nextUser = data.session?.user || null;
      setUser(nextUser);

      if (!nextUser) {
        setIsAdmin(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", nextUser.id)
        .maybeSingle();
      setIsAdmin(profile?.role === "admin");
    });
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!allowed) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("room", "smoke_room_2")
      .order("created_at", { ascending: true });

    if (error || !data) {
      setLoading(false);
      return;
    }

    const rows = data as ChatMessage[];
    if (isAdmin) {
      setMessages(rows);
      setLoading(false);
      return;
    }

    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) {
      setMessages(rows);
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,shadow_banned,shadow_banned_until")
      .in("id", userIds);

    const profileById = new Map<string, ProfileFlags>();
    (profiles || []).forEach((profile) => profileById.set(profile.id, profile as ProfileFlags));

    setMessages(
      rows.filter((msg) => {
        if (msg.user_id === user?.id) return true;
        return !profileIsShadowBanned(profileById.get(msg.user_id));
      })
    );
    setLoading(false);
  }, [allowed, isAdmin, user?.id]);

  useEffect(() => {
    if (!allowed) return;
    const supabase = createClient();
    let subscription: any;
    void fetchMessages();
    subscription = supabase
      .channel("public:chat_messages_2")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: "room=eq.smoke_room_2" },
        () => void fetchMessages()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: "room=eq.smoke_room_2" },
        () => void fetchMessages()
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: "room=eq.smoke_room_2" },
        () => void fetchMessages()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [allowed, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !user) return;
    const supabase = createClient();
    const text = input.trim();
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      user_id: user.id,
      username: user.user_metadata?.username || user.email,
      message: text,
      created_at: new Date().toISOString(),
      room: "smoke_room_2",
    };
    setMessages((msgs) => [...msgs, optimistic]);
    setInput("");
    const { data: inserted } = await supabase.from("chat_messages").insert({
      user_id: user.id,
      username: user.user_metadata?.username || user.email,
      message: text,
      room: "smoke_room_2",
    }).select().single();
    if (inserted) {
      setMessages((msgs) => msgs.map((m) => (m.id === optimistic.id ? (inserted as ChatMessage) : m)));
    }
  }

  const handleAdminAction = useCallback(
    async (
      targetUserId: string,
      action: "mute" | "shadow_ban" | "clear_shadow_ban" | "invite_smoke_room_2" | "revoke_smoke_room_2",
      durationHours?: number
    ) => {
      if (!user?.id || !isAdmin) return;
      setAdminActionStatus(null);
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetUserId, action, durationHours }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || "Admin action failed.");
        }
        setAdminActionStatus(body?.message || "Admin action applied.");
      } catch (error: any) {
        setAdminActionStatus(typeof error?.message === "string" ? error.message : "Admin action failed.");
      }
    },
    [isAdmin, user?.id]
  );

  if (!allowed) {
    return <div className="text-center text-rose-300 mt-10">You do not have access to The Smoke Room 2.0.</div>;
  }

  return (
    <div className="flex flex-col h-[70vh] max-w-2xl mx-auto mt-8 rounded-3xl border border-red-400 bg-slate-950/55 p-4 shadow-2xl backdrop-blur-xl cosmic-bg">
      <h2 className="glow-text text-2xl font-bold mb-2 text-red-200">The Smoke Room 2.0 (Private)</h2>
      {adminActionStatus ? (
        <div className="mb-2 rounded-lg border border-red-300/25 bg-red-900/25 px-2 py-1 text-xs text-red-100">{adminActionStatus}</div>
      ) : null}
      <div className="flex-1 overflow-y-auto mb-2 space-y-2 pr-2">
        {loading ? (
          <div className="text-red-200">Loading...</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-2 group bg-black/30 rounded-xl p-2 hover:bg-red-900/20 transition">
              <div className="flex-1">
                <span className="font-bold text-red-200">{msg.username}</span>
                <span className="ml-2 text-xs text-red-400">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <div className="text-red-100 whitespace-pre-line">{msg.message}</div>
              </div>
              {user && isAdmin && msg.user_id !== user.id ? (
                <details className="relative shrink-0">
                  <summary className="cursor-pointer text-xs text-violet-200 hover:underline">Admin</summary>
                  <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-violet-300/25 bg-slate-950/95 p-2 shadow-xl">
                    <button
                      type="button"
                      className="mb-1 w-full rounded-lg border border-fuchsia-300/30 bg-fuchsia-500/10 px-2 py-1 text-left text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/15"
                      onClick={() => void handleAdminAction(msg.user_id, "mute", 4)}
                    >
                      Mute 4h
                    </button>
                    <button
                      type="button"
                      className="mb-1 w-full rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1 text-left text-[11px] text-rose-100 hover:bg-rose-500/15"
                      onClick={() => void handleAdminAction(msg.user_id, "shadow_ban")}
                    >
                      Shadow Ban
                    </button>
                    <button
                      type="button"
                      className="mb-1 w-full rounded-lg border border-teal-300/30 bg-teal-500/10 px-2 py-1 text-left text-[11px] text-teal-100 hover:bg-teal-500/15"
                      onClick={() => void handleAdminAction(msg.user_id, "clear_shadow_ban")}
                    >
                      Remove Shadow Ban
                    </button>
                    <button
                      type="button"
                      className="mb-1 w-full rounded-lg border border-red-300/30 bg-red-500/10 px-2 py-1 text-left text-[11px] text-red-100 hover:bg-red-500/15"
                      onClick={() => void handleAdminAction(msg.user_id, "invite_smoke_room_2")}
                    >
                      Invite to 2.0
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-slate-300/30 bg-slate-500/10 px-2 py-1 text-left text-[11px] text-slate-100 hover:bg-slate-500/15"
                      onClick={() => void handleAdminAction(msg.user_id, "revoke_smoke_room_2")}
                    >
                      Revoke 2.0 Invite
                    </button>
                  </div>
                </details>
              ) : null}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      {user ? (
        <form onSubmit={sendMessage} className="flex gap-2 mt-2">
          <input
            className="flex-1 rounded-xl border border-red-300/30 bg-black/40 px-3 py-2 text-red-100 focus:outline-none focus:ring-2 focus:ring-red-400"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            maxLength={500}
            required
          />
          <button
            type="submit"
            className="rounded-xl bg-gradient-to-br from-red-400 to-pink-400 px-4 py-2 font-bold text-white shadow-md hover:from-red-300 hover:to-pink-300 transition"
          >
            Send
          </button>
        </form>
      ) : (
        <div className="text-red-200 mt-2">Log in to chat.</div>
      )}
    </div>
  );
}
