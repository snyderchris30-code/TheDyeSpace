import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useHiddenEmojis } from "./useHiddenEmojis";
import { EmojiCategoryMap } from "@/types/emoji-category";
import { CustomEmojiAsset } from "@/lib/custom-emojis";

export default function EmojiCategoryEditor({
  emojis,
  isAdmin,
}: {
  emojis: CustomEmojiAsset[];
  isAdmin: boolean;
}) {
  const [categories, setCategories] = useState<EmojiCategoryMap>({});
  const [newCategory, setNewCategory] = useState("");
  const [draggingEmojiId, setDraggingEmojiId] = useState<string | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/emojis/categories")
      .then((res) => res.json())
      .then(setCategories);
  }, []);

  const assignedEmojiIds = useMemo(() => {
    return new Set(Object.values(categories).flatMap((category) => category.emojiIds));
  }, [categories]);

  const sortedEmojis = useMemo(() => {
    return [...emojis].sort((left, right) => left.name.localeCompare(right.name));
  }, [emojis]);

  const handleCreateCategory = async () => {
    if (!newCategory.trim()) return;
    const res = await fetch("/api/emojis/categories", {
      method: "POST",
      body: JSON.stringify({ name: newCategory }),
    });
    const cat = await res.json();
    setCategories((prev) => ({ ...prev, [cat.id]: cat }));
    setNewCategory("");
  };

  const handleDeleteCategory = async (id: string) => {
    await fetch("/api/emojis/categories", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    setCategories((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const assignEmojiToCategory = async (emojiId: string, categoryId: string) => {
    await fetch("/api/emojis/categories", {
      method: "PATCH",
      body: JSON.stringify({ emojiId, categoryId }),
    });
    setCategories((prev) => {
      const updated = { ...prev };
      for (const cat of Object.values(updated)) {
        cat.emojiIds = cat.emojiIds.filter((id) => id !== emojiId);
      }
      if (updated[categoryId]) {
        updated[categoryId].emojiIds.push(emojiId);
      }
      return updated;
    });
  };

  const handleDragStart = (emojiId: string) => {
    setDraggingEmojiId(emojiId);
  };

  const handleDragEnd = () => {
    setDraggingEmojiId(null);
    setDragOverCategoryId(null);
  };

  const handleDragOver = (categoryId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOverCategoryId(categoryId);
  };

  const handleDrop = async (categoryId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const emojiId = event.dataTransfer.getData("text/plain") || draggingEmojiId;
    if (emojiId) {
      await assignEmojiToCategory(emojiId, categoryId);
    }
    handleDragEnd();
  };

  const [hidden, setHide, deleteEmoji] = useHiddenEmojis();
  if (!isAdmin) return null;

  return (
    <section className="mt-6 rounded-2xl border border-cyan-300/20 bg-black/40 p-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-cyan-100">Category Editor</h3>
          <p className="text-sm text-cyan-200/80">Drag emoji images into categories to assign them quickly.</p>
        </div>
        <div className="flex gap-2">
          <input
            className="rounded border border-cyan-300/20 bg-slate-950/80 px-3 py-2 text-cyan-100 outline-none focus:border-cyan-200"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
          />
          <button
            className="rounded bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            onClick={handleCreateCategory}
          >
            Add Category
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-3xl border border-cyan-300/20 bg-slate-950/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200/80">All Emojis</h4>
            <p className="text-xs text-cyan-200/70">Drag any emoji into a category below.</p>
          </div>
          <span className="rounded-full bg-cyan-900/70 px-3 py-1 text-xs text-cyan-100">{sortedEmojis.length} emojis</span>
        </div>
        <div className="grid grid-cols-6 gap-3 sm:grid-cols-8 lg:grid-cols-10">
          {sortedEmojis.map((emoji) => {
            const assigned = assignedEmojiIds.has(emoji.id);
            return (
              <button
                key={emoji.id}
                type="button"
                draggable
                onDragStart={() => handleDragStart(emoji.id)}
                onDragEnd={handleDragEnd}
                className={`group flex h-16 w-16 items-center justify-center rounded-3xl border transition ${assigned ? "border-cyan-400/80 bg-cyan-900/70" : "border-slate-700 bg-slate-950/80 hover:border-cyan-300/70 hover:bg-slate-900"}`}
              >
                <img src={emoji.url} alt={emoji.name} className="h-10 w-10" />
                <span className="sr-only">{emoji.name}</span>
                {assigned ? <span className="pointer-events-none absolute bottom-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-semibold text-slate-950">✓</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.values(categories)
          .sort((a, b) => a.order - b.order)
          .map((cat) => (
            <div
              key={cat.id}
              onDragOver={(event) => handleDragOver(cat.id, event)}
              onDrop={(event) => void handleDrop(cat.id, event)}
              className={`rounded-3xl border p-4 transition ${dragOverCategoryId === cat.id ? "border-cyan-300 bg-cyan-950/40 shadow-[0_0_22px_rgba(34,211,238,0.16)]" : "border-slate-700 bg-slate-950/70"}`}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-cyan-100">{cat.name}</div>
                  <div className="text-xs text-cyan-200/70">Drop emojis here to assign them.</div>
                </div>
                <button
                  className="rounded-md bg-rose-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-rose-400"
                  onClick={() => handleDeleteCategory(cat.id)}
                >
                  Delete
                </button>
              </div>
              <div className="min-h-[5rem] rounded-3xl border border-cyan-300/10 bg-black/20 p-3">
                {cat.emojiIds.length === 0 ? (
                  <div className="text-sm text-cyan-200/70">Drop emojis into this category to populate it.</div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {cat.emojiIds.map((eid) => {
                      const emoji = emojis.find((e) => e.id === eid);
                      if (!emoji) return null;
                      const isHidden = hidden.includes(emoji.id);
                      return (
                        <div
                          key={eid}
                          draggable
                          onDragStart={() => handleDragStart(emoji.id)}
                          onDragEnd={handleDragEnd}
                          className="group relative flex h-16 w-16 flex-col items-center justify-center rounded-3xl border border-cyan-300/20 bg-slate-950/80 p-2 transition hover:border-cyan-200"
                        >
                          <img src={emoji.url} alt={emoji.name} className="h-10 w-10" />
                          <span className="sr-only">{emoji.name}</span>
                          <div className="mt-1 text-[10px] text-cyan-200/80">{emoji.name}</div>
                          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                            {isHidden ? (
                              <button className="rounded bg-yellow-400/90 px-1 text-[10px] text-slate-950" onClick={() => setHide(emoji.id, false)}>
                                Unhide
                              </button>
                            ) : (
                              <button className="rounded bg-cyan-400/90 px-1 text-[10px] text-slate-950" onClick={() => setHide(emoji.id, true)}>
                                Hide
                              </button>
                            )}
                            <button className="rounded bg-rose-400/90 px-1 text-[10px] text-slate-950" onClick={() => deleteEmoji(emoji.id)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
