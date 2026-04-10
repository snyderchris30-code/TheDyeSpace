import fs from "fs";
import path from "path";
import { CustomEmojiAsset } from "@/lib/custom-emojis";

const HIDDEN_EMOJIS_FILE = path.join(process.cwd(), "public", "emojis", "hidden.json");

function isEmojiFilesystemError(error: unknown) {
  const code = typeof error === "object" && error !== null ? (error as any).code : undefined;
  return code === "EROFS" || code === "EPERM" || code === "EACCES";
}

export async function loadHiddenEmojis(): Promise<string[]> {
  try {
    const data = await fs.promises.readFile(HIDDEN_EMOJIS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveHiddenEmojis(hidden: string[]): Promise<void> {
  try {
    await fs.promises.writeFile(HIDDEN_EMOJIS_FILE, JSON.stringify(hidden, null, 2), "utf8");
  } catch (error: unknown) {
    if (isEmojiFilesystemError(error)) {
      throw new Error("Emoji hidden state cannot be modified in this deployment.");
    }
    throw error;
  }
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
  try {
    const filePath = path.join(process.cwd(), "public", "emojis", emoji.fileName);
    await fs.promises.unlink(filePath);
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null ? (error as any).code : undefined;
    if (code === "ENOENT") {
      return;
    }
    if (code === "EROFS" || code === "EPERM" || code === "EACCES") {
      throw new Error("Emoji files cannot be deleted in this deployment.");
    }
    throw error;
  }
}
