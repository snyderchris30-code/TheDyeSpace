"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { hasAdminAccess } from "@/lib/admin-actions";

type DeletedPost = {
  id: string;
  user_id: string;
  content: string | null;
  created_at: string;
  deleted_at: string | null;
};

type DeletedComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
  deleted_at: string | null;
};

export default function DeletedItemsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [posts, setPosts] = useState<DeletedPost[]>([]);
  const [comments, setComments] = useState<DeletedComment[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        setError("Please sign in to view this page.");
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .limit(1)
        .maybeSingle();

      const admin = hasAdminAccess(userId, profile?.role ?? null);
      setIsAdmin(admin);

      if (!admin) {
        setError("Admin access only.");
        setLoading(false);
        return;
      }

      const response = await fetch("/api/admin/deleted-items", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Failed to load deleted items.");
      }

      setPosts(Array.isArray(body?.posts) ? body.posts : []);
      setComments(Array.isArray(body?.comments) ? body.comments : []);
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : "Failed to load deleted items.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const mutateItem = async (itemType: "post" | "comment", id: string, action: "restore" | "permanent_delete") => {
    const method = action === "restore" ? "PATCH" : "DELETE";
    const response = await fetch("/api/admin/deleted-items", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType, id, action }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || "Action failed.");
    }

    await loadData();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-8 text-cyan-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Deleted Items</h1>
        <Link href="/" className="rounded-full border border-cyan-300/30 px-4 py-2 text-sm hover:bg-cyan-900/30">
          Back Home
        </Link>
      </div>

      {loading ? <p>Loading deleted items...</p> : null}
      {!loading && error ? <p className="rounded-xl border border-rose-400/30 bg-rose-900/20 p-4 text-rose-200">{error}</p> : null}

      {!loading && !error && isAdmin ? (
        <div className="space-y-8">
          <section className="rounded-2xl border border-cyan-300/20 bg-black/35 p-5">
            <h2 className="mb-4 text-xl font-semibold">Deleted Posts</h2>
            {!posts.length ? <p className="text-cyan-300/80">No deleted posts.</p> : null}
            <div className="space-y-3">
              {posts.map((post) => (
                <article key={post.id} className="rounded-xl border border-cyan-300/15 bg-slate-950/70 p-3">
                  <p className="text-sm text-cyan-200/80">Deleted: {post.deleted_at ? new Date(post.deleted_at).toLocaleString() : "Unknown"}</p>
                  <p className="mt-1 text-sm text-cyan-50">{post.content || "(No content)"}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-full border border-emerald-300/35 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30"
                      onClick={() => void mutateItem("post", post.id, "restore")}
                    >
                      Restore
                    </button>
                    <button
                      className="rounded-full border border-rose-300/35 px-3 py-1 text-xs text-rose-200 hover:bg-rose-900/30"
                      onClick={() => void mutateItem("post", post.id, "permanent_delete")}
                    >
                      Permanent Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-cyan-300/20 bg-black/35 p-5">
            <h2 className="mb-4 text-xl font-semibold">Deleted Comments</h2>
            {!comments.length ? <p className="text-cyan-300/80">No deleted comments.</p> : null}
            <div className="space-y-3">
              {comments.map((comment) => (
                <article key={comment.id} className="rounded-xl border border-cyan-300/15 bg-slate-950/70 p-3">
                  <p className="text-sm text-cyan-200/80">Deleted: {comment.deleted_at ? new Date(comment.deleted_at).toLocaleString() : "Unknown"}</p>
                  <p className="mt-1 text-sm text-cyan-50">{comment.content}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-full border border-emerald-300/35 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-900/30"
                      onClick={() => void mutateItem("comment", comment.id, "restore")}
                    >
                      Restore
                    </button>
                    <button
                      className="rounded-full border border-rose-300/35 px-3 py-1 text-xs text-rose-200 hover:bg-rose-900/30"
                      onClick={() => void mutateItem("comment", comment.id, "permanent_delete")}
                    >
                      Permanent Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
