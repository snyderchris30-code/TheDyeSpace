"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStateCard from "@/app/AsyncStateCard";
import UserIdentity from "@/app/UserIdentity";
import { fetchClientProfile, resolveClientAuth } from "@/lib/client-auth";
import { createClient } from "@/lib/supabase/client";
import {
  PRIVATE_ROOM_PROFILE_SELECT,
  canAccessPrivateRoom,
  getPrivateRoomDefinition,
  type PrivateRoomAccessProfile,
  type PrivateRoomKey,
} from "@/lib/private-rooms";

type RoomPost = {
  id: string;
  room: PrivateRoomKey;
  user_id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  expires_at: string;
  author?: {
    id: string;
    username: string | null;
    display_name: string | null;
    verified_badge?: boolean | null;
    member_number?: number | null;
  } | null;
};

function formatTimeRemaining(expiresAt: string) {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) {
    return "Expiring now";
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m left`;
  }

  return `${hours}h ${minutes}m left`;
}

export default function PrivateRoomFeedClient({ room }: { room: PrivateRoomKey }) {
  const roomDefinition = useMemo(() => getPrivateRoomDefinition(room), [room]);
  const [authorized, setAuthorized] = useState(false);
  const authorizedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [posts, setPosts] = useState<RoomPost[]>([]);
  const [content, setContent] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);

  const loadPosts = useCallback(async () => {
    const response = await fetch(`/api/rooms/posts?room=${encodeURIComponent(room)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body?.error || "Failed to load private room posts.");
    }

    setPosts(Array.isArray(body?.posts) ? (body.posts as RoomPost[]) : []);
  }, [room]);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const supabase = createClient();
        const { user, errorMessage } = await resolveClientAuth(supabase);
        if (!user) {
          if (!active) {
            return;
          }
          setAuthorized(false);
          setError(errorMessage || null);
          setLoading(false);
          return;
        }

        const profile = await fetchClientProfile<PrivateRoomAccessProfile>(
          supabase,
          user.id,
          PRIVATE_ROOM_PROFILE_SELECT,
          { ensureProfile: true }
        );

        const allowed = canAccessPrivateRoom(profile, room);
        if (!active) {
          return;
        }

        setAuthorized(allowed);
        authorizedRef.current = allowed;
        if (!allowed) {
          setLoading(false);
          setError(null);
          return;
        }

        await loadPosts();
        if (!active) {
          return;
        }

        setError(null);
      } catch (loadError: any) {
        if (!active) {
          return;
        }
        setAuthorized(false);
        setError(typeof loadError?.message === "string" ? loadError.message : "Could not open this private room.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    const intervalId = window.setInterval(() => {
      if (!document.hidden && authorizedRef.current) {
        void loadPosts().catch(() => undefined);
      }
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadPosts, room]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setStatus(null);
    setError(null);

    try {
      let imageBucket: string | null = null;
      let imagePath: string | null = null;

      if (selectedImage) {
        const formData = new FormData();
        formData.set("room", room);
        formData.set("image", selectedImage);

        const uploadResponse = await fetch("/api/rooms/upload", {
          method: "POST",
          body: formData,
        });
        const uploadBody = await uploadResponse.json().catch(() => ({}));
        if (!uploadResponse.ok) {
          throw new Error(uploadBody?.error || "Failed to upload the image.");
        }

        imageBucket = typeof uploadBody?.bucket === "string" ? uploadBody.bucket : null;
        imagePath = typeof uploadBody?.filePath === "string" ? uploadBody.filePath : null;
      }

      const response = await fetch("/api/rooms/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, content, imageBucket, imagePath }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to create the room post.");
      }

      setPosts((prev) => (body?.post ? [body.post as RoomPost, ...prev] : prev));
      setContent("");
      setSelectedImage(null);
      setStatus("Post shared. It will auto-delete in 16 hours.");
    } catch (submitError: any) {
      setError(typeof submitError?.message === "string" ? submitError.message : "Could not share this post.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto mt-10 max-w-3xl px-4">
        <AsyncStateCard loading title={`Loading ${roomDefinition.title}`} message="Checking your invite and opening the private room." />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="mx-auto mt-10 max-w-2xl px-4">
        <AsyncStateCard tone="error" title="Not authorized" message={error || "This room is invite-only."} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4">
      <section className={`mt-6 overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-gradient-to-br ${roomDefinition.accentClassName} bg-slate-950/70 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-cyan-200/75">Private Room</p>
            <h1 className="mt-2 text-3xl font-bold text-cyan-50 cosmic-headline">{roomDefinition.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-cyan-100/75">{roomDefinition.description}</p>
          </div>
          <div className="rounded-full border border-cyan-300/25 bg-black/25 px-4 py-2 text-xs font-semibold text-cyan-100/85">
            Invite-only access
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="mt-6 rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/60 p-5 shadow-xl backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-cyan-50">Share with the room</p>
            <p className="text-xs text-cyan-100/65">Text, one photo, or both. Every post disappears after exactly 16 hours.</p>
          </div>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-100/80">
            Auto-delete 16h
          </span>
        </div>

        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Add a note for invited members..."
          className="min-h-28 w-full rounded-[1.5rem] border border-cyan-300/20 bg-black/25 px-4 py-3 text-cyan-50 outline-none transition focus:border-cyan-300/45"
          maxLength={1500}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-cyan-300/25 bg-black/25 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/10">
            <span>Add Photo</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => setSelectedImage(event.target.files?.[0] || null)}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-full border border-cyan-300/35 bg-cyan-400/15 px-5 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Posting..." : "Post to Room"}
          </button>
        </div>

        {selectedImage ? (
          <p className="mt-3 text-xs text-cyan-200/75">Selected photo: {selectedImage.name}</p>
        ) : null}
        {status ? <p className="mt-3 text-sm text-emerald-200">{status}</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
      </form>

      <div className="mt-6 space-y-4 pb-10">
        {posts.length === 0 ? (
          <div className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/55 p-6 text-sm text-cyan-100/70">
            Nothing has been posted here yet.
          </div>
        ) : (
          posts.map((post) => (
            <article key={post.id} className="overflow-hidden rounded-[1.75rem] border border-cyan-300/20 bg-slate-950/60 shadow-xl backdrop-blur-xl">
              <div className="space-y-4 px-5 py-4">
                {post.image_url ? (
                  <div className="flex min-h-[18rem] items-center justify-center overflow-hidden rounded-[1.5rem] border border-cyan-300/15 bg-black/20 p-2">
                    <img src={post.image_url} alt="Private room upload" className="max-h-[38rem] w-full object-contain" />
                  </div>
                ) : null}
                {post.content ? <p className="whitespace-pre-wrap text-sm leading-6 text-cyan-50">{post.content}</p> : null}
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-[1.25rem] border border-cyan-300/10 bg-black/20 px-4 py-3">
                  <UserIdentity
                    displayName={post.author?.display_name}
                    username={post.author?.username}
                    verifiedBadge={post.author?.verified_badge}
                    memberNumber={post.author?.member_number}
                    timestampText={new Date(post.created_at).toLocaleString()}
                    className="min-w-0"
                    nameClassName="font-semibold text-cyan-50 hover:text-cyan-100"
                    usernameClassName="text-xs text-cyan-300/75 hover:text-cyan-100 hover:underline"
                    metaClassName="text-xs text-cyan-300/55"
                  />
                  <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-100/85">
                    {formatTimeRemaining(post.expires_at)}
                  </span>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}