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
  try {
    const { name } = await req.json();
    const category = await createCategory(name);
    return NextResponse.json(category);
  } catch (error: any) {
    console.error("[emojis/categories] Failed to create category", { error });
    return NextResponse.json({ error: error?.message || "Failed to create emoji category." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

    if (Array.isArray(body.categories)) {
      await reorderCategories(body.categories);
    } else {
      await saveEmojiCategories(body.categories);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[emojis/categories] Failed to save categories", { error });
    return NextResponse.json({ error: error?.message || "Failed to save emoji categories." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { emojiId, categoryId } = await req.json();
    await assignEmojiToCategory(emojiId, categoryId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[emojis/categories] Failed to assign emoji to category", { error });
    return NextResponse.json({ error: error?.message || "Failed to assign emoji to category." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await deleteCategory(id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[emojis/categories] Failed to delete category", { error });
    return NextResponse.json({ error: error?.message || "Failed to delete emoji category." }, { status: 500 });
  }
}
