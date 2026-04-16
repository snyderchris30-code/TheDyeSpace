"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Menu, Mic, Users as UsersIcon, X } from "lucide-react";
import AsyncStateCard from "@/app/AsyncStateCard";
import AdminActionMenu from "@/app/AdminActionMenu";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import { createClient } from "@/lib/supabase/client";
import { canAccessSmokeLounge } from "@/lib/verified-seller";
import { canAccessPrivateRoom, type PrivateRoomAccessProfile } from "@/lib/private-rooms";

type ChatRoomId = "smoke_room" | "smoke_room_2" | "psychonautics" | "admin_room";
type RoomId = ChatRoomId | `fan_chat_${string}`;
type ChatPanel = { kind: "text"; roomId: RoomId } | { kind: "voice" };

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

function normalizeMessageRoom(room: string | null | undefined): RoomId {
  if (!room || room === "smoke_room") return "smoke_room";
  if (room === "smoke_room_2") return "smoke_room_2";
  if (room === "psychonautics") return "psychonautics";
  if (room === "admin_room") return "admin_room";
  if (/^fan_chat_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(room)) {
    return room as RoomId;
  }
  return "smoke_room";
}

function sellerRoomId(sellerId: string) {
  return `fan_chat_${sellerId}` as RoomId;
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
  const searchParams = useSearchParams();
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, ChatMessage[]>>({
    smoke_room: [],
    smoke_room_2: [],
    psychonautics: [],
    admin_room: [],
  });
  const [unreadByRoom, setUnreadByRoom] = useState<Record<string, number>>({
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [verifiedSellerChats, setVerifiedSellerChats] = useState<VerifiedSellerChat[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const previousMessageCountRef = useRef<number>(0);
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

  const visibleVerifiedSellerRoomIds = useMemo(
    () => visibleVerifiedSellerChats.map((seller) => sellerRoomId(seller.id)),
    [visibleVerifiedSellerChats]
  );

  const roomIsAccessible = useCallback(
    (roomId: RoomId) => {
      if (roomId.startsWith("fan_chat_")) {
        return visibleVerifiedSellerRoomIds.includes(roomId);
      }

      return roomAccess[roomId as ChatRoomId];
    },
    [roomAccess, visibleVerifiedSellerRoomIds]
  );

  const activeRoomId = useMemo(() => {
    if (activePanel.kind === "text") {
      return activePanel.roomId;
    }
    return visibleRooms[0]?.id ?? "smoke_room";
  }, [activePanel, visibleRooms]);

  const activeSellerChat = useMemo(
    () => visibleVerifiedSellerChats.find((seller) => sellerRoomId(seller.id) === activeRoomId) ?? null,
    [activeRoomId, visibleVerifiedSellerChats]
  );

  const activeRoomMeta = useMemo(
    () => visibleRooms.find((room) => room.id === activeRoomId) ?? visibleRooms[0] ?? ROOM_DEFINITIONS[0],
    [activeRoomId, visibleRooms]
  );

  const activeRoomLabel = useMemo(() => {
    if (!activeSellerChat) {
      return {
        name: activeRoomMeta.name,
        subtitle: activeRoomMeta.subtitle,
        dotClassName: activeRoomMeta.dotClassName,
        bubbleClassName: activeRoomMeta.bubbleClassName,
      };
    }

    return {
      name: `${activeSellerChat.display_name || activeSellerChat.username || "Verified Seller"} Fan Chat`,
      subtitle: "Private verified seller chat",
      dotClassName: "bg-fuchsia-300",
      bubbleClassName: "from-fuchsia-500/18 to-cyan-500/12",
    };
  }, [activeRoomMeta, activeSellerChat]);

  const activeMessages = messagesByRoom[activeRoomId] || [];
  const voiceIsFull = !voiceJoined && voiceParticipants.length >= VOICE_LIMIT;

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const sidebarContent = (
    <>
      <div className="border-b border-cyan-300/10 px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">The Dye Chat</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-100 sm:text-xl">Channels</h2>
        <p className="mt-1 text-xs text-slate-400 sm:text-sm">Realtime rooms, voice, and seller chats</p>
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
                  onClick={() => {
                    setActivePanel({ kind: "text", roomId: room.id });
                    closeMobileSidebar();
                  }}
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
            onClick={() => {
              setActivePanel({ kind: "voice" });
              closeMobileSidebar();
            }}
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
                    closeMobileSidebar();
                    setActivePanel({ kind: "text", roomId: sellerRoomId(seller.id) });
                  }}
                  aria-label={`Open ${seller.display_name || seller.username || "seller"} fan chat`}
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
    </>
  );

  const ensureProfileBuckets = useCallback(async () => {
    const response = await fetch("/api/storage/profile-buckets", { method: "POST" });
    if (!response.ok) {
      throw new Error("Storage is unavailable right now.");
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    const roomFilters = [
      ...ROOM_DEFINITIONS.filter((room) => roomAccess[room.id]).map((room) => room.id),
      ...visibleVerifiedSellerRoomIds,
    ];

    if (!roomFilters.length) {
      setMessagesByRoom({ smoke_room: [], smoke_room_2: [], psychonautics: [], admin_room: [] });
      setLoading(false);
      return;
    }

    const response = await fetch(`/api/chat/messages?rooms=${encodeURIComponent(roomFilters.join(","))}`, {
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !Array.isArray(body?.messages)) {
      setError("Could not load chat rooms right now. Please try again.");
      setLoading(false);
      return;
    }

    setError(null);

    const rows = (body.messages as ChatMessage[]).filter((msg) => roomIsAccessible(normalizeMessageRoom(msg.room)));

    const nextByRoom: Record<string, ChatMessage[]> = {
      smoke_room: [],
      smoke_room_2: [],
      psychonautics: [],
      admin_room: [],
    };

    rows.forEach((msg) => {
      const roomId = normalizeMessageRoom(msg.room);
      if (!isAdmin && msg.user_id !== user?.id && profileIsShadowBanned(msg.author)) {
        return;
      }
      if (!nextByRoom[roomId]) {
        nextByRoom[roomId] = [];
      }
      nextByRoom[roomId].push(msg);
    });

    setMessagesByRoom(nextByRoom);
    setLoading(false);
  }, [isAdmin, roomAccess, roomIsAccessible, user?.id, visibleVerifiedSellerRoomIds]);

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
      if (!roomIsAccessible(activePanel.roomId)) {
        setActivePanel({ kind: "text", roomId: visibleRooms[0]?.id ?? "smoke_room" });
      }
    }
  }, [activePanel, roomIsAccessible, visibleRooms]);

  useEffect(() => {
    const requestedRoom = normalizeMessageRoom(searchParams.get("room"));
    const requestedSeller = (searchParams.get("seller") || "").trim().toLowerCase();

    if (requestedSeller) {
      const seller = visibleVerifiedSellerChats.find((entry) => (entry.username || "").toLowerCase() === requestedSeller);
      if (seller) {
        setActivePanel({ kind: "text", roomId: sellerRoomId(seller.id) });
        return;
      }
    }

    if (requestedRoom && roomIsAccessible(requestedRoom)) {
      setActivePanel({ kind: "text", roomId: requestedRoom });
    }
  }, [roomIsAccessible, searchParams, visibleVerifiedSellerChats]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void fetchMessages();
      }
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
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
        if (!roomIsAccessible(roomId)) return;

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
  }, [activePanel, fetchMessages, roomIsAccessible, user?.id]);

  useEffect(() => {
    if (activePanel.kind === "text") {
      setUnreadByRoom((prev) => ({ ...prev, [activePanel.roomId]: 0 }));
    }
  }, [activePanel]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 50;

    const prevCount = previousMessageCountRef.current;
    const currentCount = activeMessages.length;

    // Only auto-scroll to bottom if: user was already at bottom AND a new message was added
    if (isAtBottom && currentCount > prevCount) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    previousMessageCountRef.current = currentCount;
  }, [activeMessages]);

  // Scroll to bottom when switching rooms
  useEffect(() => {
    if (activePanel.kind === "text") {
      previousMessageCountRef.current = activeMessages.length;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 0);
    }
  }, [activePanel]);

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

      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: activePanel.roomId, message: messageBody }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body?.message) {
        setMessagesByRoom((prev) => ({
          ...prev,
          [activePanel.roomId]: prev[activePanel.roomId].filter((msg) => msg.id !== optimistic.id),
        }));
        setError(body?.error || "Could not send your message. Please try again.");
        return;
      }

      const insertedMessage = body.message as ChatMessage;
      if (insertedMessage) {
        setMessagesByRoom((prev) => ({
          ...prev,
          [activePanel.roomId]: prev[activePanel.roomId].map((msg) =>
            msg.id === optimistic.id ? insertedMessage : msg
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
      const response = await fetch("/api/chat/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, message: editText.trim() }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body?.message) {
        setError(body?.error || "Could not update your message. Please try again.");
        return;
      }

      setMessagesByRoom((prev) => ({
        ...prev,
        [activePanel.roomId]: prev[activePanel.roomId].map((msg) =>
          msg.id === messageId ? (body.message as ChatMessage) : msg
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
      const response = await fetch(`/api/chat/messages?messageId=${encodeURIComponent(messageId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error || "Could not delete your message. Please try again.");
        return;
      }

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
      <div className="relative h-[100dvh] min-h-[100dvh] overflow-hidden bg-slate-950 text-slate-100 lg:h-[calc(100dvh-5.75rem)] lg:min-h-[720px] lg:rounded-[2rem] lg:border lg:border-cyan-300/20 lg:bg-slate-950/80 lg:shadow-[0_24px_90px_rgba(0,0,0,0.55)] lg:backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(45,212,191,0.12),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(244,114,182,0.10),transparent_30%),radial-gradient(circle_at_100%_100%,rgba(34,211,238,0.10),transparent_40%)]" />

        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center justify-center rounded-full border border-slate-700 bg-black/70 px-4 py-2 text-slate-100 shadow-lg backdrop-blur-sm transition hover:border-cyan-300/50 lg:hidden"
          aria-label="Open chat sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>

        {mobileSidebarOpen ? (
          <button
            type="button"
            aria-label="Close sidebar overlay"
            className="absolute inset-0 z-40 bg-black/65 lg:hidden"
            onClick={closeMobileSidebar}
          />
        ) : null}

        <aside
          className={`absolute inset-y-0 left-0 z-50 flex w-[88vw] max-w-[340px] flex-col border-r border-cyan-300/20 bg-slate-950/95 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-transform duration-300 lg:hidden ${
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-end border-b border-cyan-300/10 px-3 py-3">
            <button
              type="button"
              onClick={closeMobileSidebar}
              className="rounded-full border border-slate-700 bg-black/40 p-2 text-slate-100 hover:border-cyan-300/50"
              aria-label="Close chat sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {sidebarContent}
        </aside>

        <div className="relative grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px]">
          <section className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-950/45 lg:border-r lg:border-cyan-300/10">
            {activePanel.kind === "text" ? (
              <>
                <header className="flex items-center justify-between border-b border-cyan-300/10 px-4 pb-3 pt-14 sm:px-6 lg:px-5 lg:py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${activeRoomLabel.dotClassName}`} />
                      <h1 className="truncate text-lg font-semibold text-slate-100">{activeRoomLabel.name}</h1>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">{activeRoomLabel.subtitle}</p>
                  </div>
                  {adminActionStatus ? (
                    <div className="max-w-[52%] truncate rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                      {adminActionStatus}
                    </div>
                  ) : null}
                </header>

                <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-6 sm:px-6">
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
                                    : `border-slate-700/70 bg-gradient-to-br ${activeRoomLabel.bubbleClassName}`
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

                <footer className="border-t border-cyan-300/10 px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)] pt-3 sm:px-6 sm:py-4">
                  {user ? (
                    <form onSubmit={sendMessage} className="space-y-2">
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

                      <div className="flex items-end gap-2 sm:gap-3">
                        <div className="relative flex-1">
                          <textarea
                            className="max-h-32 min-h-[40px] w-full resize-y rounded-xl border border-slate-700 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-400/35 sm:min-h-[48px] sm:rounded-2xl sm:px-4 sm:py-3"
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            placeholder={`Message ${activeRoomLabel.name}`}
                            maxLength={500}
                            rows={1}
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
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/30 bg-black/35 text-cyan-100 transition hover:border-cyan-300/55 hover:bg-cyan-500/20 sm:h-12 sm:w-12 sm:rounded-2xl"
                          title="Upload photos"
                          disabled={uploadingPhotos}
                        >
                          <ImagePlus className="h-5 w-5" />
                        </button>

                        <button
                          type="submit"
                          className="rounded-xl bg-gradient-to-br from-cyan-400 via-teal-400 to-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950 shadow-[0_10px_30px_rgba(20,184,166,0.35)] transition hover:-translate-y-[1px] hover:brightness-110 disabled:opacity-60 sm:rounded-2xl sm:px-4 sm:py-3"
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
                <header className="flex items-center justify-between border-b border-fuchsia-300/15 px-4 pb-3 pt-14 sm:px-6 lg:px-5 lg:py-4">
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

          <aside className="hidden h-full min-h-0 flex-col border-l border-cyan-300/10 bg-slate-950/90 lg:flex">
            {sidebarContent}
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
