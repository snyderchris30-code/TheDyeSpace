"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Mic, Users as UsersIcon } from "lucide-react";
import AsyncStateCard from "@/app/AsyncStateCard";
import AdminActionMenu from "@/app/AdminActionMenu";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import { createClient } from "@/lib/supabase/client";
import { canAccessSmokeLounge } from "@/lib/verified-seller";
import { canAccessPrivateRoom, type PrivateRoomAccessProfile } from "@/lib/private-rooms";

type ChatRoomId = "smoke_room" | "smoke_room_2" | "psychonautics" | "admin_room";
type ChatPanel = { kind: "text"; roomId: ChatRoomId } | { kind: "voice" };

type RoomDefinition = {
  id: ChatRoomId;
  name: string;
  subtitle: string;
  dotClassName: string;
  bubbleClassName: string;
  sidebarGlowClassName: string;
};

type ProfileFlags = {
  id: string;
  role?: string | null;
  smoke_room_2_invited?: boolean | null;
  psychonautics_access?: boolean | null;
  admin_room_access?: boolean | null;
  username?: string | null;
  display_name?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
  avatar_url?: string | null;
};

type ChatMessage = {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
  room?: string | null;
  author?: ProfileFlags | null;
};

type VoiceParticipant = {
  userId: string;
  displayName: string;
  joinedAt: string;
};

type VerifiedSellerChat = {
  id: string;
  username: string | null;
  display_name: string | null;
  ghost_ridin?: boolean | null;
};

const VOICE_LIMIT = 6;
const PHOTO_TOKEN_REGEX = /\[photo:(https?:\/\/[^\]\s]+)\]/gi;

const ROOM_DEFINITIONS: RoomDefinition[] = [
  {
    id: "smoke_room",
    name: "The Dye Chat",
    subtitle: "Global community",
    dotClassName: "bg-cyan-300",
    bubbleClassName: "from-cyan-500/20 to-teal-500/10",
    sidebarGlowClassName: "group-hover:shadow-[0_0_0_1px_rgba(34,211,238,0.45),0_0_26px_rgba(34,211,238,0.18)]",
  },
  {
    id: "smoke_room_2",
    name: "Smoke Room 2.0",
    subtitle: "Verified sellers lounge",
    dotClassName: "bg-rose-300",
    bubbleClassName: "from-rose-500/20 to-fuchsia-500/10",
    sidebarGlowClassName: "group-hover:shadow-[0_0_0_1px_rgba(251,113,133,0.45),0_0_26px_rgba(251,113,133,0.18)]",
  },
  {
    id: "psychonautics",
    name: "Psychonautics Society",
    subtitle: "Invite-only discussion",
    dotClassName: "bg-emerald-300",
    bubbleClassName: "from-emerald-500/20 to-cyan-500/10",
    sidebarGlowClassName: "group-hover:shadow-[0_0_0_1px_rgba(110,231,183,0.45),0_0_26px_rgba(16,185,129,0.18)]",
  },
  {
    id: "admin_room",
    name: "Admins Room",
    subtitle: "Admin operations",
    dotClassName: "bg-amber-300",
    bubbleClassName: "from-amber-500/20 to-orange-500/10",
    sidebarGlowClassName: "group-hover:shadow-[0_0_0_1px_rgba(252,211,77,0.45),0_0_26px_rgba(251,146,60,0.18)]",
  },
];

function normalizeMessageRoom(room: string | null | undefined): ChatRoomId {
  if (!room || room === "smoke_room") return "smoke_room";
  if (room === "smoke_room_2") return "smoke_room_2";
  if (room === "psychonautics") return "psychonautics";
  if (room === "admin_room") return "admin_room";
  return "smoke_room";
}

function profileIsShadowBanned(profile?: ProfileFlags | null) {
  if (!profile) return false;
  if (profile.shadow_banned) return true;
  if (!profile.shadow_banned_until) return false;
  const until = new Date(profile.shadow_banned_until);
  return !Number.isNaN(until.getTime()) && until > new Date();
}

