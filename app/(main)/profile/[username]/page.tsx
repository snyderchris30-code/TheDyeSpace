
"use client";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Dialog } from "@headlessui/react";
import { useParams, useRouter } from "next/navigation";
import { Heart, MessageCircle, Send, SquarePen, Music2, PlayCircle, Plus, X, Maximize2 } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AdminActionMenu from "@/app/AdminActionMenu";
import EmojiPicker from "@/app/EmojiPicker";
import InlineEmojiText from "@/app/InlineEmojiText";
import UserIdentity from "@/app/UserIdentity";
import { normalizePostImageUrls } from "@/lib/post-media";
import { REACTION_EMOJIS, type AggregatedPostInteraction, type ReactionEmoji } from "@/lib/post-interactions";
import { runAdminUserAction, type AdminActionName } from "@/lib/admin-actions";
import { appendEmojiToText } from "@/lib/custom-emojis";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_FONT_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_OPTIONS,
  fontClass,
  normalizeFontStyle,
  PROFILE_COLOR_PALETTES,
  resolveProfileAppearance,
  type FontStyle,
  type ProfileAppearance,
} from "@/lib/profile-theme";
import { resolveProfileUsername, sanitizeUsernameInput } from "@/lib/profile-identity";
const LightboxModal = dynamic(() => import("../../../LightboxModal"), { ssr: false });

const DEFAULT_BANNER_URL = "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1400&q=80";

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  created_at?: string;
  theme_settings?: ProfileAppearance | null;
  role?: string | null;
  muted_until?: string | null;
  voided_until?: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
};

type StatusState = {
  type: "success" | "error";
  text: string;
};

type FormState = {
  display_name: string;
  username: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
  background_color: string;
  text_color: string;
  highlight_color: string;
  font_style: FontStyle;
  youtube_urls: string[];
  show_music_player: boolean;
};

type PlaylistSong = {
  url: string;
  videoId: string;
  embedUrl: string;
  thumbnailUrl: string;
};

type ProfilePost = {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[] | null;
  likes: number;
  comments_count: number;
  is_for_sale: boolean;
  created_at: string;
};

type InteractionMap = Record<string, AggregatedPostInteraction>;

function normalizeUsername(value: string) {
  const decoded = decodeURIComponent(value || "").trim();
  const sanitized = sanitizeUsernameInput(decoded);
  if (sanitized) {
    return sanitized;
  }

  return decoded.toLowerCase().replace(/^@+/, "");
}

function isOwnRouteUsername(routeUsername: string, user: any) {
  return Boolean(
    user &&
      [user.id, user.user_metadata?.username, user.email]
        .filter(Boolean)
        .some(
          (value: string) =>
            normalizeUsername(value) === routeUsername ||
            sanitizeUsernameInput(value) === routeUsername
        )
  );
}

function stripCategoryTag(content: string | null) {
  if (!content) return "";
  return content.replace(/^\[(tutorial|new_boot_goofin|sold|unavailable)\]\s*/i, "").trim();
}

type FeedCategory = "all" | "following" | "tutorial" | "new_boot_goofin" | "for_sale" | "sold_unavailable";

function parsePostCategory(content: string | null): FeedCategory {
  const text = (content || "").toLowerCase();
  if (text.startsWith("[sold]") || text.startsWith("[unavailable]")) return "sold_unavailable";
  if (text.startsWith("[tutorial]")) return "tutorial";
  if (text.startsWith("[new_boot_goofin]")) return "new_boot_goofin";
  return "all";
}

function getCategoryMeta(content: string | null): { value: FeedCategory; label: string } | null {
  const category = parsePostCategory(content);
  if (category === "tutorial") return { value: "tutorial", label: "Tutorial" };
  if (category === "new_boot_goofin") return { value: "new_boot_goofin", label: "New Boot Goofin" };
  if (category === "sold_unavailable") {
    const text = (content || "").toLowerCase();
    return { value: "sold_unavailable", label: text.startsWith("[sold]") ? "Sold" : "No Longer Available" };
  }
  return null;
}

function formatPostDate(value: string) {
  return new Date(value).toLocaleString();
}

function displayAuthorName(displayName: string | null, username: string | null) {
  return displayName || username || "DyeSpace User";
}

function applyProfileThemeVars(element: HTMLElement | null, appearance?: ProfileAppearance | null) {
  if (!element) return;
  const resolved = resolveProfileAppearance(appearance);
  element.style.setProperty("--profile-text", resolved.text_color);
  element.style.setProperty("--profile-highlight", resolved.highlight_color);
}

const YOUTUBE_URL_REGEX = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractYoutubeVideoId(url: string) {
  const match = url.match(YOUTUBE_URL_REGEX);
  return match ? match[1] : null;
}

function normalizeYoutubeUrls(values: string[]) {
  const uniqueUrls = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const videoId = extractYoutubeVideoId(trimmed);
    if (!videoId) continue;
    uniqueUrls.add(`https://www.youtube.com/watch?v=${videoId}`);
    if (uniqueUrls.size >= 25) {
      break;
    }
  }

  return Array.from(uniqueUrls);
}

function buildPlaylist(urls: string[]): PlaylistSong[] {
  return normalizeYoutubeUrls(urls)
    .map((url) => {
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) return null;
      return {
        url,
        videoId,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      };
    })
    .filter((song): song is PlaylistSong => Boolean(song));
}

