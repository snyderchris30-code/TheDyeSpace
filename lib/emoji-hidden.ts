import fs from "fs";
import path from "path";
import { CustomEmojiAsset } from "@/lib/custom-emojis";

const HIDDEN_EMOJIS_FILE = path.join(process.cwd(), "public", "emojis", "hidden.json");

export async function loadHiddenEmojis(): Promise<string[]> {
  try {
    const data = await fs.promises.readFile(HIDDEN_EMOJIS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveHiddenEmojis(hidden: string[]): Promise<void> {
  await fs.promises.writeFile(HIDDEN_EMOJIS_FILE, JSON.stringify(hidden, null, 2), "utf8");
}

export async function hideEmoji(emojiId: string): Promise<void> {
  const hidden = await loadHiddenEmojis();
  if (!hidden.includes(emojiId)) {
    hidden.push(emojiId);
    await saveHiddenEmojis(hidden);
  }
}

export async function unhideEmoji(emojiId: string): Promise<void> {
  let hidden = await loadHiddenEmojis();
  hidden = hidden.filter((id) => id !== emojiId);
  await saveHiddenEmojis(hidden);
}

export async function deleteEmojiFile(emoji: CustomEmojiAsset): Promise<void> {
  const filePath = path.join(process.cwd(), "public", "emojis", emoji.fileName);
  await fs.promises.unlink(filePath);
}
