import { NextRequest, NextResponse } from "next/server";
import {
  loadEmojiCategories,
  saveEmojiCategories,
  createCategory,
  deleteCategory,
  assignEmojiToCategory,
  reorderCategories,
} from "@/lib/emoji-category";

export async function GET() {
  const categories = await loadEmojiCategories();
  return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const category = await createCategory(name);
  return NextResponse.json(category);
}

export async function PUT(req: NextRequest) {
  const { categories } = await req.json();
  await saveEmojiCategories(categories);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const { emojiId, categoryId } = await req.json();
  await assignEmojiToCategory(emojiId, categoryId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deleteCategory(id);
  return NextResponse.json({ ok: true });
}
