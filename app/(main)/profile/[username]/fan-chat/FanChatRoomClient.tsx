"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import UserIdentity from "@/app/UserIdentity";

interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
  room: string;
  author?: ProfileFlags | null;
}

type ProfileFlags = {
  id: string;
  role?: string | null;
  username?: string | null;
  display_name?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
};

type FanChatRoomClientProps = {
  room: string;
  allowed: boolean;
  sellerDisplayName: string;
  sellerUsername: string | null;
};

function formatTimestamp(createdAt: string) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return createdAt;
  return timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function FanChatRoomClient({ room, allowed, sellerDisplayName, sellerUsername }: FanChatRoomClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ProfileFlags | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("room", room)
      .order("created_at", { ascending: true });

    if (error || !data) {
      setMessages([]);
      setError("Could not load chat messages right now. Please try again later.");
      setLoading(false);
      return;
    }

    setError(null);
    const rows = data as ChatMessage[];
    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];

    if (!userIds.length) {
      setMessages(rows);
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id,username,display_name,verified_badge,member_number")
      .in("id", userIds);

    const profileById = new Map<string, ProfileFlags>();
    (profiles || []).forEach((profile) => {
      if (profile && typeof profile.id === "string") {
        profileById.set(profile.id, profile as ProfileFlags);
      }
    });

    setMessages(rows.map((msg) => ({ ...msg, author: profileById.get(msg.user_id) ?? null })));
    setLoading(false);
  }, [allowed, room]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user ?? null);
    });
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const supabase = createClient();
    let subscription: any;
    const timer = setTimeout(() => {
      void fetchMessages();
    }, 0);

    subscription = supabase
      .channel(`public:chat_messages_${room}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room=eq.${room}` },
        () => void fetchMessages()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `room=eq.${room}` },
        () => void fetchMessages()
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: `room=eq.${room}` },
        () => void fetchMessages()
      )
      .subscribe();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(subscription);
    };
  }, [allowed, fetchMessages, room]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!input.trim() || !user) return;
      const supabase = createClient();
      const text = input.trim();
      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        user_id: user.id,
        username: user.user_metadata?.username || user.email || "Anonymous",
        message: text,
        created_at: new Date().toISOString(),
        room,
        author: viewerProfile,
      };
      setMessages((prev) => [...prev, optimistic]);
      setInput("");

      const { data: inserted, error } = await supabase.from("chat_messages").insert({
        user_id: user.id,
        username: user.user_metadata?.username || user.email || "Anonymous",
        message: text,
        room,
      }).select().single();

      if (error) {
        setError("Could not send message. Please try again.");
        return;
      }

      if (inserted) {
        setMessages((prev) => prev.map((msg) => (msg.id === optimistic.id ? (inserted as ChatMessage) : msg)));
      }
    },
    [input, room, user, viewerProfile]
  );

  if (!allowed) {
    return (
      <div className="rounded-3xl border border-rose-300/20 bg-black/40 p-8 text-center text-slate-100 shadow-lg">
        <MessageCircle className="mx-auto mb-4 h-12 w-12 text-pink-400" />
        <h1 className="text-2xl font-semibold text-white">Fan Chat Access Restricted</h1>
        <p className="mt-3 text-sm text-slate-300">
          Only the verified seller and users who follow them may join this private fan chat.
        </p>
        <Link href="/" className="mt-6 inline-flex rounded-full bg-cyan-500/15 px-5 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25 transition">
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/85 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-4 flex items-center gap-3 rounded-3xl border border-cyan-300/15 bg-black/30 px-4 py-4">
        <MessageCircle className="h-6 w-6 text-cyan-300" />
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-cyan-400/80">Fan Chat Room</p>
          <p className="text-lg font-semibold text-cyan-100">{sellerDisplayName || sellerUsername || "Verified Seller"}&apos;s private room</p>
        </div>
      </div>

      <div className="mb-4 max-h-[60vh] overflow-y-auto rounded-[1.75rem] border border-cyan-300/10 bg-black/40 p-4">
        {loading ? (
          <div className="rounded-3xl border border-cyan-300/10 bg-slate-900/60 p-6 text-center text-cyan-100/75">Loading chat messages...</div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-300/15 bg-rose-950/40 p-6 text-center text-rose-100">{error}</div>
        ) : messages.length === 0 ? (
          <div className="rounded-3xl border border-cyan-300/10 bg-slate-900/60 p-6 text-center text-cyan-100/75">No messages yet. Start the conversation.</div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className="rounded-3xl border border-cyan-300/10 bg-slate-900/70 p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <UserIdentity
                    displayName={msg.author?.display_name || msg.author?.username || msg.username}
                    username={msg.author?.username ?? null}
                    verifiedBadge={msg.author?.verified_badge}
                    memberNumber={msg.author?.member_number}
                    className="min-w-0"
                    nameClassName="text-sm font-semibold text-cyan-100"
                    usernameClassName="text-[11px] text-cyan-300/80"
                    metaClassName="text-[11px] text-cyan-400"
                  />
                  <span className="text-[11px] text-cyan-300/70">{formatTimestamp(msg.created_at)}</span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-cyan-100">{msg.message}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={sendMessage} className="flex flex-col gap-3">
        <label className="sr-only" htmlFor="fan-chat-input">Write a message</label>
        <textarea
          id="fan-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Write a message to the seller..."
          className="min-h-[96px] w-full resize-none rounded-[1.5rem] border border-cyan-300/15 bg-slate-950/80 px-4 py-3 text-sm text-cyan-100 outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/20"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-cyan-300/70">Only followers and the seller are allowed in this room.</span>
          <button
            type="submit"
            className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
