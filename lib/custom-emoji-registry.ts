import { promises as fs } from "fs";
import path from "path";

import { buildCustomEmojiAsset, normalizeCustomEmojiUrl, type CustomEmojiAsset } from "@/lib/custom-emojis";

const PUBLIC_EMOJI_DIRECTORY = path.join(process.cwd(), "public", "emojis");
const EMOJI_FILE_PATTERN = /\.(png|gif)$/i;

async function walkEmojiDirectory(directory: string, relativeDirectory = ""): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...(await walkEmojiDirectory(absolutePath, relativePath)));
      continue;
    }

    if (!entry.isFile() || !EMOJI_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    filePaths.push(relativePath.replace(/\\/g, "/"));
  }

  return filePaths;
}

export async function listCustomEmojiAssets(): Promise<CustomEmojiAsset[]> {
  const relativePaths = await walkEmojiDirectory(PUBLIC_EMOJI_DIRECTORY);

  return relativePaths
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }))
    .map((relativePath) => buildCustomEmojiAsset(`/emojis/${relativePath}`));
}

export async function listCustomEmojiUrls(): Promise<string[]> {
  const assets = await listCustomEmojiAssets();
  return assets.map((asset) => asset.url);
}

export async function listCustomEmojiFileNames(): Promise<string[]> {
  const assets = await listCustomEmojiAssets();
  return assets.map((asset) => asset.fileName);
}

export async function getCustomEmojiFileNameSet(): Promise<Set<string>> {
  return new Set(await listCustomEmojiFileNames());
}

export async function getCustomEmojiUrlSet(): Promise<Set<string>> {
  return new Set(await listCustomEmojiUrls());
}