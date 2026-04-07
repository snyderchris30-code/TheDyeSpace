"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import AsyncStateCard from "@/app/AsyncStateCard";
import AdminActionMenu from "@/app/AdminActionMenu";
import UserIdentity from "@/app/UserIdentity";
import { runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
  room?: string | null;
  author?: ProfileFlags | null;
}

type ProfileFlags = {
  id: string;
  role?: string | null;
  smoke_room_2_invited?: boolean | null;
  username?: string | null;
  display_name?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
};

const MAIN_ROOM = "smoke_room";

function profileIsShadowBanned(profile?: ProfileFlags | null) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

export default function GlobalChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [canAccessRoom2, setCanAccessRoom2] = useState(false);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ProfileFlags | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const nextUser = data.session?.user || null;
      setUser(nextUser);

      if (!nextUser) {
        setIsAdmin(false);
        setCanAccessRoom2(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id,role,smoke_room_2_invited,username,display_name,verified_badge,member_number")
        .eq("id", nextUser.id)
        .maybeSingle();

      const admin = profile?.role === "admin";
      setIsAdmin(admin);
      setCanAccessRoom2(admin || profile?.smoke_room_2_invited === true);
      setViewerProfile((profile as ProfileFlags) ?? null);
    });
  }, []);

  const fetchMessages = useCallback(async () => {
    const supabase = createClient();
    setError(null);
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .or("room.eq.smoke_room,room.is.null")
      .order("created_at", { ascending: true });

    if (error || !data) {
      setMessages([]);
      setError("Couldn\'t load Dye Chat right now. Please try again.");
      setLoading(false);
      return;
    }

    const rows = data as ChatMessage[];

    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) {
      setMessages(rows);
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,username,display_name,verified_badge,member_number,shadow_banned,shadow_banned_until")
      .in("id", userIds);

    const profileById = new Map<string, ProfileFlags>();
    (profiles || []).forEach((profile) => profileById.set(profile.id, profile as ProfileFlags));

    const visibleRows = isAdmin ? rows : rows.filter((msg) => {
        if (msg.user_id === user?.id) return true;
        return !profileIsShadowBanned(profileById.get(msg.user_id));
      });

    setMessages(visibleRows.map((msg) => ({ ...msg, author: profileById.get(msg.user_id) ?? null })));

    setLoading(false);
  }, [isAdmin, user?.id]);

  useEffect(() => {
    let subscription: any;
    const supabase = createClient();
    void fetchMessages();
    subscription = supabase
      .channel("public:chat_messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const next = payload.new as ChatMessage;
          if (next.room && next.room !== MAIN_ROOM) return;
          void fetchMessages();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages" },
        (payload) => {
          const next = payload.new as ChatMessage;
          if (next.room && next.room !== MAIN_ROOM) return;
          void fetchMessages();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages" },
        () => {
          void fetchMessages();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [fetchMessages]);

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
      room: MAIN_ROOM,
      author: viewerProfile,
    };
    setMessages((msgs) => [...msgs, optimistic]);
    setInput("");
    const { data: inserted } = await supabase.from("chat_messages").insert({
      user_id: user.id,
      username: user.user_metadata?.username || user.email,
      message: text,
      room: MAIN_ROOM,
    }).select().single();
    if (inserted) {
      setMessages((msgs) => msgs.map((m) => (m.id === optimistic.id ? (inserted as ChatMessage) : m)));
    }
  }

  const startEdit = useCallback((msg: ChatMessage) => {
    setEditingId(msg.id);
    setEditText(msg.message);
  }, []);

  const saveEdit = useCallback(async (msgId: string) => {
    if (!editText.trim()) return;
    const supabase = createClient();
    await supabase
      .from("chat_messages")
      .update({ message: editText.trim() })
      .eq("id", msgId)
      .eq("user_id", user.id);
    setEditingId(null);
    setEditText("");
  }, [editText, user]);

  const deleteMessage = useCallback(async (msgId: string) => {
    if (!confirm("Delete this message?")) return;
    const supabase = createClient();
    await supabase.from("chat_messages").delete().eq("id", msgId).eq("user_id", user.id);
  }, [user]);

  async function reportMessage(msg: ChatMessage) {
    if (!user?.id) return;
    const reason = prompt("Reason for reporting this message?");
    if (!reason) return;
    const supabase = createClient();
    await supabase.from("reports").insert({
      type: "chat_message",
      reported_id: msg.id,
      reported_by: user.id,
      reporter_id: user.id,
      reason,
      created_at: new Date().toISOString(),
    });
    alert("Message reported. Thank you!");
  }

  const handleAdminAction = useCallback(
    async (
      targetUserId: string,
      action: AdminActionName,
      durationHours?: number
    ) => {
      if (!user?.id || !isAdmin) return;
      setAdminActionStatus(null);
      try {
        const body = await runAdminUserAction({ targetUserId, action, durationHours });
        setAdminActionStatus(body?.message || "Admin action applied.");
        await fetchMessages();
      } catch (error: any) {
        setAdminActionStatus(typeof error?.message === "string" ? error.message : "Admin action failed.");
      }
    },
    [fetchMessages, isAdmin, user?.id]
  );

  return (
    <div className="flex flex-col h-[70vh] max-w-2xl mx-auto mt-8 rounded-3xl border border-cyan-300/25 bg-slate-950/55 p-4 shadow-2xl backdrop-blur-xl cosmic-bg">
      <h2 className="glow-text text-2xl font-bold mb-2 text-cyan-100">The Dye Chat (Global Chat)</h2>
      {canAccessRoom2 ? (
        <a
          href="/chat/smoke-room-2"
          className="mb-2 inline-flex w-fit items-center rounded-full border border-red-300/40 bg-red-900/30 px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-900/45"
        >
          Enter Dye Chat 2.0
        </a>
      ) : null}
      {adminActionStatus ? (
        <div className="mb-2 rounded-lg border border-cyan-300/25 bg-cyan-900/25 px-2 py-1 text-xs text-cyan-100">{adminActionStatus}</div>
      ) : null}
      <div className="flex-1 overflow-y-auto mb-2 space-y-2 pr-2">
        {loading ? (
          <AsyncStateCard
            compact
            loading
            title="Loading Dye Chat"
            message="Pulling in the latest messages from the global room."
          />
        ) : error ? (
          <AsyncStateCard
            compact
            tone="error"
            title="Couldn\'t load Dye Chat"
            message={error}
            actionLabel="Retry chat"
            onAction={() => {
              setLoading(true);
              void fetchMessages();
            }}
          />
        ) : messages.length === 0 ? (
          <div className="rounded-2xl border border-cyan-300/20 bg-black/25 p-4 text-sm text-cyan-100/75">
            No messages yet. Start the conversation.
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-2 group bg-black/30 rounded-xl p-2 hover:bg-cyan-900/20 transition">
              <div className="flex-1">
                <UserIdentity
                  displayName={msg.author?.display_name || msg.author?.username || msg.username}
                  username={msg.author?.username ?? null}
                  verifiedBadge={msg.author?.verified_badge}
                  memberNumber={msg.author?.member_number}
                  timestampText={new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  className="mb-1"
                  nameClassName="font-bold text-cyan-200 hover:text-cyan-100"
                  usernameClassName="text-xs text-cyan-300/80 hover:text-cyan-100 hover:underline"
                  metaClassName="text-xs text-cyan-400"
                />
                {editingId === msg.id ? (
                  <div className="mt-1 flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-cyan-300/30 bg-black/40 px-2 py-1 text-cyan-100 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"
                      title="Edit your chat message"
                      placeholder="Edit your message"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={500}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEdit(msg.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <button onClick={() => void saveEdit(msg.id)} className="rounded-lg bg-cyan-500/80 px-2 py-1 text-xs text-white hover:bg-cyan-400 transition">Save</button>
                    <button onClick={() => setEditingId(null)} className="rounded-lg bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600 transition">Cancel</button>
                  </div>
                ) : (
                  <div className="text-cyan-100 whitespace-pre-line">{msg.message}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-2 opacity-0 group-hover:opacity-100 transition">
                {user && msg.user_id === user.id ? (
                  <>
                    <button
                      className="text-xs text-cyan-400 hover:underline"
                      onClick={() => startEdit(msg)}
                      title="Edit message"
                    >
                      Edit
                    </button>
                    <button
                      className="text-xs text-rose-400 hover:underline"
                      onClick={() => void deleteMessage(msg.id)}
                      title="Delete message"
                    >
                      Delete
                    </button>
                  </>
                ) : user && isAdmin ? (
                  <AdminActionMenu targetUserId={msg.user_id} onAction={handleAdminAction} />
                ) : user ? (
                  <button
                    className="text-xs text-pink-400 hover:underline"
                    onClick={() => reportMessage(msg)}
                    title="Report message"
                  >
                    Report
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      {user ? (
        <form onSubmit={sendMessage} className="flex gap-2 mt-2">
          <input
            className="flex-1 rounded-xl border border-cyan-300/30 bg-black/40 px-3 py-2 text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            maxLength={500}
            required
          />
          <button
            type="submit"
            className="rounded-xl bg-gradient-to-br from-cyan-400 to-pink-400 px-4 py-2 font-bold text-white shadow-md hover:from-cyan-300 hover:to-pink-300 transition"
          >
            Send
          </button>
        </form>
      ) : (
        <div className="text-cyan-200 mt-2">Log in to chat.</div>
      )}
    </div>
  );
}
