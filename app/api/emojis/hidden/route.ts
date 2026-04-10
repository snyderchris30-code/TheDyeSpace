import { NextRequest, NextResponse } from "next/server";
import {
  loadHiddenEmojis,
  hideEmoji,
  unhideEmoji,
  deleteEmojiFile,
} from "@/lib/emoji-hidden";
import { listCustomEmojiAssets } from "@/lib/custom-emoji-registry";

export async function GET() {
  const hidden = await loadHiddenEmojis();
  return NextResponse.json(hidden);
}

export async function POST(req: NextRequest) {
  try {
    const { emojiId } = await req.json();
    await hideEmoji(emojiId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[emojis/hidden] Failed to hide emoji", { error });
    return NextResponse.json({ error: error?.message || "Failed to hide emoji." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { emojiId } = await req.json();
    await unhideEmoji(emojiId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[emojis/hidden] Failed to unhide emoji", { error });
    return NextResponse.json({ error: error?.message || "Failed to unhide emoji." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { emojiId } = await req.json();
    const emojis = await listCustomEmojiAssets();
    const emoji = emojis.find((e) => e.id === emojiId);
    if (emoji) {
      await deleteEmojiFile(emoji);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[emojis/hidden] Failed to delete emoji file", { error });
    return NextResponse.json({ error: error?.message || "Failed to delete emoji file." }, { status: 500 });
  }
}
