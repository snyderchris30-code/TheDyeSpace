"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ChatMessage {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
}

export default function GlobalChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
    });
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let subscription: any;
    async function fetchMessages() {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: true });
      if (!error && data) setMessages(data);
      setLoading(false);
    }
    fetchMessages();
    subscription = supabase
      .channel("public:chat_messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          setMessages((msgs) => {
            if (msgs.some((m) => m.id === (payload.new as ChatMessage).id)) return msgs;
            return [...msgs, payload.new as ChatMessage];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages" },
        (payload) => {
          setMessages((msgs) =>
            msgs.map((m) => (m.id === (payload.new as ChatMessage).id ? (payload.new as ChatMessage) : m))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages" },
        (payload) => {
          setMessages((msgs) => msgs.filter((m) => m.id !== (payload.old as { id: string }).id));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

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
    };
    setMessages((msgs) => [...msgs, optimistic]);
    setInput("");
    const { data: inserted } = await supabase.from("chat_messages").insert({
      user_id: user.id,
      username: user.user_metadata?.username || user.email,
      message: text,
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

  return (
    <div className="flex flex-col h-[70vh] max-w-2xl mx-auto mt-8 rounded-3xl border border-cyan-300/25 bg-slate-950/55 p-4 shadow-2xl backdrop-blur-xl cosmic-bg">
      <h2 className="glow-text text-2xl font-bold mb-2 text-cyan-100">Smoke Lounge (Global Chat)</h2>
      <div className="flex-1 overflow-y-auto mb-2 space-y-2 pr-2">
        {loading ? (
          <div className="text-cyan-200">Loading...</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-2 group bg-black/30 rounded-xl p-2 hover:bg-cyan-900/20 transition">
              <div className="flex-1">
                <span className="font-bold text-cyan-200">{msg.username}</span>
                <span className="ml-2 text-xs text-cyan-400">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {editingId === msg.id ? (
                  <div className="mt-1 flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-cyan-300/30 bg-black/40 px-2 py-1 text-cyan-100 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"
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
