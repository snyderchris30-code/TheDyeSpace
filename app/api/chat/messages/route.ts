import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, loadProfileStatus } from "@/lib/admin-utils";
import { canAccessPrivateRoom, parsePrivateRoomKey } from "@/lib/private-rooms";
import { resolveProfileUsername } from "@/lib/profile-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessSmokeLounge } from "@/lib/verified-seller";

type ChatRoomId = "smoke_room" | "smoke_room_2" | "psychonautics" | "admin_room";

type ChatMessageRow = {
  id: string;
  user_id: string;
  username: string;
  message: string;
  created_at: string;
  room: string | null;
};

type ChatAuthorRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
  shadow_banned?: boolean | null;
  shadow_banned_until?: string | null;
  avatar_url?: string | null;
};

function normalizeChatRoom(room: string | null | undefined) {
  const normalized = String(room || "smoke_room").trim();
  if (!normalized || normalized === "smoke_room") {
    return "smoke_room";
  }

  if (normalized === "smoke_room_2" || normalized === "psychonautics" || normalized === "admin_room") {
    return normalized as ChatRoomId;
  }

  if (/^fan_chat_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized;
  }

  return null;
}

function buildRoomOrFilter(rooms: string[]) {
  return rooms
    .flatMap((room) => {
      if (room === "smoke_room") {
        return ["room.eq.smoke_room", "room.is.null"];
      }

      return [`room.eq.${room}`];
    })
    .join(",");
}

async function loadAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

async function loadViewerStatus(userId: string | null) {
  if (!userId) {
    return null;
  }

  const adminClient = createAdminClient();
  const profile = await loadProfileStatus(adminClient, userId);
  return profile;
}

function canAccessChatRoom(room: string, userId: string | null, profile: Awaited<ReturnType<typeof loadViewerStatus>>) {
  if (room === "smoke_room") {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (room === "smoke_room_2") {
    return canAccessSmokeLounge(profile);
  }

  const privateRoom = parsePrivateRoomKey(room);
  if (privateRoom) {
    return canAccessPrivateRoom(profile, privateRoom);
  }

  if (room.startsWith("fan_chat_")) {
    return true;
  }

  return false;
}

async function loadMessagesForRooms(adminClient: ReturnType<typeof createAdminClient>, rooms: string[]) {
  const roomFilter = buildRoomOrFilter(rooms);
  const query = adminClient
    .from("chat_messages")
    .select("id, user_id, username, message, created_at, room")
    .order("created_at", { ascending: true });

  const response = roomFilter ? await query.or(roomFilter) : await query;

  if (response.error) {
    throw response.error;
  }

  return (response.data || []) as ChatMessageRow[];
}

async function loadAuthors(adminClient: ReturnType<typeof createAdminClient>, messages: ChatMessageRow[]) {
  const userIds = Array.from(new Set(messages.map((message) => message.user_id).filter(Boolean)));
  if (!userIds.length) {
    return new Map<string, ChatAuthorRow>();
  }

  const { data, error } = await adminClient
    .from("profiles")
    .select("id, username, display_name, verified_badge, member_number, shadow_banned, shadow_banned_until, avatar_url")
    .in("id", userIds);

  if (error) {
    throw error;
  }

  return new Map<string, ChatAuthorRow>((data || []).map((profile) => [profile.id, profile as ChatAuthorRow]));
}

function serializeMessages(messages: ChatMessageRow[], authors: Map<string, ChatAuthorRow>) {
  return messages.map((message) => ({
    ...message,
    room: normalizeChatRoom(message.room) || message.room,
    author: authors.get(message.user_id) || null,
  }));
}

export async function GET(req: NextRequest) {
  try {
    const requestedRooms = (req.nextUrl.searchParams.get("rooms") || req.nextUrl.searchParams.get("room") || "")
      .split(",")
      .map((value) => normalizeChatRoom(value))
      .filter((value): value is string => Boolean(value));

    if (!requestedRooms.length) {
      return NextResponse.json({ messages: [] });
    }

    const user = await loadAuthenticatedUser();
    const profile = await loadViewerStatus(user?.id || null);
    const allowedRooms = requestedRooms.filter((room) => canAccessChatRoom(room, user?.id || null, profile));

    if (!allowedRooms.length) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const messages = await loadMessagesForRooms(adminClient, allowedRooms);
    const authors = await loadAuthors(adminClient, messages);
    return NextResponse.json({ messages: serializeMessages(messages, authors) });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load chat messages." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await loadAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { room?: string; message?: string };
    const room = normalizeChatRoom(body.room);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";

    if (!room || !message) {
      return NextResponse.json({ error: "Room and message are required." }, { status: 400 });
    }

    const profile = await loadViewerStatus(user.id);
    if (!canAccessChatRoom(room, user.id, profile)) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const actorName = resolveProfileUsername(undefined, user.user_metadata?.username, user.email, user.id);
    const { data, error } = await adminClient
      .from("chat_messages")
      .insert({
        user_id: user.id,
        username: actorName,
        message,
        room,
      })
      .select("id, user_id, username, message, created_at, room")
      .limit(1)
      .maybeSingle<ChatMessageRow>();

    if (error || !data) {
      throw error || new Error("Failed to save chat message.");
    }

    const authors = await loadAuthors(adminClient, [data]);
    return NextResponse.json({ message: serializeMessages([data], authors)[0] });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to save chat message." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await loadAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { messageId?: string; message?: string };
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";

    if (!messageId || !message) {
      return NextResponse.json({ error: "messageId and message are required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: existing, error: existingError } = await adminClient
      .from("chat_messages")
      .select("id, user_id, room")
      .eq("id", messageId)
      .limit(1)
      .maybeSingle<{ id: string; user_id: string; room: string | null }>();

    if (existingError || !existing) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await adminClient
      .from("chat_messages")
      .update({ message })
      .eq("id", messageId)
      .select("id, user_id, username, message, created_at, room")
      .limit(1)
      .maybeSingle<ChatMessageRow>();

    if (error || !data) {
      throw error || new Error("Failed to update chat message.");
    }

    const authors = await loadAuthors(adminClient, [data]);
    return NextResponse.json({ message: serializeMessages([data], authors)[0] });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to update chat message." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await loadAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const messageId = req.nextUrl.searchParams.get("messageId") || "";
    if (!messageId) {
      return NextResponse.json({ error: "messageId is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const { data: existing, error: existingError } = await adminClient
      .from("chat_messages")
      .select("id, user_id")
      .eq("id", messageId)
      .limit(1)
      .maybeSingle<{ id: string; user_id: string }>();

    if (existingError || !existing) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await adminClient.from("chat_messages").delete().eq("id", messageId);
    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to delete chat message." },
      { status: 500 }
    );
  }
}