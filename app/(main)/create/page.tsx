"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PostCategory = "general" | "tutorial" | "new_boot_goofin" | "for_sale";

export default function CreatePostPage() {
  const router = useRouter();
  const supabase = createClient();
  const [content, setContent] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [category, setCategory] = useState<PostCategory>("general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const ensureStorageBuckets = async () => {
    const response = await fetch("/api/storage/profile-buckets", { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Storage is not ready for uploads right now.");
    }
  };

  const handleCreatePost = async () => {
    setStatus(null);
    if (!content.trim()) {
      setStatus("Please add post content before publishing.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;

      if (!userId) {
        throw new Error("Please sign in before creating a post.");
      }

      let imageUrls: string[] = [];
      if (image) {
        await ensureStorageBuckets();
        const fileExt = image.name.split(".").pop() || "png";
        const filePath = `${userId}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("posts")
          .upload(filePath, image, { upsert: true, contentType: image.type || undefined });

        if (uploadError) {
          throw uploadError;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("posts").getPublicUrl(filePath);
        imageUrls = [publicUrl];
      }


      let categoryPrefix = "";
      let isForSale = false;
      if (category === "tutorial") categoryPrefix = "[tutorial] ";
      else if (category === "new_boot_goofin") categoryPrefix = "[new_boot_goofin] ";
      else if (category === "for_sale") {
        categoryPrefix = "[for_sale] ";
        isForSale = true;
      }

      const createResponse = await fetch("/api/posts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `${categoryPrefix}${content.trim()}`,
          image_urls: imageUrls.length ? imageUrls : null,
          is_for_sale: isForSale,
        }),
      });

      if (!createResponse.ok) {
        const body = await createResponse.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create post.");
      }

      setStatus("Post published successfully.");
      setContent("");
      setImage(null);
      setCategory("general");
      // No need to reset isForSale, it's derived from category now
      router.push("/explore");
      router.refresh();
    } catch (e: any) {
      setStatus(typeof e?.message === "string" ? e.message : "Failed to create post.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-slate-900/80 fractal-border rounded-3xl backdrop-blur-lg shadow-2xl float-slow">
      <h1 className="glow-text text-5xl font-extrabold mb-4 animate-cosmic-logo float-slow">Create a Post</h1>
      <p className="text-cyan-100 mb-6 glow-accent float-slow">Share your work, tutorial, or new boot goofin moment.</p>

      {status && (
        <div className="mb-4 rounded-xl border border-cyan-300/30 bg-black/40 px-4 py-2 text-cyan-100">
          {status}
        </div>
      )}

      <label className="block mb-4">
        <span className="text-cyan-300">Post content</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Share your thoughts..."
          rows={6}
          className="mt-2 w-full rounded-2xl bg-slate-800 text-white p-3 border border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
      </label>

      <label className="block mb-4">
        <span className="text-cyan-300">Post Type</span>
        <select
          className="mt-2 w-full rounded-2xl bg-slate-800 text-white p-3 border border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          value={category}
          onChange={(e) => setCategory(e.target.value as PostCategory)}
        >
          <option value="general">General Post</option>
          <option value="tutorial">Tutorial</option>
          <option value="new_boot_goofin">New Boot Goofin</option>
          <option value="for_sale">For Sale</option>
        </select>
      </label>

      {/* For Sale checkbox removed; now part of Post Type */}

      <label className="block mb-4">
        <span className="text-cyan-300">Image upload (optional)</span>
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} className="mt-2 w-full text-cyan-100" />
      </label>

      <button
        className="px-8 py-3 rounded-2xl bg-gradient-to-r from-emerald-400 via-blue-400 to-sky-500 text-black font-extrabold text-xl shadow-xl fractal-border glow-accent float-slow transition-all duration-300 hover:scale-105 hover:glow-accent disabled:opacity-60"
        onClick={handleCreatePost}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Publishing..." : "Publish Post"}
      </button>
    </div>
  );
}
