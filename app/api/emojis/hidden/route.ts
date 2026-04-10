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
  const { emojiId } = await req.json();
  await hideEmoji(emojiId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const { emojiId } = await req.json();
  await unhideEmoji(emojiId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { emojiId } = await req.json();
  const emojis = await listCustomEmojiAssets();
  const emoji = emojis.find((e) => e.id === emojiId);
  if (emoji) {
    await deleteEmojiFile(emoji);
  }
  return NextResponse.json({ ok: true });
}