function getAvatarInitials(message: ChatMessage) {
  const source = (message.author?.display_name || message.author?.username || message.username || "DyeSpace User").trim();
  const tokens = source.split(/\s+/).filter(Boolean).slice(0, 2);
  if (!tokens.length) return "DS";
  return tokens.map((token) => token[0]?.toUpperCase() || "").join("");
}

function extractPhotoUrls(message: string | null | undefined) {
  if (!message) return [] as string[];
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(PHOTO_TOKEN_REGEX.source, "gi");
  do {
    match = regex.exec(message);
    if (match?.[1]) {
      urls.push(match[1]);
    }
  } while (match);
  return urls;
}

function stripPhotoTokens(message: string | null | undefined) {
  if (!message) return "";
  return message.replace(PHOTO_TOKEN_REGEX, "").trim();
}

export default function GlobalChatClient() {
  const [messagesByRoom, setMessagesByRoom] = useState<Record<ChatRoomId, ChatMessage[]>>({
    smoke_room: [],
    smoke_room_2: [],
    psychonautics: [],
    admin_room: [],
  });
  const [unreadByRoom, setUnreadByRoom] = useState<Record<ChatRoomId, number>>({
    smoke_room: 0,
    smoke_room_2: 0,
    psychonautics: 0,
    admin_room: 0,
  });
  const [input, setInput] = useState("");
  const [pendingPhotoUrls, setPendingPhotoUrls] = useState<string[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [viewerProfile, setViewerProfile] = useState<ProfileFlags | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activePanel, setActivePanel] = useState<ChatPanel>({ kind: "text", roomId: "smoke_room" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminActionStatus, setAdminActionStatus] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [verifiedSellerChats, setVerifiedSellerChats] = useState<VerifiedSellerChat[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceChannelRef = useRef<any>(null);

  const roomAccess = useMemo(() => {
    if (!viewerProfile) {
      return {
        smoke_room: true,
        smoke_room_2: false,
        psychonautics: false,
        admin_room: false,
      };
    }

    const privateProfile: PrivateRoomAccessProfile = {
      role: viewerProfile.role ?? null,
      psychonautics_access: viewerProfile.psychonautics_access ?? null,
      admin_room_access: viewerProfile.admin_room_access ?? null,
    };

    return {
      smoke_room: true,
      smoke_room_2: canAccessSmokeLounge(viewerProfile),
      psychonautics: canAccessPrivateRoom(privateProfile, "psychonautics"),
      admin_room: canAccessPrivateRoom(privateProfile, "admin_room"),
    };
  }, [viewerProfile]);

  const visibleRooms = useMemo(() => ROOM_DEFINITIONS.filter((room) => roomAccess[room.id]), [roomAccess]);

  const visibleVerifiedSellerChats = useMemo(
    () =>
      verifiedSellerChats.filter((seller) => {
        if (!seller.username) return false;
        if (isAdmin) return true;
        if (seller.id === user?.id) return true;
        return seller.ghost_ridin !== true;
      }),
    [isAdmin, user?.id, verifiedSellerChats]
  );

  const activeRoomId = useMemo(() => {
    if (activePanel.kind === "text") {
      return activePanel.roomId;
    }
    return visibleRooms[0]?.id ?? "smoke_room";
  }, [activePanel, visibleRooms]);

  const activeRoomMeta = useMemo(
    () => visibleRooms.find((room) => room.id === activeRoomId) ?? visibleRooms[0] ?? ROOM_DEFINITIONS[0],
    [activeRoomId, visibleRooms]
  );

  const activeMessages = messagesByRoom[activeRoomMeta.id] || [];
  const voiceIsFull = !voiceJoined && voiceParticipants.length >= VOICE_LIMIT;

  const ensureProfileBuckets = useCallback(async () => {
    const response = await fetch("/api/storage/profile-buckets", { method: "POST" });
    if (!response.ok) {
      throw new Error("Storage is unavailable right now.");
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    const supabase = createClient();
    const roomFilters = ROOM_DEFINITIONS.filter((room) => roomAccess[room.id]);
    if (!roomFilters.length) {
      setMessagesByRoom({ smoke_room: [], smoke_room_2: [], psychonautics: [], admin_room: [] });
      setLoading(false);
      return;
    }

    const orConditions = roomFilters
      .map((room) => {
        if (room.id === "smoke_room") {
          return "room.eq.smoke_room,room.is.null";
        }
        return `room.eq.${room.id}`;
      })
      .join(",");

    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .or(orConditions)
      .order("created_at", { ascending: true });

    if (error || !data) {
      setError("Could not load chat rooms right now. Please try again.");
      setLoading(false);
      return;
    }

    setError(null);

    const rows = (data as ChatMessage[]).filter((msg) => roomAccess[normalizeMessageRoom(msg.room)]);
    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];

    const profileById = new Map<string, ProfileFlags>();
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id,username,display_name,verified_badge,member_number,shadow_banned,shadow_banned_until,avatar_url")
        .in("id", userIds);

      (profiles || []).forEach((profile) => profileById.set(profile.id, profile as ProfileFlags));
    }

    const nextByRoom: Record<ChatRoomId, ChatMessage[]> = {
      smoke_room: [],
      smoke_room_2: [],
      psychonautics: [],
      admin_room: [],
    };

    rows.forEach((msg) => {
      const roomId = normalizeMessageRoom(msg.room);
      const author = profileById.get(msg.user_id) ?? null;
      if (!isAdmin && msg.user_id !== user?.id && profileIsShadowBanned(author)) {
        return;
      }
      nextByRoom[roomId].push({ ...msg, author });
    });

    setMessagesByRoom(nextByRoom);
    setLoading(false);
  }, [isAdmin, roomAccess, user?.id]);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const bootstrap = async () => {
      try {
        const { user: nextUser } = await resolveClientAuth(supabase);
        if (!mounted) return;
        setUser(nextUser || null);

        if (!nextUser) {
          setViewerProfile(null);
          setIsAdmin(false);
          return;
        }

        const profile = await fetchClientProfile<ProfileFlags>(
          supabase,
          nextUser.id,
          "id,role,smoke_room_2_invited,psychonautics_access,admin_room_access,username,display_name,verified_badge,member_number",
          { ensureProfile: true }
        );

        if (!mounted) return;
        setViewerProfile(profile ?? null);
        setIsAdmin(profile?.role === "admin");
      } catch {
        if (!mounted) return;
        setViewerProfile(null);
        setIsAdmin(false);
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const loadVerifiedSellerChats = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, ghost_ridin")
        .eq("verified_badge", true)
        .not("username", "is", null)
        .order("display_name", { ascending: true });

      if (!active || error) {
        return;
      }

      setVerifiedSellerChats((data || []) as VerifiedSellerChat[]);
    };

    void loadVerifiedSellerChats();

    const channel = supabase
      .channel("public:verified-seller-chats")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void loadVerifiedSellerChats();
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (activePanel.kind === "text" && !visibleRooms.some((room) => room.id === activePanel.roomId)) {
      setActivePanel({ kind: "text", roomId: visibleRooms[0]?.id ?? "smoke_room" });
    }
  }, [activePanel, visibleRooms]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void fetchMessages();
      }, 450);
    };

    const channel = supabase
      .channel("public:dye_chat_workspace")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const next = payload.new as ChatMessage;
        const roomId = normalizeMessageRoom(next.room);
        if (!roomAccess[roomId]) return;

        if (next.user_id !== user?.id && (activePanel.kind !== "text" || roomId !== activePanel.roomId)) {
          setUnreadByRoom((prev) => ({ ...prev, [roomId]: prev[roomId] + 1 }));
        }
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, () => {
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, () => {
        scheduleRefresh();
      })
      .subscribe();

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [activePanel, fetchMessages, roomAccess, user?.id]);

  useEffect(() => {
    if (activePanel.kind === "text") {
      setUnreadByRoom((prev) => ({ ...prev, [activePanel.roomId]: 0 }));
    }
  }, [activePanel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages, activePanel]);

  useEffect(() => {
    const supabase = createClient();
    if (!user?.id) {
      setVoiceParticipants([]);
      setVoiceJoined(false);
      if (voiceChannelRef.current) {
        supabase.removeChannel(voiceChannelRef.current);
        voiceChannelRef.current = null;
      }
      return;
    }

    const channel = supabase.channel("presence:dyespace:voice-chat", {
      config: { presence: { key: user.id } },
    });

    const syncParticipants = () => {
      const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>;
      const participants = Object.entries(state)
        .flatMap(([key, entries]) =>
          entries.map((entry) => ({
            userId: String(entry.userId || key),
            displayName: String(entry.displayName || "DyeSpace User"),
            joinedAt: String(entry.joinedAt || new Date().toISOString()),
          }))
        )
        .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt));

      setVoiceParticipants(participants);
      setVoiceJoined(participants.some((participant) => participant.userId === user.id));
    };

    channel.on("presence", { event: "sync" }, syncParticipants);
    channel.subscribe();

    voiceChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      voiceChannelRef.current = null;
      setVoiceParticipants([]);
      setVoiceJoined(false);
    };
  }, [user?.id]);

  const uploadPhotos = useCallback(
    async (files: File[]) => {
      if (!files.length || !user?.id) return;
      setUploadingPhotos(true);
      setError(null);

      try {
        await ensureProfileBuckets();
        const uploadedUrls: string[] = [];

        for (const file of files) {
          const body = new FormData();
          body.append("bucket", "posts");
          body.append("file", file);

          const response = await fetch("/api/profile/upload", {
            method: "POST",
            body,
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok || typeof payload?.publicUrl !== "string") {
            throw new Error(payload?.error || "Photo upload failed.");
          }

          uploadedUrls.push(payload.publicUrl);
        }

        setPendingPhotoUrls((prev) => [...prev, ...uploadedUrls]);
      } catch (uploadError: any) {
        setError(typeof uploadError?.message === "string" ? uploadError.message : "Photo upload failed.");
      } finally {
        setUploadingPhotos(false);
      }
    },
    [ensureProfileBuckets, user?.id]
  );

  const sendMessage = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!user || activePanel.kind !== "text") return;

      const baseText = input.trim();
      const photoTokens = pendingPhotoUrls.map((url) => `[photo:${url}]`).join(" ");
      const messageBody = [baseText, photoTokens].filter(Boolean).join("\n").trim();

      if (!messageBody) return;

      const now = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        user_id: user.id,
        username: user.user_metadata?.username || user.email,
        message: messageBody,
        created_at: now,
        room: activePanel.roomId,
        author: viewerProfile,
      };

      setInput("");
      setPendingPhotoUrls([]);
      setMessagesByRoom((prev) => ({
        ...prev,
        [activePanel.roomId]: [...prev[activePanel.roomId], optimistic],
      }));

      const supabase = createClient();
      const { data: inserted } = await supabase
        .from("chat_messages")
        .insert({
          user_id: user.id,
          username: user.user_metadata?.username || user.email,
          message: messageBody,
          room: activePanel.roomId,
        })
        .select()
        .single();

      if (inserted) {
        const insertedMessage = inserted as ChatMessage;
        setMessagesByRoom((prev) => ({
          ...prev,
          [activePanel.roomId]: prev[activePanel.roomId].map((msg) =>
            msg.id === optimistic.id ? { ...insertedMessage, author: viewerProfile } : msg
          ),
        }));
      }
    },
    [activePanel, input, pendingPhotoUrls, user, viewerProfile]
  );

  const startEditMessage = useCallback((message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditText(stripPhotoTokens(message.message));
  }, []);

  const saveEditMessage = useCallback(
    async (messageId: string) => {
      if (!user || !editText.trim() || activePanel.kind !== "text") return;
      const supabase = createClient();
      await supabase
        .from("chat_messages")
        .update({ message: editText.trim() })
        .eq("id", messageId)
        .eq("user_id", user.id);

      setMessagesByRoom((prev) => ({
        ...prev,
        [activePanel.roomId]: prev[activePanel.roomId].map((msg) =>
          msg.id === messageId ? { ...msg, message: editText.trim() } : msg
        ),
      }));

      setEditingMessageId(null);
      setEditText("");
    },
    [activePanel, editText, user]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!user || activePanel.kind !== "text" || !confirm("Delete this message?")) return;
      const supabase = createClient();
      await supabase.from("chat_messages").delete().eq("id", messageId).eq("user_id", user.id);
      setMessagesByRoom((prev) => ({
        ...prev,
        [activePanel.roomId]: prev[activePanel.roomId].filter((msg) => msg.id !== messageId),
      }));
    },
    [activePanel, user]
  );

  const reportMessage = useCallback(
    async (message: ChatMessage) => {
      if (!user?.id) return;
      const reason = prompt("Reason for reporting this message?");
      if (!reason) return;
      const supabase = createClient();
      await supabase.from("reports").insert({
        type: "chat_message",
        reported_id: message.id,
        reported_by: user.id,
        reporter_id: user.id,
        reason,
        created_at: new Date().toISOString(),
      });
      alert("Message reported. Thank you!");
    },
    [user?.id]
  );

  const handleAdminAction = useCallback(
    async (targetUserId: string, action: AdminActionName, durationHours?: number) => {
      if (!user?.id || !isAdmin) return;
      setAdminActionStatus(null);
      try {
        const body = await runAdminUserAction({ targetUserId, action, durationHours });
        setAdminActionStatus(body?.message || "Admin action applied.");
      } catch (adminError: any) {
        setAdminActionStatus(typeof adminError?.message === "string" ? adminError.message : "Admin action failed.");
      }
    },
    [isAdmin, user?.id]
  );

  const joinVoiceChat = useCallback(async () => {
    if (!user?.id || voiceJoined || voiceIsFull || !voiceChannelRef.current) return;

    await voiceChannelRef.current.track({
      userId: user.id,
      displayName: viewerProfile?.display_name || viewerProfile?.username || user.user_metadata?.username || "DyeSpace User",
      joinedAt: new Date().toISOString(),
    });
  }, [user, viewerProfile, voiceIsFull, voiceJoined]);

  const leaveVoiceChat = useCallback(async () => {
    if (!voiceChannelRef.current || !voiceJoined) return;
    await voiceChannelRef.current.untrack();
    setVoiceJoined(false);
  }, [voiceJoined]);

  return (
    <>
      <div className="relative h-[calc(100dvh-5.75rem)] min-h-[720px] overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-slate-950/80 shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl max-md:h-auto max-md:min-h-[calc(100dvh-6.5rem)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(45,212,191,0.12),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(244,114,182,0.10),transparent_30%),radial-gradient(circle_at_100%_100%,rgba(34,211,238,0.10),transparent_40%)]" />

        <div className="relative grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px]">
          <section className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950/45 lg:border-r lg:border-cyan-300/10">
            {activePanel.kind === "text" ? (
              <>
                <header className="flex items-center justify-between border-b border-cyan-300/10 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${activeRoomMeta.dotClassName}`} />
                      <h1 className="truncate text-lg font-semibold text-slate-100">{activeRoomMeta.name}</h1>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">{activeRoomMeta.subtitle}</p>
                  </div>
                  {adminActionStatus ? (
                    <div className="max-w-[52%] truncate rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                      {adminActionStatus}
                    </div>
                  ) : null}
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-6 sm:px-6">
                  {loading ? (
                    <AsyncStateCard compact loading title="Loading Chat" message="Syncing channels and recent messages." />
                  ) : error ? (
                    <AsyncStateCard
                      compact
                      tone="error"
                      title="Chat Load Failed"
                      message={error}
                      actionLabel="Retry"
                      onAction={() => {
                        setLoading(true);
                        void fetchMessages();
                      }}
                    />
                  ) : activeMessages.length === 0 ? (
                    <div className="rounded-2xl border border-cyan-300/15 bg-black/20 px-4 py-5 text-sm text-slate-300">
                      No messages yet. Kick things off with the first message.
                    </div>
                  ) : (
                    <div className="space-y-3 pb-2">
                      {activeMessages.map((message, index) => {
                        const own = Boolean(user?.id && message.user_id === user.id);
                        const previousMessage = index > 0 ? activeMessages[index - 1] : null;
                        const compact = Boolean(previousMessage && previousMessage.user_id === message.user_id);
                        const messageText = stripPhotoTokens(message.message);
                        const messagePhotos = extractPhotoUrls(message.message);
                        const canEditText = own && messagePhotos.length === 0;

                        return (
                          <div key={message.id} className={`group flex gap-3 ${own ? "justify-end" : "justify-start"}`}>
                            {!own && !compact ? (
                              <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-slate-900 text-xs font-semibold text-cyan-100">
                                {getAvatarInitials(message)}
                              </div>
                            ) : !own ? (
                              <div className="w-9 shrink-0" />
                            ) : null}

                            <div className={`max-w-[88%] sm:max-w-[78%] ${own ? "items-end" : "items-start"} flex flex-col gap-1`}>
                              {!compact ? (
                                <div className={`flex items-center gap-2 ${own ? "flex-row-reverse" : ""}`}>
                                  <span className="text-sm font-semibold text-slate-100">
                                    {message.author?.display_name || message.author?.username || message.username}
                                  </span>
                                  <span className="text-[11px] text-slate-500">
                                    {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </div>
                              ) : null}

                              <div
                                className={`w-full rounded-2xl border px-3 py-2 text-sm leading-6 text-slate-100 shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-all duration-200 ${
                                  own
                                    ? "border-cyan-300/30 bg-gradient-to-br from-cyan-500/22 to-blue-500/16"
                                    : `border-slate-700/70 bg-gradient-to-br ${activeRoomMeta.bubbleClassName}`
                                }`}
                              >
                                {editingMessageId === message.id ? (
                                  <div className="space-y-2">
                                    <input
                                      className="w-full rounded-xl border border-cyan-300/30 bg-black/40 px-2.5 py-1.5 text-sm text-cyan-100 outline-none focus:ring-2 focus:ring-cyan-400"
                                      title="Edit your message"
                                      placeholder="Edit your message"
                                      value={editText}
                                      onChange={(event) => setEditText(event.target.value)}
                                      maxLength={500}
                                      autoFocus
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          void saveEditMessage(message.id);
                                        }
                                        if (event.key === "Escape") {
                                          setEditingMessageId(null);
                                          setEditText("");
                                        }
                                      }}
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void saveEditMessage(message.id)}
                                        className="rounded-lg border border-cyan-300/30 bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/35"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingMessageId(null);
                                          setEditText("");
                                        }}
                                        className="rounded-lg border border-slate-500/40 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {messageText ? <p className="whitespace-pre-wrap break-words">{messageText}</p> : null}
                                    {messagePhotos.length ? (
                                      <div className={messageText ? "mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
                                        {messagePhotos.map((photoUrl) => (
                                          <button
                                            key={`${message.id}-${photoUrl}`}
                                            type="button"
                                            onClick={() => setLightboxImageUrl(photoUrl)}
                                            className="group/photo overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-900/65"
                                          >
                                            <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
                                              <img
                                                src={photoUrl}
                                                alt="Shared in chat"
                                                className="h-full w-full object-cover transition duration-200 group-hover/photo:scale-[1.02]"
                                                loading="lazy"
                                              />
                                            </div>
                                            <div className="border-t border-cyan-300/20 bg-black/35 px-2 py-1 text-left text-[11px] font-semibold text-cyan-100/90">
                                              Tap to expand
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>

                              <div className={`flex items-center gap-3 px-1 text-[11px] text-slate-400 transition ${own || isAdmin ? "opacity-0 group-hover:opacity-100" : "opacity-100"}`}>
                                {canEditText ? (
                                  <button type="button" className="hover:text-cyan-200" onClick={() => startEditMessage(message)}>
                                    Edit
                                  </button>
                                ) : null}
                                {own ? (
                                  <button type="button" className="hover:text-rose-300" onClick={() => void deleteMessage(message.id)}>
                                    Delete
                                  </button>
                                ) : isAdmin ? (
                                  <AdminActionMenu targetUserId={message.user_id} onAction={handleAdminAction} label="ADMIN" />
                                ) : user ? (
                                  <button type="button" className="hover:text-pink-300" onClick={() => void reportMessage(message)}>
                                    Report
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                <footer className="border-t border-cyan-300/10 px-4 py-4 sm:px-6">
                  {user ? (
                    <form onSubmit={sendMessage} className="space-y-3">
                      {pendingPhotoUrls.length ? (
                        <div className="flex flex-wrap gap-2">
                          {pendingPhotoUrls.map((photoUrl) => (
                            <div key={photoUrl} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-cyan-300/30 bg-slate-900/65">
                              <img src={photoUrl} alt="Pending upload" className="h-full w-full object-cover" loading="lazy" />
                              <button
                                type="button"
                                className="absolute right-1 top-1 rounded-full border border-black/60 bg-black/75 px-1 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
                                onClick={() => setPendingPhotoUrls((prev) => prev.filter((url) => url !== photoUrl))}
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex items-end gap-3">
                        <div className="relative flex-1">
                          <textarea
                            className="max-h-32 min-h-[48px] w-full resize-y rounded-2xl border border-cyan-300/25 bg-black/35 px-4 py-3 text-sm text-cyan-100 outline-none transition focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-400/35"
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            placeholder={`Message ${activeRoomMeta.name}`}
                            maxLength={500}
                            rows={2}
                          />
                          <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-slate-500">{input.length}/500</span>
                        </div>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          title="Upload chat photos"
                          aria-label="Upload chat photos"
                          className="hidden"
                          onChange={(event) => {
                            const files = Array.from(event.target.files || []);
                            event.currentTarget.value = "";
                            void uploadPhotos(files);
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/30 bg-black/35 text-cyan-100 transition hover:border-cyan-300/55 hover:bg-cyan-500/20"
                          title="Upload photos"
                          disabled={uploadingPhotos}
                        >
                          <ImagePlus className="h-5 w-5" />
                        </button>

                        <button
                          type="submit"
                          className="rounded-2xl bg-gradient-to-br from-cyan-400 via-teal-400 to-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_10px_30px_rgba(20,184,166,0.35)] transition hover:-translate-y-[1px] hover:brightness-110 disabled:opacity-60"
                          disabled={uploadingPhotos || (!input.trim() && pendingPhotoUrls.length === 0)}
                        >
                          {uploadingPhotos ? "Uploading..." : "Send"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="rounded-2xl border border-cyan-300/20 bg-black/20 px-4 py-3 text-sm text-cyan-100/85">Log in to join this chat room.</div>
                  )}
                </footer>
              </>
            ) : (
              <>
                <header className="flex items-center justify-between border-b border-fuchsia-300/15 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-fuchsia-200" />
                      <h1 className="truncate text-lg font-semibold text-slate-100">Voice Chat</h1>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">Live lounge capped at 6 participants</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia-300/35 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-100">
                    <UsersIcon className="h-3.5 w-3.5" />
                    {voiceParticipants.length}/{VOICE_LIMIT}
                  </span>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-6 sm:px-6">
                  <div className="rounded-3xl border border-fuchsia-300/20 bg-black/30 p-5">
                    <p className="text-sm text-slate-300">
                      Drop in for live conversations. Keep your mic respectful and be mindful of the room vibe.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void joinVoiceChat()}
                        disabled={!user || voiceJoined || voiceIsFull}
                        className="rounded-xl border border-fuchsia-300/35 bg-fuchsia-500/15 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        {voiceJoined ? "Joined Voice Chat" : voiceIsFull ? "Voice Chat Full" : "Join Voice Chat"}
                      </button>
                      {voiceJoined ? (
                        <button
                          type="button"
                          onClick={() => void leaveVoiceChat()}
                          className="rounded-xl border border-rose-300/35 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25"
                        >
                          Leave Voice Chat
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-5 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-fuchsia-200/80">Participants</p>
                      {voiceParticipants.length === 0 ? (
                        <p className="rounded-xl border border-fuchsia-300/15 bg-slate-900/45 px-3 py-2 text-sm text-slate-300">No one is in voice chat yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {voiceParticipants.map((participant) => (
                            <div key={participant.userId} className="flex items-center justify-between rounded-xl border border-fuchsia-300/20 bg-slate-900/55 px-3 py-2 text-sm text-slate-100">
                              <span className="truncate">{participant.displayName}</span>
                              <span className="text-xs text-slate-400">{new Date(participant.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="flex h-full min-h-0 flex-col border-t border-cyan-300/10 bg-slate-950/90 lg:border-l lg:border-t-0 lg:border-cyan-300/10">
            <div className="border-b border-cyan-300/10 px-5 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">The Dye Chat</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-100">Channels</h2>
              <p className="mt-1 text-sm text-slate-400">Realtime rooms, voice, and seller chats</p>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
              <section>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500">Text Channels</p>
                <div className="space-y-2">
                  {visibleRooms.map((room) => {
                    const active = activePanel.kind === "text" && room.id === activePanel.roomId;
                    const unreadCount = unreadByRoom[room.id];

                    return (
                      <button
                        key={room.id}
                        type="button"
                        onClick={() => setActivePanel({ kind: "text", roomId: room.id })}
                        className={`group flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                          active
                            ? "border-cyan-200/40 bg-cyan-300/12 shadow-[0_0_0_1px_rgba(34,211,238,0.35),0_0_26px_rgba(34,211,238,0.16)]"
                            : `border-slate-700/60 bg-slate-900/55 hover:-translate-y-[1px] hover:border-slate-500/80 ${room.sidebarGlowClassName}`
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${room.dotClassName}`} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-100">{room.name}</span>
                            <span className="block truncate text-xs text-slate-400">{room.subtitle}</span>
                          </span>
                        </span>
                        {unreadCount > 0 ? (
                          <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-cyan-200/40 bg-cyan-400/20 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500">Voice Chat</p>
                <button
                  type="button"
                  onClick={() => setActivePanel({ kind: "voice" })}
                  className={`group flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
                    activePanel.kind === "voice"
                      ? "border-fuchsia-200/40 bg-fuchsia-300/10 shadow-[0_0_0_1px_rgba(244,114,182,0.3),0_0_26px_rgba(217,70,239,0.15)]"
                      : "border-slate-700/60 bg-slate-900/55 hover:-translate-y-[1px] hover:border-fuchsia-300/40"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-fuchsia-300/35 bg-fuchsia-500/15 text-fuchsia-100">
                      <Mic className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-100">Voice Chat</span>
                      <span className="block truncate text-xs text-slate-400">Max 6 people live</span>
                    </span>
                  </span>
                  <span className="inline-flex min-w-14 items-center justify-center rounded-full border border-fuchsia-300/35 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-100">
                    {voiceParticipants.length}/{VOICE_LIMIT}
                  </span>
                </button>
                {voiceIsFull ? (
                  <p className="mt-2 rounded-xl border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">Voice Chat Full</p>
                ) : null}
              </section>

              <section>
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500">Verified Seller Chats</p>
                <div className="space-y-2">
                  {visibleVerifiedSellerChats.length === 0 ? (
                    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 px-3 py-3 text-xs text-slate-400">
                      No verified seller chats are visible right now.
                    </div>
                  ) : (
                    visibleVerifiedSellerChats.map((seller) => (
                      <button
                        key={seller.id}
                        type="button"
                        onClick={() => {
                          if (!seller.username) return;
                          window.location.href = `/profile/${encodeURIComponent(seller.username)}/fan-chat`;
                        }}
                        className="group flex w-full items-center justify-between rounded-2xl border border-slate-700/60 bg-slate-900/55 px-3 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-fuchsia-300/40 hover:shadow-[0_0_0_1px_rgba(217,70,239,0.18),0_0_24px_rgba(217,70,239,0.1)]"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-fuchsia-300" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-100">
                              {seller.display_name || seller.username || "Verified Seller"}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              @{seller.username}
                              {seller.ghost_ridin === true && (isAdmin || seller.id === user?.id) ? " • Ghost Rider hidden" : " • Fan chat"}
                            </span>
                          </span>
                        </span>
                        <span className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold text-fuchsia-100">
                          Join
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>

      {lightboxImageUrl ? (
        <button
          type="button"
          className="fixed inset-0 z-[2147483650] flex items-center justify-center bg-black/85 p-5 backdrop-blur-sm"
          onClick={() => setLightboxImageUrl(null)}
          aria-label="Close expanded image"
        >
          <img src={lightboxImageUrl} alt="Expanded chat image" className="max-h-[90vh] max-w-[90vw] rounded-2xl border border-cyan-300/30 object-contain" />
        </button>
      ) : null}
    </>
  );
}
