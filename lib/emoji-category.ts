import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import path from "path";
import { EmojiCategory, EmojiCategoryMap } from "@/types/emoji-category";
import { createAdminClient } from "@/lib/admin-utils";

const CATEGORY_FILE = path.join(process.cwd(), "public", "emojis", "categories.json");

function mapRowsToCategories(rows: Array<{ id: string; name: string; sort_order: number; emoji_ids: string[] }>) {
  const categories: EmojiCategoryMap = {};
  rows.forEach((row) => {
    categories[row.id] = {
      id: row.id,
      name: row.name,
      order: row.sort_order,
      emojiIds: Array.isArray(row.emoji_ids) ? row.emoji_ids : [],
    };
  });
  return categories;
}

function mapCategoriesToRows(categories: EmojiCategoryMap) {
  return Object.values(categories).map((category) => ({
    id: category.id,
    name: category.name,
    sort_order: category.order,
    emoji_ids: category.emojiIds ?? [],
  }));
}

async function loadEmojiCategoriesFromFile(): Promise<EmojiCategoryMap> {
  try {
    const data = await fs.readFile(CATEGORY_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function loadEmojiCategories(): Promise<EmojiCategoryMap> {
  const client = createAdminClient();
  const { data, error } = await client
    .from("emoji_categories")
    .select("id, name, sort_order, emoji_ids")
    .order("sort_order", { ascending: true });

  if (!error && Array.isArray(data)) {
    if (data.length > 0) {
      return mapRowsToCategories(data);
    }

    const fileCategories = await loadEmojiCategoriesFromFile();
    if (Object.keys(fileCategories).length > 0) {
      await saveEmojiCategories(fileCategories);
      return fileCategories;
    }

    return {};
  }

  return await loadEmojiCategoriesFromFile();
}

export async function saveEmojiCategories(categories: EmojiCategoryMap): Promise<void> {
  const client = createAdminClient();
  const rows = mapCategoriesToRows(categories);

  if (rows.length > 0) {
    await client.from("emoji_categories").upsert(rows, { onConflict: "id" });
    const ids = rows.map((row) => `'${row.id.replace(/'/g, "''")}'`).join(",");
    if (ids) {
      await client.from("emoji_categories").delete().not("id", "in", `(${ids})`);
    }
  } else {
    await client.from("emoji_categories").delete();
  }
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
