import { CustomEmojiAsset } from "@/lib/custom-emojis";
import { useEffect, useState } from "react";

export function useHiddenEmojis(): [string[], (id: string, hide: boolean) => Promise<void>, (id: string) => Promise<void>] {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/emojis/hidden").then((res) => res.json()).then(setHidden);
  }, []);

  const setHide = async (id: string, hide: boolean) => {
    if (hide) {
      await fetch("/api/emojis/hidden", { method: "POST", body: JSON.stringify({ emojiId: id }) });
      setHidden((prev) => prev.includes(id) ? prev : [...prev, id]);
    } else {
      await fetch("/api/emojis/hidden", { method: "PATCH", body: JSON.stringify({ emojiId: id }) });
      setHidden((prev) => prev.filter((eid) => eid !== id));
    }
  };

  const deleteEmoji = async (id: string) => {
    await fetch("/api/emojis/hidden", { method: "DELETE", body: JSON.stringify({ emojiId: id }) });
    setHidden((prev) => prev.filter((eid) => eid !== id));
  };

  return [hidden, setHide, deleteEmoji];
}
