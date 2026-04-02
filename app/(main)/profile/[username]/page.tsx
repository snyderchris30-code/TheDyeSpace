"use client";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog } from "@headlessui/react";
import { useParams } from "next/navigation";
import { Heart, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { REACTION_EMOJIS, type AggregatedPostInteraction, type ReactionEmoji } from "@/lib/post-interactions";
import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_FONT_STYLE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_OPTIONS,
  fontClass,
  normalizeFontStyle,
  resolveProfileAppearance,
  type FontStyle,
  type ProfileAppearance,
} from "@/lib/profile-theme";
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
  return decodeURIComponent(value || "").trim().toLowerCase();
}

function stripCategoryTag(content: string | null) {
  if (!content) return "";
  return content.replace(/^\[(tutorial|new_boot_goofin|sold|unavailable)\]\s*/i, "").trim();
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

export default function ProfileEditor() {
  // Lightbox state for image modal
  const [lightbox, setLightbox] = useState<{ open: boolean; url: string | null }>({ open: false, url: null });
  // Report modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const params = useParams<{ username: string }>();
  const routeUsername = normalizeUsername(params?.username || "");
  const supabase = createClient();
  const viewRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
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
  });
  const [editing, setEditing] = useState(false);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [interactions, setInteractions] = useState<InteractionMap>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [reactionPickerPostId, setReactionPickerPostId] = useState<string | null>(null);
  const [interactionBusyPostId, setInteractionBusyPostId] = useState<string | null>(null);
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
        .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at")
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
        .select("id, username, display_name, bio, avatar_url, banner_url, theme_settings, created_at")
        .eq("username", username)
        .limit(1)
        .maybeSingle<ProfileRow>();

      if (error) throw error;
      return data;
    },
    [supabase]
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
          .order("created_at", { ascending: false });

        if (error) {
          throw error;
        }

        const nextPosts = (data || []) as ProfilePost[];
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
        const existingProfile = await fetchProfileById(userId);
        if (existingProfile) {
          applyProfileToForm(existingProfile);
          return;
        }

        const res = await fetch("/api/profile/init", { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "We could not initialize your profile yet. Please try again in a moment.");
        }

        const { profile: createdProfile } = await res.json();
        if (createdProfile) {
          applyProfileToForm(createdProfile as ProfileRow);
        }
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : "Could not load your profile right now. Please refresh and try again.",
        });
      }
    },
    [applyProfileToForm, fetchProfileById]
  );

  useEffect(() => {
    const syncSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      const sessionUser = data.session?.user;

      if (!routeUsername) {
        setLoading(false);
        return;
      }

      const isOwnRoute = Boolean(
        sessionUser &&
          [sessionUser.id, sessionUser.user_metadata?.username, sessionUser.email]
            .filter(Boolean)
            .some((value: string) => normalizeUsername(value) === routeUsername)
      );

      setLoading(true);
      setStatus(null);

      if (isOwnRoute && sessionUser) {
        await fetchOrCreateOwnProfile(sessionUser);
        setLoading(false);
        return;
      }

      setIsOwner(false);
      try {
        const viewedProfile = await fetchProfileByUsername(routeUsername);
        if (!viewedProfile) {
          throw new Error("Profile not found.");
        }
        setProfileUserId(viewedProfile.id);
        applyProfileToForm(viewedProfile);
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : "Unable to load this profile.",
        });
      } finally {
        setLoading(false);
      }
    };

    void syncSession();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user && isOwner) {
        await fetchOrCreateOwnProfile(nextSession.user);
      }
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [applyProfileToForm, fetchOrCreateOwnProfile, fetchProfileByUsername, isOwner, routeUsername, supabase.auth]);

  useEffect(() => {
    const visibleState = editing ? draft : form;
    applyThemeStyles(viewRef.current, visibleState);
  }, [draft, editing, form]);

  useEffect(() => {
    applyThemeStyles(previewRef.current, draft);
  }, [draft]);

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
    async (payloadState: FormState, successText?: string) => {
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
      };

      const saveRes = await fetch("/api/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

        setDraft((prev) => ({
          ...prev,
          [options.field]: publicUrl,
        }));
        setStatus({ type: "success", text: options.successText });
      } catch (error: any) {
        setStatus({
          type: "error",
          text: typeof error?.message === "string" ? error.message : options.errorText,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [ensureProfileBuckets, profileUserId, session?.user?.id, supabase.storage]
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
    setEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);
    try {
      await saveProfile(draft, "Profile changes saved successfully.");
      setEditing(false);
    } catch (error: any) {
      setStatus({
        type: "error",
        text: typeof error?.message === "string" ? error.message : "We could not save your profile. Please try again.",
      });
    } finally {
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

  const profileDisplay = editing ? draft : form;

  return (
    <div className="min-h-screen px-4 pb-16 pt-20 text-white sm:px-8" aria-label="Profile Customization Hub">
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
        ) : (
          <>
            <section
              ref={viewRef}
              className={`relative isolate overflow-hidden rounded-[2rem] border border-cyan-300/25 shadow-[0_25px_90px_rgba(0,0,0,0.45)] ${fontClass(profileDisplay.font_style)}`}
            >
              <img
                src={profileDisplay.banner_url || DEFAULT_BANNER_URL}
                alt="Profile banner"
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(68,249,207,0.20),transparent_35%),linear-gradient(180deg,rgba(4,10,22,0.10)_0%,rgba(5,10,20,0.28)_32%,rgba(3,8,18,0.82)_100%)]" />
              <div className="absolute inset-0 bg-black/20" />

              <div className="absolute right-5 top-5 z-20 flex gap-3">
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
                        <img src={profileDisplay.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-cyan-100">TD</div>
                      )}
                    </div>
                  </div>

                  <div className="max-w-3xl pt-1 text-left text-white">
                    <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--profile-highlight)]/90 sm:text-xs sm:tracking-[0.45em]">The Dye Space Profile</p>
                    <h1 className="mt-2 text-2xl font-black leading-tight text-[color:var(--profile-text)] drop-shadow-[0_0_18px_rgba(0,0,0,0.6)] sm:text-5xl">
                      {profileDisplay.display_name || "Untitled Profile"}
                    </h1>
                    <p className="mt-1 text-sm font-medium text-[color:var(--profile-highlight)] drop-shadow-[0_0_12px_rgba(0,0,0,0.55)] sm:text-lg">
                      @{profileDisplay.username || "username"}
                    </p>
                    <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-[color:var(--profile-text)]/92 drop-shadow-[0_0_18px_rgba(0,0,0,0.55)] sm:text-base">
                      {profileDisplay.bio || "No bio yet."}
                    </p>
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

                    return (
                      <article
                        key={post.id}
                        className={`rounded-[1.5rem] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(9,19,37,0.82),rgba(7,12,24,0.88))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-cyan-300/35 sm:rounded-[1.75rem] sm:p-6 ${fontClass(profileDisplay.font_style)}`}
                        ref={(element) => applyProfileThemeVars(element, profileDisplay)}
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm text-[color:var(--profile-text)]/70">{formatPostDate(post.created_at)}</p>
                            {post.is_for_sale ? (
                              <span className="mt-2 inline-flex rounded-full border border-emerald-300/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                                For Sale
                              </span>
                            ) : null}
                          </div>
                          <div className="rounded-full border border-cyan-300/20 bg-black/25 px-3 py-1 text-xs text-[color:var(--profile-text)]/75">
                            {post.likes} reactions • {post.comments_count} comments
                          </div>
                        </div>

                        <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-[color:var(--profile-text)]/92 sm:text-lg sm:leading-8">{stripCategoryTag(post.content) || "No description provided."}</p>

                        {post.image_urls && post.image_urls.length > 0 ? (
                          <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            {post.image_urls.map((imageUrl, imageIndex) => (
                              <button key={`${post.id}-${imageIndex}`} type="button" className="group relative aspect-[4/5] w-full overflow-hidden rounded-[1.5rem] cursor-zoom-in sm:aspect-square" onClick={(e) => {
                                e.stopPropagation();
                                setLightbox({ open: true, url: imageUrl });
                              }}>
                                <img
                                  src={imageUrl}
                                  alt={`Post image ${imageIndex + 1}`}
                                  className="absolute inset-0 h-full w-full border border-cyan-300/20 object-cover shadow-lg transition duration-200 group-hover:scale-105"
                                  tabIndex={0}
                                  /* style moved to className */
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
                            <button
                              className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/25 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/40 hover:bg-black/40"
                              type="button"
                              onClick={() => setReactionPickerPostId((current) => (current === post.id ? null : post.id))}
                            >
                              <Heart className="h-4 w-4" />
                              <span>{postInteraction.viewerReaction ? `Reacted ${postInteraction.viewerReaction}` : "React"}</span>
                            </button>

                            {reactionPickerPostId === post.id ? (
                              <div className="absolute left-0 top-full z-20 mt-2 flex flex-wrap gap-2 rounded-2xl border border-cyan-300/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-xl">
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
                                }`}
                                onClick={() => void handleReactionSelect(post.id, reaction.emoji)}
                                disabled={isBusy}
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
                                          <img src={comment.author.avatar_url} alt="Comment author" className="h-full w-full object-cover" />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-xs font-bold text-cyan-100">TD</div>
                                        )}
                                      </div>
                                      <div
                                        className={`min-w-0 flex-1 ${fontClass(comment.author.theme_settings?.font_style)}`}
                                        ref={(element) => applyProfileThemeVars(element, comment.author.theme_settings)}
                                      >
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                          <Link
                                            href={comment.author.username ? `/profile/${comment.author.username}` : '#'}
                                            className="font-semibold text-[color:var(--profile-text)] hover:text-[color:var(--profile-highlight)] hover:underline"
                                            prefetch={false}
                                          >
                                            {displayAuthorName(comment.author.display_name, comment.author.username)}
                                          </Link>
                                          <Link
                                            href={comment.author.username ? `/profile/${comment.author.username}` : '#'}
                                            className="text-xs text-[color:var(--profile-highlight)]/80 hover:text-[color:var(--profile-highlight)] hover:underline"
                                            prefetch={false}
                                          >
                                            @{comment.author.username || "user"}
                                          </Link>
                                          <span className="text-xs text-[color:var(--profile-text)]/55">{formatPostDate(comment.created_at)}</span>
                                        </div>
                                        <p className="mt-2 whitespace-pre-wrap text-[color:var(--profile-text)]/90">{comment.content}</p>
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
            <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-cyan-300/30 bg-slate-950/95 p-6 shadow-2xl backdrop-blur-xl">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-cyan-100">Edit Profile</h2>
                <button
                  className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                  onClick={() => {
                    setDraft(form);
                    setEditing(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              </div>

              <div ref={previewRef} className={`mb-6 rounded-2xl border border-white/15 p-5 ${fontClass(draft.font_style)}`}>
                <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--profile-highlight)]">Live Preview</p>
                <h3 className="mt-2 text-2xl font-semibold text-[color:var(--profile-text)]">{draft.display_name || "Display Name"}</h3>
                <p className="text-sm text-[color:var(--profile-highlight)]">@{draft.username || "username"}</p>
                <p className="mt-3 whitespace-pre-wrap text-[color:var(--profile-text)]/90">{draft.bio || "Your bio preview appears here."}</p>
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
                  <span className="mb-2 block text-sm text-cyan-100">Bio</span>
                  <textarea
                    className="min-h-28 w-full rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-white outline-none focus:border-cyan-300/50"
                    value={draft.bio}
                    onChange={(e) => setDraft((prev) => ({ ...prev, bio: e.target.value }))}
                    placeholder="Share something about yourself"
                  />
                </label>

                <div>
                  <span className="mb-2 block text-sm text-cyan-100">Background Color</span>
                  <input
                    type="color"
                    className="h-11 w-full cursor-pointer rounded-xl border border-white/15 bg-black/30"
                    value={draft.background_color}
                    onChange={(e) => setDraft((prev) => ({ ...prev, background_color: e.target.value }))}
                    aria-label="Background color"
                  />
                </div>

                <div>
                  <span className="mb-2 block text-sm text-cyan-100">Text Color</span>
                  <input
                    type="color"
                    className="h-11 w-full cursor-pointer rounded-xl border border-white/15 bg-black/30"
                    value={draft.text_color}
                    onChange={(e) => setDraft((prev) => ({ ...prev, text_color: e.target.value }))}
                    aria-label="Text color"
                  />
                </div>

                <div>
                  <span className="mb-2 block text-sm text-cyan-100">Highlight / Accent Color</span>
                  <input
                    type="color"
                    className="h-11 w-full cursor-pointer rounded-xl border border-white/15 bg-black/30"
                    value={draft.highlight_color}
                    onChange={(e) => setDraft((prev) => ({ ...prev, highlight_color: e.target.value }))}
                    aria-label="Highlight color"
                  />
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
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
