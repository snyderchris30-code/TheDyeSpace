"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
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
          setMessages((msgs) => [...msgs, payload.new as ChatMessage]);
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
    await supabase.from("chat_messages").insert({
      user_id: user.id,
      username: user.user_metadata?.username || user.email,
      message: input.trim(),
    });
    setInput("");
  }

  async function reportMessage(msg: ChatMessage) {
    const reason = prompt("Reason for reporting this message?");
    if (!reason) return;
    const supabase = createClient();
    await supabase.from("reports").insert({
      type: "chat_message",
      reported_id: msg.id,
      reported_by: user.id,
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
                <div className="text-cyan-100 whitespace-pre-line">{msg.message}</div>
              </div>
              <button
                className="ml-2 text-xs text-pink-400 hover:underline opacity-0 group-hover:opacity-100 transition"
                onClick={() => reportMessage(msg)}
                title="Report message"
              >
                Report
              </button>
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