const PROFILE_LOAD_TIMEOUT_MS = 15000;
const PROFILE_INIT_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((result) => {
        window.clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function ProfileEditor() {
  // Lightbox state for image modal
  const [lightbox, setLightbox] = useState<{ open: boolean; url: string | null }>({ open: false, url: null });
  // Report modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const routeUsername = normalizeUsername(params?.username || "");
  const supabase = useMemo(() => createClient(), []);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<Pick<ProfileRow, "muted_until" | "voided_until" | "verified_badge" | "member_number" | "shadow_banned" | "shadow_banned_until"> | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowBusy, setIsFollowBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [form, setForm] = useState<FormState>({
    display_name: "",
    username: "",
    bio: "",
    avatar_url: null,
    banner_url: null,
    background_color: DEFAULT_BACKGROUND_COLOR,
    text_color: DEFAULT_TEXT_COLOR,
    highlight_color: DEFAULT_HIGHLIGHT_COLOR,
    font_style: DEFAULT_FONT_STYLE,
    youtube_urls: [],
    show_music_player: true,
  });
  const [draft, setDraft] = useState<FormState>({
    display_name: "",
    username: "",
    bio: "",
    avatar_url: null,
    banner_url: null,
    background_color: DEFAULT_BACKGROUND_COLOR,
    text_color: DEFAULT_TEXT_COLOR,
    highlight_color: DEFAULT_HIGHLIGHT_COLOR,
    font_style: DEFAULT_FONT_STYLE,
    youtube_urls: [],
    show_music_player: true,
  });
  const [editing, setEditing] = useState(false);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [interactions, setInteractions] = useState<InteractionMap>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [reactionPickerPostId, setReactionPickerPostId] = useState<string | null>(null);
  const [interactionBusyPostId, setInteractionBusyPostId] = useState<string | null>(null);
  const [songInput, setSongInput] = useState("");
  const [playerSong, setPlayerSong] = useState<PlaylistSong | null>(null);
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false);
  const [videoTitles, setVideoTitles] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<StatusState | null>(null);

  const applyProfileToForm = useCallback((profile: ProfileRow) => {
    const appearance = profile.theme_settings ?? null;
    const nextForm: FormState = {
      display_name: profile.display_name || "",
      username: profile.username || "",
      bio: profile.bio || "",
      avatar_url: profile.avatar_url || null,
      banner_url: profile.banner_url || null,
      background_color: appearance?.background_color || DEFAULT_BACKGROUND_COLOR,
      text_color: appearance?.text_color || DEFAULT_TEXT_COLOR,
      highlight_color: appearance?.highlight_color || DEFAULT_HIGHLIGHT_COLOR,
      font_style: normalizeFontStyle(appearance?.font_style),
      youtube_urls: normalizeYoutubeUrls(Array.isArray(appearance?.youtube_urls) ? appearance.youtube_urls : []),
      show_music_player: appearance?.show_music_player !== false,
    };
    setForm(nextForm);
    setDraft(nextForm);
  }, []);

  const applyThemeStyles = (element: HTMLDivElement | null, state: FormState) => {
    if (!element) return;
    element.style.setProperty("--profile-bg", state.background_color || DEFAULT_BACKGROUND_COLOR);
    element.style.setProperty("--profile-text", state.text_color || DEFAULT_TEXT_COLOR);
    element.style.setProperty("--profile-highlight", state.highlight_color || DEFAULT_HIGHLIGHT_COLOR);
  };

  const fetchProfileById = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at, role, muted_until, voided_until, verified_badge, member_number, shadow_banned, shadow_banned_until")
        .eq("id", userId)
        .limit(1)
        .maybeSingle<ProfileRow>();

      if (error) {
        throw error;
      }

      return data;
    },
    [supabase]
  );

  const fetchProfileByUsername = useCallback(
    async (username: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at, role, muted_until, voided_until, verified_badge, member_number, shadow_banned, shadow_banned_until")
        .eq("username", username)
        .limit(1)
        .maybeSingle<ProfileRow>();

      if (error) throw error;
      return data;
    },
    [supabase]
  );

  const loadOwnRole = useCallback(
    async (userId: string) => {
      try {
        const profile = await fetchProfileById(userId);
        setIsAdmin(profile?.role === "admin");
      } catch {
        setIsAdmin(false);
      }
    },
    [fetchProfileById]
  );

  const loadInteractions = useCallback(async (postIds: string[]) => {
    if (!postIds.length) {
      setInteractions({});
      return;
    }

    const response = await fetch(`/api/posts/interactions?postIds=${encodeURIComponent(postIds.join(","))}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Failed to load post interactions.");
    }

    const body = await response.json();
    setInteractions(body.interactionsByPostId || {});
  }, []);

  const loadPosts = useCallback(
    async (userId: string) => {
      setPostsLoading(true);
      try {
        const { data, error } = await supabase
          .from("posts")
          .select("id, user_id, content, image_urls, likes, comments_count, is_for_sale, created_at")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        if (error) {
          throw error;
        }

        const nextPosts = ((data || []) as ProfilePost[]).map((post) => {
          const imageUrls = normalizePostImageUrls(post.image_urls);
          return {
            ...post,
            image_urls: imageUrls.length ? imageUrls : null,
          };
        });
        setPosts(nextPosts);
        await loadInteractions(nextPosts.map((post) => post.id));
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : "Unable to load posts for this profile.",
        });
      } finally {
        setPostsLoading(false);
      }
    },
    [loadInteractions, supabase]
  );

  const fetchOrCreateOwnProfile = useCallback(
    async (user: any) => {
      const userId = user?.id;
      if (!userId) {
        return;
      }

      setProfileUserId(userId);
      setIsOwner(true);

      try {
        const existingProfile = await withTimeout(
          fetchProfileById(userId),
          PROFILE_LOAD_TIMEOUT_MS,
          "Profile lookup timed out. Please refresh and try again."
        );

        if (existingProfile) {
          applyProfileToForm(existingProfile);
          setIsAdmin(existingProfile.role === "admin");
          setProfileStatus({
            muted_until: existingProfile.muted_until ?? null,
            voided_until: existingProfile.voided_until ?? null,
            verified_badge: existingProfile.verified_badge ?? null,
            member_number: existingProfile.member_number ?? null,
            shadow_banned: existingProfile.shadow_banned ?? null,
            shadow_banned_until: existingProfile.shadow_banned_until ?? null,
          });
          return;
        }

        const res = await fetchWithTimeout("/api/profile/init", { method: "POST" }, PROFILE_INIT_TIMEOUT_MS);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "We could not initialize your profile yet. Please try again in a moment.");
        }

        const { profile: createdProfile } = await res.json();
        if (createdProfile) {
          applyProfileToForm(createdProfile as ProfileRow);
          setIsAdmin((createdProfile as ProfileRow)?.role === "admin");
          setProfileStatus({
            muted_until: (createdProfile as ProfileRow)?.muted_until ?? null,
            voided_until: (createdProfile as ProfileRow)?.voided_until ?? null,
            verified_badge: (createdProfile as ProfileRow)?.verified_badge ?? null,
            member_number: (createdProfile as ProfileRow)?.member_number ?? null,
            shadow_banned: (createdProfile as ProfileRow)?.shadow_banned ?? null,
            shadow_banned_until: (createdProfile as ProfileRow)?.shadow_banned_until ?? null,
          });
        }
      } catch (error: any) {
        const message = typeof error?.message === "string" ? error.message : "Could not load your profile right now. Please refresh and try again.";
        setStatus({
          type: "error",
          text: message,
        });
        setLoadError(message);
      }
    },
    [applyProfileToForm, fetchProfileById]
  );

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setStatus(null);

      const { data } = await withTimeout(
        supabase.auth.getSession(),
        PROFILE_LOAD_TIMEOUT_MS,
        "Unable to validate session. Please refresh and try again."
      );
      setSession(data.session);
      const sessionUser = data.session?.user;

      if (sessionUser?.id) {
        void loadOwnRole(sessionUser.id);
      } else {
        setIsAdmin(false);
      }

      if (!routeUsername) {
        throw new Error("Unable to determine profile route.");
      }

      const isOwnRoute = Boolean(
        sessionUser &&
          [sessionUser.id, sessionUser.user_metadata?.username, sessionUser.email]
            .filter(Boolean)
            .some(
              (value: string) =>
                normalizeUsername(value) === routeUsername ||
                sanitizeUsernameInput(value) === routeUsername
            )
      );

      if (isOwnRoute && sessionUser) {
        await fetchOrCreateOwnProfile(sessionUser);
        return;
      }

      setIsOwner(false);
      const viewedProfile = await withTimeout(
        fetchProfileByUsername(routeUsername),
        PROFILE_LOAD_TIMEOUT_MS,
        "Unable to load this profile. Please refresh and try again."
      );
      if (!viewedProfile) {
        throw new Error("Profile not found.");
      }
      setProfileUserId(viewedProfile.id);
      if (sessionUser?.id && viewedProfile.id === sessionUser.id) {
        setIsOwner(true);
      }
      setProfileStatus({
        muted_until: viewedProfile.muted_until ?? null,
        voided_until: viewedProfile.voided_until ?? null,
        verified_badge: viewedProfile.verified_badge ?? null,
        member_number: viewedProfile.member_number ?? null,
        shadow_banned: viewedProfile.shadow_banned ?? null,
        shadow_banned_until: viewedProfile.shadow_banned_until ?? null,
      });
      applyProfileToForm(viewedProfile);
    } catch (error: any) {
      console.error("Failed to load profile:", error);
      const message =
        error?.name === "AbortError"
          ? "Profile load timed out. Please refresh and try again."
          : typeof error?.message === "string"
          ? error.message
          : "Unable to load this profile.";
      setLoadError(message);
      setStatus({ type: "error", text: message });
    } finally {
      setLoading(false);
    }
  }, [applyProfileToForm, fetchOrCreateOwnProfile, fetchProfileByUsername, loadOwnRole, routeUsername, supabase]);

  useEffect(() => {
    void loadProfile();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        return;
      }

      if (nextSession) {
        setSession(nextSession);
        if (nextSession.user?.id) {
          void loadOwnRole(nextSession.user.id);
        }
      }

      if (nextSession?.user && isOwnRouteUsername(routeUsername, nextSession.user)) {
        await fetchOrCreateOwnProfile(nextSession.user);
      }
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [applyProfileToForm, fetchOrCreateOwnProfile, fetchProfileByUsername, loadOwnRole, loadProfile, routeUsername, supabase]);

  useEffect(() => {
    const visibleState = editing ? draft : form;
    applyThemeStyles(viewRef.current, visibleState);
  }, [draft, editing, form]);

  useEffect(() => {
    applyThemeStyles(previewRef.current, draft);
  }, [draft]);

  useEffect(() => {
    const loadFollowState = async () => {
      if (!session?.user?.id || !profileUserId || isOwner) {
        setIsFollowing(false);
        return;
      }

      try {
        const response = await fetch(`/api/profile/follow?targetUserId=${encodeURIComponent(profileUserId)}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          setIsFollowing(Boolean(body?.isFollowing));
        }
      } catch {
        setIsFollowing(false);
      }
    };

    void loadFollowState();
  }, [isOwner, profileUserId, session?.user?.id]);

  useEffect(() => {
    if (!profileUserId) {
      setPosts([]);
      setInteractions({});
      return;
    }

    void loadPosts(profileUserId);
  }, [loadPosts, profileUserId]);

  const ensureProfileBuckets = useCallback(async () => {
    const response = await fetch("/api/storage/profile-buckets", { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Storage is not ready for uploads right now.");
    }
  }, []);

  const saveProfile = useCallback(
    async (payloadState: FormState, successText?: string, signal?: AbortSignal) => {
      const userId = session?.user?.id || profileUserId;

      if (!userId) {
        throw new Error("Please sign in again before saving your profile.");
      }

      const payload = {
        id: userId,
        username: payloadState.username,
        display_name: payloadState.display_name,
        bio: payloadState.bio,
        avatar_url: payloadState.avatar_url,
        banner_url: payloadState.banner_url,
        background_color: payloadState.background_color,
        text_color: payloadState.text_color,
        highlight_color: payloadState.highlight_color,
        font_style: payloadState.font_style,
        youtube_urls: payloadState.youtube_urls,
        show_music_player: payloadState.show_music_player,
      };

      const saveRes = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!saveRes.ok) {
        const body = await saveRes.json().catch(() => ({}));
        throw new Error(body?.error || "We could not save your profile. Please try again.");
      }

      const refreshedProfile = await fetchProfileById(userId);
      if (refreshedProfile) {
        applyProfileToForm(refreshedProfile);
      }

      setProfileUserId(userId);
      setStatus({
        type: "success",
        text: successText || "Profile changes saved successfully.",
      });
      return refreshedProfile;
    },
    [applyProfileToForm, fetchProfileById, profileUserId, session?.user?.id]
  );

  const uploadMediaAndSetDraft = useCallback(
    async (
      file: File,
      options: {
        bucket: "avatars" | "banners";
        field: "avatar_url" | "banner_url";
        successText: string;
        errorText: string;
      }
    ) => {
      const userId = session?.user?.id || profileUserId;

      if (!userId) {
        setStatus({
          type: "error",
          text: "Please sign in again before uploading an image.",
        });
        return;
      }

      setIsUploading(true);
      setStatus(null);

      try {
        await ensureProfileBuckets();

        const fileExt = file.name.split(".").pop() || "png";
        const fileName = `${userId}-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from(options.bucket)
          .upload(fileName, file, { upsert: true, contentType: file.type || undefined });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from(options.bucket).getPublicUrl(fileName);

        const nextDraft = {
          ...draft,
          [options.field]: publicUrl,
        };

        setDraft(nextDraft);
        await saveProfile(nextDraft, options.successText);
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : options.errorText,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [draft, ensureProfileBuckets, profileUserId, saveProfile, session?.user?.id, supabase.storage]
  );

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadMediaAndSetDraft(file, {
        bucket: "avatars",
        field: "avatar_url",
        successText: "Avatar uploaded successfully.",
        errorText: "Failed to upload avatar. Please try again.",
      });
    }
    e.target.value = "";
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadMediaAndSetDraft(file, {
        bucket: "banners",
        field: "banner_url",
        successText: "Banner uploaded successfully.",
        errorText: "Failed to upload banner. Please try again.",
      });
    }
    e.target.value = "";
  };

  const openEditor = () => {
    setDraft(form);
    setSongInput("");
    setIsSaving(false);
    setEditing(true);
  };

  const addSongsToDraft = () => {
    const rawCandidates = songInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!rawCandidates.length) {
      setStatus({ type: "error", text: "Please paste at least one YouTube URL." });
      return;
    }

    const normalized = normalizeYoutubeUrls(rawCandidates);
    if (!normalized.length) {
      setStatus({ type: "error", text: "Only valid YouTube video links can be added." });
      return;
    }

    setDraft((prev) => ({
      ...prev,
      youtube_urls: normalizeYoutubeUrls([...(prev.youtube_urls || []), ...normalized]),
    }));
    setSongInput("");
    setStatus({ type: "success", text: `${normalized.length} song${normalized.length > 1 ? "s" : ""} added.` });
  };

  const removeSongFromDraft = (url: string) => {
    setDraft((prev) => ({
      ...prev,
      youtube_urls: (prev.youtube_urls || []).filter((value) => value !== url),
    }));
  };

  const handleFollowToggle = async () => {
    if (!profileUserId) return;
    if (!session?.user) {
      setStatus({ type: "error", text: "Please sign in to follow artists." });
      return;
    }

    setIsFollowBusy(true);
    try {
      const response = await fetch("/api/profile/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: profileUserId,
          action: isFollowing ? "unfollow" : "follow",
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body?.error || "Failed to update follow status.");
      }

      setIsFollowing(Boolean(body?.isFollowing));
    } catch (error: any) {
      setStatus({
        type: "error",
        text: typeof error?.message === "string" ? error.message : "Failed to update follow status.",
      });
    } finally {
      setIsFollowBusy(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    try {
      const nextUsername = resolveProfileUsername(draft.username, form.username, session?.user?.email, session?.user?.id);
      const refreshedProfile = await saveProfile(
        { ...draft, username: nextUsername },
        "Profile changes saved successfully.",
        controller.signal
      );
      setEditing(false);
      const savedUsername = resolveProfileUsername(refreshedProfile?.username, nextUsername);
      if (savedUsername && routeUsername !== savedUsername) {
        router.replace(`/profile/${encodeURIComponent(savedUsername)}`);
      }
    } catch (error: any) {
      setStatus({
        type: "error",
        text:
          error?.name === "AbortError"
            ? "Save request timed out. Please try again."
            : typeof error?.message === "string"
              ? error.message
              : "We could not save your profile. Please try again.",
      });
    } finally {
      window.clearTimeout(timeoutId);
      setIsSaving(false);
    }
  };

  const updatePostCounters = useCallback((postId: string, updates: Partial<Pick<ProfilePost, "likes" | "comments_count">>) => {
    setPosts((prev) => prev.map((post) => (post.id === postId ? { ...post, ...updates } : post)));
  }, []);

  const handleReactionSelect = useCallback(
    async (postId: string, emoji: ReactionEmoji) => {
      if (!session?.user) {
        setStatus({ type: "error", text: "Please sign in to react to posts." });
        return;
      }

      setInteractionBusyPostId(postId);
      try {
        const response = await fetch("/api/posts/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, emoji }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || "Failed to save reaction.");
        }

        setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
        updatePostCounters(postId, { likes: body.likesCount ?? 0 });
        setReactionPickerPostId(null);
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : "Failed to save reaction.",
        });
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [session?.user, updatePostCounters]
  );

  const handleCommentSubmit = useCallback(
    async (postId: string) => {
      if (!session?.user) {
        setStatus({ type: "error", text: "Please sign in to comment on posts." });
        return;
      }

      const content = commentDrafts[postId]?.trim();
      if (!content) {
        return;
      }

      setInteractionBusyPostId(postId);
      try {
        const response = await fetch("/api/posts/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, content }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || "Failed to save comment.");
        }

        setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
        updatePostCounters(postId, { comments_count: body.commentsCount ?? 0 });
        setCommentDrafts((prev) => ({ ...prev, [postId]: "" }));
        setExpandedComments((prev) => ({ ...prev, [postId]: true }));
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : "Failed to save comment.",
        });
      } finally {
        setInteractionBusyPostId(null);
      }
    },
    [commentDrafts, session?.user, updatePostCounters]
  );

  const handleDeletePost = useCallback(async (postId: string) => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    const res = await fetch(`/api/posts/manage?postId=${encodeURIComponent(postId)}`, { method: "DELETE" });
    if (res.ok) {
      setPosts((prev) => prev.filter((post) => post.id !== postId));
      setInteractions((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    } else {
      setStatus({ type: "error", text: "Could not delete post. Please try again." });
    }
  }, []);

  const handleDeleteComment = useCallback(async (commentId: string, postId: string) => {
    if (!confirm("Delete this comment?")) return;
    const res = await fetch(`/api/posts/comments?commentId=${encodeURIComponent(commentId)}&postId=${encodeURIComponent(postId)}`, { method: "DELETE" });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      setInteractions((prev) => ({ ...prev, [postId]: body.interaction }));
      updatePostCounters(postId, { comments_count: body.commentsCount ?? 0 });
    } else {
      setStatus({ type: "error", text: "Could not delete comment. Please try again." });
    }
  }, [updatePostCounters]);

  const handleAdminAction = useCallback(
    async (targetUserId: string, action: AdminActionName, durationHours?: number) => {
      if (!session?.user) {
        setStatus({ type: "error", text: "Please sign in as an admin to perform this action." });
        return;
      }

      setStatus(null);
      try {
        const body = await runAdminUserAction({ targetUserId, action, durationHours });
        setStatus({ type: "success", text: body?.message || "Admin action applied successfully." });
        await loadProfile();
        await loadInteractions(posts.map((post) => post.id));
      } catch (error: any) {
        setStatus({ type: "error", text: typeof error?.message === "string" ? error.message : "Admin action failed." });
      }
    },
    [loadInteractions, loadProfile, posts, session?.user]
  );

  const profileDisplay = editing ? draft : form;
  const profileMutedUntil = profileStatus?.muted_until ? new Date(profileStatus.muted_until) : null;
  const profileIsMuted = Boolean(profileMutedUntil && profileMutedUntil > new Date());
  const profileVoidedUntil = profileStatus?.voided_until ? new Date(profileStatus.voided_until) : null;
  const profileIsVoided = Boolean(profileVoidedUntil && profileVoidedUntil > new Date());
  const profileIsVerified = profileStatus?.verified_badge === true;
  const profileShadowBannedUntil = profileStatus?.shadow_banned_until ? new Date(profileStatus.shadow_banned_until) : null;
  const profileIsShadowBanned = Boolean(
    profileStatus?.shadow_banned || (profileShadowBannedUntil && profileShadowBannedUntil > new Date())
  );
  const typedUsername = sanitizeUsernameInput(draft.username);
  const usernameSavePreview = resolveProfileUsername(draft.username, form.username, session?.user?.email, session?.user?.id);
  const isUsernameFallback = typedUsername.length < 3 && usernameSavePreview !== typedUsername;
  const playlistSongs = useMemo(() => buildPlaylist(profileDisplay.youtube_urls || []), [profileDisplay.youtube_urls]);

  useEffect(() => {
    const uncachedSongs = playlistSongs.filter((song) => !videoTitles[song.videoId]).slice(0, 8);
    if (!uncachedSongs.length) {
      return;
    }

    let active = true;

    const fetchTitles = async () => {
      for (const song of uncachedSongs) {
        try {
          const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(song.url)}&format=json`);
          if (!response.ok) continue;
          const body = await response.json();
          const title = typeof body?.title === "string" ? body.title : "YouTube Track";
          if (active) {
            setVideoTitles((prev) => ({ ...prev, [song.videoId]: title }));
          }
        } catch {
          // Keep playlist usable even if title lookup fails.
        }
      }
    };

    void fetchTitles();

    return () => {
      active = false;
    };
  }, [playlistSongs, videoTitles]);

  return (
    <div className="min-h-screen px-4 pb-16 pt-8 text-white sm:px-8 sm:pt-10" aria-label="Profile Customization Hub">
      <div className="mx-auto max-w-6xl">
        {status ? (
          <div
            className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur-xl ${
              status.type === "success"
                ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                : "border-rose-300/30 bg-rose-500/15 text-rose-100"
            }`}
          >
            {status.text}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[2rem] border border-cyan-300/20 bg-slate-950/45 p-8 text-cyan-100 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            Loading profile...
          </div>
        ) : loadError ? (
          <div className="rounded-[2rem] border border-rose-300/20 bg-rose-950/55 p-8 text-rose-100 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <h2 className="mb-3 text-2xl font-bold text-rose-100">Profile could not be loaded</h2>
            <p className="mb-4 text-sm text-rose-200">{loadError}</p>
            <button
              type="button"
              className="inline-flex items-center rounded-full border border-rose-300/40 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/25 transition"
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                setStatus(null);
                void loadProfile();
              }}
            >
              Retry loading
            </button>
          </div>
        ) : (
          <>
            {playlistSongs.length > 0 ? (
              <section className="mb-10">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">Music</p>
                    <h2 className="mt-2 flex items-center gap-2 text-3xl font-bold text-cyan-50">
                      <Music2 className="h-7 w-7 text-cyan-300" />
                      Playlist
                    </h2>
                  </div>
                  <div className="rounded-full border border-cyan-300/20 bg-slate-950/45 px-4 py-2 text-sm text-cyan-100/80 backdrop-blur-xl">
                    {playlistSongs.length} {playlistSongs.length === 1 ? "song" : "songs"}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {playlistSongs.map((song, index) => (
                    <article key={song.videoId} className="rounded-[1.5rem] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(9,19,37,0.82),rgba(7,12,24,0.88))] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                      <div className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-black/25">
                        {playerSong?.videoId === song.videoId && !isPlayerExpanded ? (
                          <iframe
                            src={song.embedUrl}
                            title={videoTitles[song.videoId] || "YouTube video player"}
                            className="aspect-video w-full"
                            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                            loading="lazy"
                            referrerPolicy="strict-origin-when-cross-origin"
                          />
                        ) : (
                          <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-slate-900 sm:h-52">
                            <Image
                              src={song.thumbnailUrl}
                              alt="YouTube thumbnail"
                              className="object-cover"
                              loading="lazy"
                              fill
                              unoptimized
                            />
                          </div>
                        )}
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-cyan-50">
                        {videoTitles[song.videoId] || `YouTube Track ${index + 1}`}
                      </h3>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
                          onClick={() => {
                            setPlayerSong(song);
                            setIsPlayerExpanded(false);
                          }}
                        >
                          <PlayCircle className="h-4 w-4" />
                          {playerSong?.videoId === song.videoId ? "Playing" : "Play"}
                        </button>
                        {playerSong?.videoId === song.videoId ? (
                          <>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 transition hover:bg-white/20"
                              onClick={() => setPlayerSong(null)}
                            >
                              Stop
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/35 bg-slate-950/45 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-slate-900/70"
                              onClick={() => setIsPlayerExpanded(true)}
                            >
                              <Maximize2 className="h-4 w-4" />
                              Expand
                            </button>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section
              ref={viewRef}
              className={`relative isolate overflow-hidden rounded-[2rem] border border-cyan-300/25 shadow-[0_25px_90px_rgba(0,0,0,0.45)] ${fontClass(profileDisplay.font_style)}`}
            >
              <Image
                src={profileDisplay.banner_url || DEFAULT_BANNER_URL}
                alt="Profile banner"
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
                draggable={false}
                fill
                priority
                sizes="100vw"
                unoptimized
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(68,249,207,0.20),transparent_35%),linear-gradient(180deg,rgba(4,10,22,0.10)_0%,rgba(5,10,20,0.28)_32%,rgba(3,8,18,0.82)_100%)]" />
              <div className="absolute inset-0 bg-black/20" />

              <div className="absolute right-5 top-5 z-20 flex gap-3">
                {isOwner && (
                  <Link
                    href="/create"
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-300/70 bg-black/45 px-5 py-2 text-sm font-semibold text-cyan-100 shadow-lg backdrop-blur-md transition hover:scale-[1.02] hover:bg-black/60"
                  >
                    <SquarePen className="h-4 w-4" />
                    Create Post
                  </Link>
                )}
                {isOwner && !editing && (
                  <button
                    className="rounded-full border border-[color:var(--profile-highlight)]/70 bg-black/45 px-5 py-2 text-sm font-semibold text-[color:var(--profile-highlight)] shadow-lg backdrop-blur-md transition hover:scale-[1.02] hover:bg-black/60"
                    onClick={openEditor}
                    type="button"
                  >
                    Edit Profile
                  </button>
                )}
                {!isOwner && profileDisplay.username && (
                  <button
                    className="rounded-full border border-cyan-300/70 bg-black/45 px-5 py-2 text-sm font-semibold text-cyan-100 shadow-lg backdrop-blur-md transition hover:scale-[1.02] hover:bg-black/60 disabled:opacity-60"
                    onClick={() => void handleFollowToggle()}
                    type="button"
                    disabled={isFollowBusy}
                  >
                    {isFollowBusy ? "Saving..." : isFollowing ? "Following" : "Follow"}
                  </button>
                )}
                {!isOwner && profileDisplay.username && (
                  <button
                    className="rounded-full border border-pink-400/70 bg-black/45 px-5 py-2 text-sm font-semibold text-pink-300 shadow-lg backdrop-blur-md transition hover:scale-[1.02] hover:bg-black/60"
                    onClick={() => setReportOpen(true)}
                    type="button"
                  >
                    Report User
                  </button>
                )}
              </div>
      {/* Report User Modal */}
      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} className="fixed z-[1001] inset-0 flex items-center justify-center">
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" onClick={() => setReportOpen(false)} />
        <Dialog.Panel className="relative z-10 w-full max-w-md rounded-2xl bg-gradient-to-br from-slate-900 via-black to-cyan-950 p-8 border-2 border-pink-400 shadow-2xl cosmic-glow">
          <Dialog.Title className="text-2xl font-bold text-pink-300 mb-4">Report @{profileDisplay.username}</Dialog.Title>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setReportStatus(null);
              if (!reportReason.trim()) {
                setReportStatus("Please provide a reason for your report.");
                return;
              }
              try {
                const { data: sessionData } = await supabase.auth.getSession();
                const reporter_id = sessionData.session?.user?.id;
                if (!reporter_id) {
                  setReportStatus("You must be signed in to report a user.");
                  return;
                }
                const { error } = await supabase.from("reports").insert({
                  reporter_id,
                  reported_user_id: profileUserId,
                  reason: reportReason.trim(),
                });
                if (error) {
                  setReportStatus("Failed to submit report. Please try again.");
                } else {
                  setReportStatus("Report submitted. Thank you for helping keep TheDyeSpace safe.");
                  setReportReason("");
                  setTimeout(() => setReportOpen(false), 1800);
                }
              } catch {
                setReportStatus("Failed to submit report. Please try again.");
              }
            }}
          >
            <label className="block mb-4">
              <span className="text-cyan-200">Reason for report <span className="text-pink-400">*</span></span>
              <textarea
                className="mt-2 w-full rounded-xl bg-slate-800 text-white p-3 border border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-400"
                rows={4}
                required
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
              />
            </label>
            {reportStatus && <div className="mb-3 text-pink-300 font-semibold animate-pulse">{reportStatus}</div>}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-gray-700 text-cyan-100 hover:bg-gray-800"
                onClick={() => setReportOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2 rounded-lg bg-pink-500 text-white font-bold hover:bg-pink-600 shadow-lg"
              >
                Submit Report
              </button>
            </div>
          </form>
        </Dialog.Panel>
      </Dialog>

              <div className="relative flex min-h-[280px] items-start px-4 pb-5 pt-16 sm:min-h-[360px] sm:px-10 sm:pb-8 sm:pt-24">
                <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
                  <div className="relative shrink-0">
                    <div className="h-28 w-28 overflow-hidden rounded-full border-4 border-cyan-200/70 bg-slate-950 shadow-[0_0_40px_rgba(68,249,207,0.42),0_0_100px_rgba(97,67,255,0.20)] sm:h-32 sm:w-32">
                      {profileDisplay.avatar_url ? (
                        <Image src={profileDisplay.avatar_url} alt="Avatar" className="h-full w-full object-cover" loading="lazy" width={128} height={128} unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-cyan-100">TD</div>
                      )}
                    </div>
                  </div>

                  <div className="max-w-3xl pt-1 text-left text-white">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--profile-highlight)]/90 sm:text-xs sm:tracking-[0.45em]">The Dye Space Profile</p>
                    <div className="mt-2">
                      <UserIdentity
                        displayName={profileDisplay.display_name || "Untitled Profile"}
                        username={profileDisplay.username || null}
                        verifiedBadge={profileIsVerified}
                        memberNumber={profileStatus?.member_number ?? null}
                        className="min-w-0"
                        nameClassName="text-2xl font-black leading-tight text-[color:var(--profile-text)] drop-shadow-[0_0_18px_rgba(0,0,0,0.6)] hover:text-[color:var(--profile-text)] sm:text-5xl"
                        usernameClassName="mt-1 text-sm font-medium text-[color:var(--profile-highlight)] drop-shadow-[0_0_12px_rgba(0,0,0,0.55)] sm:text-lg"
                        metaClassName="text-xs text-[color:var(--profile-text)]/70"
                      />
                    </div>
                    <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-[color:var(--profile-text)]/92 drop-shadow-[0_0_18px_rgba(0,0,0,0.55)] sm:text-base">
                      {profileDisplay.bio || "No bio yet."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {profileIsMuted ? (
                        <span className="inline-flex items-center rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100">
                          Muted until {profileMutedUntil?.toLocaleString()}
                        </span>
                      ) : null}
                      {profileIsVoided ? (
                        <span className="inline-flex items-center rounded-full border border-violet-300/40 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-100">
                          Sent to the Void until {profileVoidedUntil?.toLocaleString()}
                        </span>
                      ) : null}
                      {profileIsVerified ? (
                        <span className="inline-flex items-center rounded-full border border-sky-300/40 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100">
                          Verified Badge Active
                        </span>
                      ) : null}
                    </div>
                    {isAdmin && !isOwner && profileUserId ? (
                      <div className="mt-4">
                        <AdminActionMenu targetUserId={profileUserId} onAction={handleAdminAction} label="Admin Tools" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-10">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">Gallery</p>
                  <h2 className="mt-2 text-3xl font-bold text-cyan-50">Posts</h2>
                </div>
                <div className="rounded-full border border-cyan-300/20 bg-slate-950/45 px-4 py-2 text-sm text-cyan-100/80 backdrop-blur-xl">
                  {posts.length} {posts.length === 1 ? "post" : "posts"}
                </div>
              </div>

              {postsLoading ? (
                <div className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/45 p-8 text-cyan-100 shadow-xl backdrop-blur-xl">
                  Loading posts...
                </div>
              ) : (profileIsVoided || profileIsShadowBanned) && !isAdmin && !isOwner ? (
                <div className="rounded-[1.75rem] border border-violet-300/20 bg-violet-950/45 p-8 text-violet-100 shadow-xl backdrop-blur-xl">
                  This user is currently hidden from public discovery. Their posts are not visible right now.
                </div>
              ) : posts.length === 0 ? (
                <div className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/45 p-8 text-cyan-100/75 shadow-xl backdrop-blur-xl">
                  No posts yet.
                </div>
              ) : (
                <div className="space-y-6">
                  {posts.map((post) => {
                    const postInteraction = interactions[post.id] || { comments: [], reactions: [], viewerReaction: null };
                    const isCommentsOpen = Boolean(expandedComments[post.id]);
                    const isBusy = interactionBusyPostId === post.id;
                    const categoryMeta = getCategoryMeta(post.content);

                    return (
                      <article
                        key={post.id}
                        className={`rounded-[1.5rem] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(9,19,37,0.82),rgba(7,12,24,0.88))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-cyan-300/35 sm:rounded-[1.75rem] sm:p-6 ${fontClass(profileDisplay.font_style)}`}
                        ref={(element) => applyProfileThemeVars(element, profileDisplay)}
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm text-[color:var(--profile-text)]/70">{formatPostDate(post.created_at)}</p>
                            <UserIdentity
                              displayName={profileDisplay.display_name}
                              username={profileDisplay.username}
                              verifiedBadge={profileIsVerified}
                              memberNumber={profileStatus?.member_number ?? null}
                              className="mt-2"
                              nameClassName="font-semibold text-[color:var(--profile-text)] hover:text-[color:var(--profile-highlight)] hover:underline"
                              usernameClassName="text-xs text-[color:var(--profile-highlight)]/80 hover:text-[color:var(--profile-highlight)] hover:underline"
                              metaClassName="text-xs text-[color:var(--profile-text)]/55"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              {post.is_for_sale ? (
                                <span className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                                  For Sale
                                </span>
                              ) : null}
                              {categoryMeta ? (
                                <Link
                                  href={`/explore?tab=${encodeURIComponent(categoryMeta.value)}`}
                                  className="inline-flex rounded-full border border-cyan-300/45 bg-cyan-300/15 px-3 py-1 text-xs font-semibold text-cyan-100 hover:border-cyan-200/70 hover:bg-cyan-300/30"
                                >
                                  {categoryMeta.label}
                                </Link>
                              ) : null}
                            </div>
                          </div>
                          <div className="rounded-full border border-cyan-300/20 bg-black/25 px-3 py-1 text-xs text-[color:var(--profile-text)]/75">
                            {post.likes} reactions • {post.comments_count} comments
                          </div>
                        </div>

                        {(isOwner || isAdmin) ? (
                          <div className="mt-4 flex justify-end items-center gap-2">
                            <button
                              type="button"
                              className="rounded-full border border-rose-300/25 bg-black/20 px-4 py-2 text-xs text-rose-300 hover:bg-rose-900/30 transition"
                              onClick={() => void handleDeletePost(post.id)}
                            >
                              Delete
                            </button>
                            {isAdmin && !isOwner ? <AdminActionMenu targetUserId={post.user_id} onAction={handleAdminAction} /> : null}
                          </div>
                        ) : null}

                        <InlineEmojiText
                          text={stripCategoryTag(post.content) || "No description provided."}
                          className="mt-4 block whitespace-pre-wrap text-base leading-7 text-[color:var(--profile-text)]/92 sm:text-lg sm:leading-8"
                        />

                        {post.image_urls && post.image_urls.length > 0 ? (
                          <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            {post.image_urls.map((imageUrl, imageIndex) => (
                              <button key={`${post.id}-${imageIndex}`} type="button" className="group relative aspect-[4/5] w-full overflow-hidden rounded-[1.5rem] cursor-zoom-in sm:aspect-square" onClick={(e) => {
                                e.stopPropagation();
                                setLightbox({ open: true, url: imageUrl });
                              }}>
                                <Image
                                  src={imageUrl}
                                  alt={`Post image ${imageIndex + 1}`}
                                  className="absolute inset-0 h-full w-full border border-cyan-300/20 object-cover shadow-lg transition duration-200 group-hover:scale-105"
                                  loading="lazy"
                                  tabIndex={0}
                                  fill
                                  unoptimized
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent px-3 py-4 text-left text-xs text-cyan-50/85 sm:text-sm">Tap to expand</div>
                              </button>
                            ))}
                          </div>
                        ) : null}
  {lightbox.open && lightbox.url && (
    <LightboxModal imageUrl={lightbox.url} onClose={() => setLightbox({ open: false, url: null })} />
  )}

                        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-cyan-300/10 pt-4">
                          <div className="relative">
                            {session?.user ? (
                              <>
                                <button
                                  className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/25 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/40"
                                  type="button"
                                  onClick={() => setReactionPickerPostId((current) => (current === post.id ? null : post.id))}
                                >
                                  <Heart className="h-4 w-4" />
                                  <span>{postInteraction.viewerReaction ? `Reacted ${postInteraction.viewerReaction}` : "React"}</span>
                                </button>
                                {reactionPickerPostId === post.id ? (
                                  <div className="absolute right-0 top-full z-20 mt-2 flex max-w-[calc(100vw-3rem)] flex-wrap gap-2 rounded-2xl border border-cyan-300/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl sm:left-0 sm:right-auto sm:max-w-none">
                                    {REACTION_EMOJIS.map((emoji) => (
                                      <button
                                        key={emoji}
                                        className={`rounded-full px-3 py-2 text-lg transition hover:scale-110 ${postInteraction.viewerReaction === emoji ? "bg-cyan-400/20" : "bg-black/30"}`}
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => void handleReactionSelect(post.id, emoji)}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <Link
                                href="/login"
                                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/25 px-4 py-2 text-sm italic text-cyan-300/80 transition hover:border-cyan-300/40 hover:bg-black/40"
                              >
                                <Heart className="h-4 w-4" />
                                <span>Sign in to react</span>
                              </Link>
                            )}
                          </div>

                          <button
                            className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/25 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/40"
                            type="button"
                            onClick={() => setExpandedComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
                          >
                            <MessageCircle className="h-4 w-4" />
                            <span>{isCommentsOpen ? "Hide Comments" : "Comments"}</span>
                          </button>
                        </div>

                        {postInteraction.reactions.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {postInteraction.reactions.map((reaction) => (
                              <button
                                key={`${post.id}-${reaction.emoji}`}
                                type="button"
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition ${
                                  reaction.reacted
                                    ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-50"
                                    : "border-cyan-300/20 bg-black/20 text-cyan-100/85"
                                } ${!session?.user ? "cursor-default opacity-80" : "hover:border-cyan-300/40"}`}
                                onClick={() => session?.user ? void handleReactionSelect(post.id, reaction.emoji) : undefined}
                                disabled={isBusy || !session?.user}
                              >
                                <span>{reaction.emoji}</span>
                                <span>{reaction.count}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {isCommentsOpen ? (
                          <div className="mt-5 rounded-[1.5rem] border border-cyan-300/15 bg-black/20 p-4 backdrop-blur-xl sm:p-5">
                            <div className="space-y-4">
                              {postInteraction.comments.length === 0 ? (
                                <p className="text-sm text-cyan-100/65">No comments yet. Start the conversation.</p>
                              ) : (
                                postInteraction.comments.map((comment) => (
                                  <div key={comment.id} className="rounded-2xl border border-cyan-300/10 bg-slate-950/55 p-4">
                                    <div className="flex items-start gap-3">
                                      <div className="h-10 w-10 overflow-hidden rounded-full border border-cyan-300/25 bg-slate-900">
                                        {comment.author.avatar_url ? (
                                          <Image src={comment.author.avatar_url} alt="Comment author" className="h-full w-full object-cover" loading="lazy" width={40} height={40} unoptimized />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">TD</div>
                                        )}
                                      </div>
                                      <div
                                        className={`min-w-0 flex-1 ${fontClass(comment.author.theme_settings?.font_style)}`}
                                        ref={(element) => applyProfileThemeVars(element, comment.author.theme_settings)}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <UserIdentity
                                            displayName={displayAuthorName(comment.author.display_name, comment.author.username)}
                                            username={comment.author.username}
                                            verifiedBadge={comment.author.verified_badge}
                                            memberNumber={comment.author.member_number}
                                            timestampText={formatPostDate(comment.created_at)}
                                            className="min-w-0"
                                            nameClassName="font-semibold text-[color:var(--profile-text)] hover:text-[color:var(--profile-highlight)] hover:underline"
                                            usernameClassName="text-xs text-[color:var(--profile-highlight)]/80 hover:text-[color:var(--profile-highlight)] hover:underline"
                                            metaClassName="text-xs text-[color:var(--profile-text)]/55"
                                          />
                                          {isAdmin && session?.user?.id !== comment.author.id ? <AdminActionMenu targetUserId={comment.author.id} onAction={handleAdminAction} label="Admin Tools" /> : null}
                                        </div>
                                        <InlineEmojiText
                                          text={comment.content}
                                          className="mt-2 block whitespace-pre-wrap text-[color:var(--profile-text)]/90"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>

                            {session?.user ? (
                              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                                <textarea
                                  className="min-h-24 flex-1 rounded-2xl border border-cyan-300/20 bg-slate-950/75 px-4 py-3 text-white outline-none transition focus:border-cyan-300/50"
                                  placeholder="Add a comment"
                                  value={commentDrafts[post.id] || ""}
                                  onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                                />
                                <EmojiPicker
                                  className="sm:self-end"
                                  onSelect={(emojiOrToken) =>
                                    setCommentDrafts((prev) => ({
                                      ...prev,
                                      [post.id]: appendEmojiToText(prev[post.id] || "", emojiOrToken),
                                    }))
                                  }
                                />
                                <button
                                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
                                  type="button"
                                  onClick={() => void handleCommentSubmit(post.id)}
                                  disabled={isBusy || !(commentDrafts[post.id] || "").trim()}
                                >
                                  <Send className="h-4 w-4" />
                                  <span>{isBusy ? "Posting..." : "Post Comment"}</span>
                                </button>
                              </div>
                            ) : (
                              <p className="mt-5 text-sm text-cyan-100/65">Sign in to leave a comment.</p>
                            )}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {editing && isOwner ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-cyan-300/30 bg-transparent p-6 shadow-2xl backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-cyan-100">Edit Profile</h2>
                <button
                  className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                  onClick={() => {
                    setDraft(form);
                    setIsSaving(false);
                    setEditing(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>



              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm text-cyan-100">Display Name</span>
                  <input
                    className="w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
                    value={draft.display_name}
                    onChange={(e) => setDraft((prev) => ({ ...prev, display_name: e.target.value }))}
                    placeholder="Your display name"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm text-cyan-100">Username / @name</span>
                  <input
                    className="w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
                    value={draft.username}
                    onChange={(e) => setDraft((prev) => ({ ...prev, username: sanitizeUsernameInput(e.target.value) }))}
                    placeholder="your-name"
                  />
                  <p className={`mt-2 text-xs ${isUsernameFallback ? "text-rose-200" : "text-cyan-100/85"}`}>
                    Will save as: <span className={`font-semibold ${isUsernameFallback ? "text-rose-300" : "text-cyan-200"}`}>@{usernameSavePreview}</span>
                  </p>
                  {isUsernameFallback ? (
                    <p className="mt-1 text-xs text-rose-200/90">Username must be at least 3 characters. Save will use your current/fallback username.</p>
                  ) : null}
                  <p className="mt-2 text-xs text-cyan-100/60">Letters, numbers, dots, underscores, and dashes only.</p>
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm text-cyan-100">Bio</span>
                  <textarea
                    className="min-h-28 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
                    value={draft.bio}
                    onChange={(e) => setDraft((prev) => ({ ...prev, bio: e.target.value }))}
                    placeholder="Share something about yourself"
                  />
                </label>

                <div className="sm:col-span-2 rounded-2xl border border-cyan-300/20 bg-black/25 p-4">
                  <div className="mb-3 flex items-center gap-2 text-cyan-100">
                    <Music2 className="h-4 w-4 text-cyan-300" />
                    <span className="text-sm font-semibold">YouTube Music Playlist</span>
                  </div>
                  <p className="mb-3 text-xs text-cyan-100/70">Add one YouTube video URL per line, then click Add Song.</p>
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
                    value={songInput}
                    onChange={(e) => setSongInput(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-300/25"
                    onClick={addSongsToDraft}
                  >
                    <Plus className="h-4 w-4" />
                    Add Song
                  </button>

                  {(draft.youtube_urls || []).length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {(draft.youtube_urls || []).map((url, index) => (
                        <div key={url} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2">
                          <p className="truncate text-xs text-cyan-100/85">{videoTitles[extractYoutubeVideoId(url) || ""] || `Song ${index + 1}`}</p>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                            onClick={() => removeSongFromDraft(url)}
                          >
                            <X className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-cyan-100/60">No songs added yet.</p>
                  )}

                  <label className="mt-4 flex items-center gap-3 rounded-xl border border-cyan-300/20 bg-slate-950/40 px-3 py-2 text-sm text-cyan-100">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-cyan-300/30 bg-black/40"
                      checked={draft.show_music_player}
                      onChange={(e) => setDraft((prev) => ({ ...prev, show_music_player: e.target.checked }))}
                    />
                    <span>Show Music Player</span>
                  </label>
                </div>

                <div className="sm:col-span-2 rounded-2xl border border-cyan-300/20 bg-black/25 p-4">
                  <div className="mb-3">
                    <p className="text-sm font-semibold text-cyan-100">Colors</p>
                    <p className="text-xs text-cyan-100/70">Customize your profile colors.</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-2 block text-sm text-cyan-100">Background Color</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          className="h-11 w-14 cursor-pointer rounded-xl border border-white/15 bg-black/30"
                          value={draft.background_color}
                          onChange={(e) => setDraft((prev) => ({ ...prev, background_color: e.target.value }))}
                          aria-label="Background color"
                        />
                        <input
                          type="text"
                          className="h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-300/50"
                          value={draft.background_color}
                          onChange={(e) => setDraft((prev) => ({ ...prev, background_color: e.target.value }))}
                          aria-label="Background color hex"
                        />
                      </div>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm text-cyan-100">Text Color</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          className="h-11 w-14 cursor-pointer rounded-xl border border-white/15 bg-black/30"
                          value={draft.text_color}
                          onChange={(e) => setDraft((prev) => ({ ...prev, text_color: e.target.value }))}
                          aria-label="Text color"
                        />
                        <input
                          type="text"
                          className="h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-300/50"
                          value={draft.text_color}
                          onChange={(e) => setDraft((prev) => ({ ...prev, text_color: e.target.value }))}
                          aria-label="Text color hex"
                        />
                      </div>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm text-cyan-100">Highlight / Accent Color</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          className="h-11 w-14 cursor-pointer rounded-xl border border-white/15 bg-black/30"
                          value={draft.highlight_color}
                          onChange={(e) => setDraft((prev) => ({ ...prev, highlight_color: e.target.value }))}
                          aria-label="Highlight color"
                        />
                        <input
                          type="text"
                          className="h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-300/50"
                          value={draft.highlight_color}
                          onChange={(e) => setDraft((prev) => ({ ...prev, highlight_color: e.target.value }))}
                          aria-label="Highlight color hex"
                        />
                      </div>
                    </label>
                  </div>
                </div>

                <div>
                  <span className="mb-2 block text-sm text-cyan-100">Font Style</span>
                  <select
                    className="h-11 w-full rounded-xl border border-white/15 bg-black/30 px-3 text-white outline-none focus:border-cyan-300/50"
                    value={draft.font_style}
                    onChange={(e) => setDraft((prev) => ({ ...prev, font_style: e.target.value as FormState["font_style"] }))}
                    aria-label="Font style"
                    title="Font style"
                  >
                    {FONT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="mb-2 block text-sm text-cyan-100">Avatar</span>
                  <label className="flex h-11 cursor-pointer items-center justify-center rounded-xl border border-white/20 bg-black/30 text-sm text-cyan-100 hover:bg-black/50">
                    Upload Avatar
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={isUploading} />
                  </label>
                </div>

                <div>
                  <span className="mb-2 block text-sm text-cyan-100">Banner</span>
                  <label className="flex h-11 cursor-pointer items-center justify-center rounded-xl border border-white/20 bg-black/30 text-sm text-cyan-100 hover:bg-black/50">
                    Upload Banner
                    <input type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} disabled={isUploading} />
                  </label>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  className="rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-60"
                  onClick={handleSave}
                  disabled={isSaving || isUploading}
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  className="rounded-full border border-white/20 px-6 py-3 text-sm text-white/90 hover:bg-white/10"
                  type="button"
                  onClick={() => {
                    setDraft(form);
                    setIsSaving(false);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <Link
                  href="/settings"
                  className="rounded-full border border-cyan-300/30 px-6 py-3 text-sm text-cyan-200/80 hover:bg-cyan-300/10"
                >
                  Change Password
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        <Dialog open={Boolean(playerSong) && isPlayerExpanded} onClose={() => setIsPlayerExpanded(false)} className="fixed inset-0 z-[1002] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" aria-hidden="true" />
          <Dialog.Panel className="relative z-10 w-full max-w-3xl overflow-hidden rounded-3xl border border-cyan-300/35 bg-[linear-gradient(180deg,rgba(8,16,30,0.92),rgba(7,12,24,0.96))] p-4 shadow-2xl backdrop-blur-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lg font-semibold text-cyan-50">Profile Music Player</Dialog.Title>
                <p className="mt-1 text-sm text-cyan-100/70">{playerSong ? videoTitles[playerSong.videoId] || "YouTube Track" : ""}</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/90 hover:bg-white/10"
                onClick={() => setIsPlayerExpanded(false)}
              >
                Close
              </button>
            </div>
            {playerSong ? (
              <div className="overflow-hidden rounded-2xl border border-cyan-300/25 bg-black/50">
                <iframe
                  src={playerSong.embedUrl}
                  title={videoTitles[playerSong.videoId] || "YouTube video player"}
                  className="aspect-video w-full"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : null}
          </Dialog.Panel>
        </Dialog>
      </div>
    </div>
  );
}
