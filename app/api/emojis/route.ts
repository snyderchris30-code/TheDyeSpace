import { NextResponse } from "next/server";

import { listCustomEmojiAssets } from "@/lib/custom-emoji-registry";

export async function GET() {
  try {
    const emojis = await listCustomEmojiAssets();
    return NextResponse.json({ emojis, emojiUrls: emojis.map((emoji) => emoji.url) });
  } catch (error: any) {
    console.error("[emojis] Failed to load emoji assets", {
      error: error?.message || error,
    });
    return NextResponse.json({ error: "Failed to load emoji assets." }, { status: 500 });
  }
}