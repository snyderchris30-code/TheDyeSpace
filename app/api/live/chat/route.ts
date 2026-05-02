import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin-utils";
import { appendLiveChatMessage, listLiveChatMessages } from "@/app/api/live/store";

type LiveChatAuthorRow = {
  id: string;
  username: string | null;
  display_name: string | null;
};

function normalizeMessage(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 400);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const hostUserId = url.searchParams.get("hostUserId")?.trim();

    if (!hostUserId) {
      return NextResponse.json({ error: "hostUserId is required." }, { status: 400 });
    }

    return NextResponse.json({ messages: listLiveChatMessages(hostUserId) });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load live chat." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { hostUserId?: string; message?: string };
    const hostUserId = typeof body.hostUserId === "string" ? body.hostUserId.trim() : "";
    const message = normalizeMessage(body.message);

    if (!hostUserId) {
      return NextResponse.json({ error: "hostUserId is required." }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: author, error: authorError } = await adminClient
      .from("profiles")
      .select("id,username,display_name")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle<LiveChatAuthorRow>();

    if (authorError) {
      throw authorError;
    }

    const createdAt = new Date().toISOString();
    const nextMessages = appendLiveChatMessage({
      id: crypto.randomUUID(),
      hostUserId,
      userId: user.id,
      username: author?.username ?? null,
      displayName: author?.display_name ?? null,
      message,
      createdAt,
    });

    return NextResponse.json({ messages: nextMessages });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to post live chat message." },
      { status: 500 }
    );
  }
}
