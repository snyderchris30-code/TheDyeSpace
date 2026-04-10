import { useEffect, useState } from "react";
import { useHiddenEmojis } from "./useHiddenEmojis";
import { EmojiCategory, EmojiCategoryMap } from "@/types/emoji-category";
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/emojis/categories")
      .then((res) => res.json())
      .then(setCategories);
  }, []);

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

  const handleAssignEmoji = async (emojiId: string, categoryId: string) => {
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

  const handleReorder = async (newOrder: string[]) => {
    await fetch("/api/emojis/categories", {
      method: "PUT",
      body: JSON.stringify({ categories: newOrder }),
    });
    // Refetch or reorder locally
  };


  const [hidden, setHide, deleteEmoji] = useHiddenEmojis();
  if (!isAdmin) return null;

  return (
    <section className="mt-6 rounded-2xl border border-cyan-300/20 bg-black/40 p-4">
      <h3 className="text-lg font-bold text-cyan-100 mb-2">Category Editor</h3>
      <div className="flex gap-2 mb-4">
        <input
          className="rounded px-2 py-1 text-black"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="New category name"
        />
        <button
          className="bg-cyan-400 text-black rounded px-3 py-1 font-semibold"
          onClick={handleCreateCategory}
        >
          Add
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {Object.values(categories)
          .sort((a, b) => a.order - b.order)
          .map((cat) => (
            <div key={cat.id} className="flex items-center gap-2">
              <span className="font-semibold text-cyan-200">{cat.name}</span>
              <button
                className="text-xs text-rose-400 ml-2"
                onClick={() => handleDeleteCategory(cat.id)}
              >
                Delete
              </button>
              <div className="flex flex-wrap gap-1 ml-4">
                {cat.emojiIds.map((eid) => {
                  const emoji = emojis.find((e) => e.id === eid);
                  if (!emoji) return null;
                  const isHidden = hidden.includes(emoji.id);
                  return (
                    <span key={eid} className="inline-block bg-cyan-900/40 rounded p-1 relative">
                      <img src={emoji.url} alt={emoji.name} className="h-6 w-6 inline opacity-100" />
                      <span className="ml-1">
                        {isHidden ? (
                          <button className="text-xs text-yellow-400 underline" onClick={() => setHide(emoji.id, false)}>
                            Unhide
                          </button>
                        ) : (
                          <button className="text-xs text-cyan-400 underline" onClick={() => setHide(emoji.id, true)}>
                            Hide
                          </button>
                        )}
                        <button className="text-xs text-rose-400 underline ml-1" onClick={() => deleteEmoji(emoji.id)}>
                          Delete
                        </button>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
      <div className="mt-4">
        <label className="block mb-1 text-cyan-200">Assign Emoji to Category</label>
        <select
          className="rounded px-2 py-1 text-black"
          aria-label="Select emoji"
          title="Select emoji"
          value={selectedEmoji || ""}
          onChange={(e) => setSelectedEmoji(e.target.value)}
        >
          <option value="">Select Emoji</option>
          {emojis.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          className="rounded px-2 py-1 text-black ml-2"
          aria-label="Select category"
          title="Select category"
          value={selectedCategory || ""}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="">Select Category</option>
          {Object.values(categories)
            .sort((a, b) => a.order - b.order)
            .map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
        </select>
        <button
          className="ml-2 bg-cyan-400 text-black rounded px-3 py-1 font-semibold"
          onClick={() => selectedEmoji && selectedCategory && handleAssignEmoji(selectedEmoji, selectedCategory)}
        >
          Assign
        </button>
      </div>
    </section>
  );
}
