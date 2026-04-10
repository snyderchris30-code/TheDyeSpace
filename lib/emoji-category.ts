import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import path from "path";
import { EmojiCategory, EmojiCategoryMap } from "@/types/emoji-category";

const CATEGORY_FILE = path.join(process.cwd(), "public", "emojis", "categories.json");

export async function loadEmojiCategories(): Promise<EmojiCategoryMap> {
  try {
    const data = await fs.readFile(CATEGORY_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveEmojiCategories(categories: EmojiCategoryMap): Promise<void> {
  await fs.writeFile(CATEGORY_FILE, JSON.stringify(categories, null, 2), "utf8");
}

export async function createCategory(name: string): Promise<EmojiCategory> {
  const categories = await loadEmojiCategories();
  const id = uuidv4();
  const order = Object.keys(categories).length;
  categories[id] = { id, name, order, emojiIds: [] };
  await saveEmojiCategories(categories);
  return categories[id];
}

export async function deleteCategory(id: string): Promise<void> {
  const categories = await loadEmojiCategories();
  if (!categories[id]) return;
  // Move emojis to Uncategorized
  const uncategorized = Object.values(categories).find((cat) => cat.name === "Uncategorized");
  if (uncategorized) {
    uncategorized.emojiIds.push(...categories[id].emojiIds);
  }
  delete categories[id];
  await saveEmojiCategories(categories);
}

export async function assignEmojiToCategory(emojiId: string, categoryId: string): Promise<void> {
  const categories = await loadEmojiCategories();
  for (const cat of Object.values(categories)) {
    cat.emojiIds = cat.emojiIds.filter((id) => id !== emojiId);
  }
  if (categories[categoryId]) {
    categories[categoryId].emojiIds.push(emojiId);
  }
  await saveEmojiCategories(categories);
}

export async function reorderCategories(newOrder: string[]): Promise<void> {
  const categories = await loadEmojiCategories();
  newOrder.forEach((id, idx) => {
    if (categories[id]) categories[id].order = idx;
  });
  await saveEmojiCategories(categories);
}
