import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin-utils";
import { canAccessPrivateRoom, parsePrivateRoomKey } from "@/lib/private-rooms";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessSmokeLounge } from "@/lib/verified-seller";

type ChatRoomId = "smoke_room" | "smoke_room_2" | "psychonautics" | "admin_room";

type ChatMessageRow = {
  id: string;
  user_id: string;
  content: string;
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

type ViewerProfile = ChatAuthorRow & {
  role?: string | null;
  smoke_room_2_invited?: boolean | null;
  psychonautics_access?: boolean | null;
  admin_room_access?: boolean | null;
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

function hasMissingColumnError(error: unknown, columnName: string) {
  const text = typeof (error as any)?.message === "string" ? (error as any).message.toLowerCase() : "";
  return text.includes("could not find") && text.includes(`'${columnName.toLowerCase()}'`);
}

async function loadAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

async function createChatDataClient() {
  try {
    return createAdminClient();
  } catch {
    return await createSupabaseServerClient();
  }
}

async function loadViewerStatus(userId: string | null, dataClient: Awaited<ReturnType<typeof createChatDataClient>>) {
  if (!userId) {
    return null;
  }

  const { data, error } = await dataClient
    .from("profiles")
    .select(
      "id,role,verified_badge,member_number,shadow_banned,shadow_banned_until,smoke_room_2_invited,psychonautics_access,admin_room_access,username,display_name,avatar_url"
    )
    .eq("id", userId)
    .limit(1)
    .maybeSingle<ViewerProfile>();

  if (error) {
    return null;
  }

  return data || null;
}

function canAccessChatRoom(room: string, userId: string | null, profile: ViewerProfile | null) {
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

async function loadMessagesForRooms(dataClient: Awaited<ReturnType<typeof createChatDataClient>>, rooms: string[]) {
  const roomFilter = buildRoomOrFilter(rooms);
  const queryWithRoom = dataClient
    .from("chat_messages")
    .select("id, user_id, content, created_at, room")
    .order("created_at", { ascending: true });

  const responseWithRoom = roomFilter ? await queryWithRoom.or(roomFilter) : await queryWithRoom;

  if (!responseWithRoom.error) {
    return (responseWithRoom.data || []) as ChatMessageRow[];
  }

  if (!hasMissingColumnError(responseWithRoom.error, "room")) {
    return [] as ChatMessageRow[];
  }

  if (!rooms.includes("smoke_room")) {
    return [] as ChatMessageRow[];
  }

  const responseWithoutRoom = await dataClient
    .from("chat_messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: true });

  if (responseWithoutRoom.error) {
    return [] as ChatMessageRow[];
  }

  return ((responseWithoutRoom.data || []) as Array<Omit<ChatMessageRow, "room">>).map((row) => ({
    ...row,
    room: "smoke_room",
  }));
}

async function loadAuthors(dataClient: Awaited<ReturnType<typeof createChatDataClient>>, messages: ChatMessageRow[]) {
  const userIds = Array.from(new Set(messages.map((message) => message.user_id).filter(Boolean)));
  if (!userIds.length) {
    return new Map<string, ChatAuthorRow>();
  }

  const { data, error } = await dataClient
    .from("profiles")
    .select("id, username, display_name, verified_badge, member_number, shadow_banned, shadow_banned_until, avatar_url")
    .in("id", userIds);

  if (error) {
    return new Map<string, ChatAuthorRow>();
  }

  return new Map<string, ChatAuthorRow>((data || []).map((profile) => [profile.id, profile as ChatAuthorRow]));
}

function serializeMessages(messages: ChatMessageRow[], authors: Map<string, ChatAuthorRow>) {
  return messages.map((message) => {
    const author = authors.get(message.user_id) || null;
    return {
      id: message.id,
      user_id: message.user_id,
      username: author?.username || author?.display_name || "DyeSpace User",
      message: message.content,
      created_at: message.created_at,
      room: normalizeChatRoom(message.room) || message.room,
      author,
    };
  });
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
    const dataClient = await createChatDataClient();
    const profile = await loadViewerStatus(user?.id || null, dataClient);
    const allowedRooms = requestedRooms.filter((room) => canAccessChatRoom(room, user?.id || null, profile));

    if (!allowedRooms.length) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }

    const messages = await loadMessagesForRooms(dataClient, allowedRooms);
    const authors = await loadAuthors(dataClient, messages);
    return NextResponse.json({ messages: serializeMessages(messages, authors) });
  } catch (error: any) {
    console.error("Chat messages GET failed", error);
    return NextResponse.json({ messages: [] });
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

    const dataClient = await createChatDataClient();
    const profile = await loadViewerStatus(user.id, dataClient);
    if (!canAccessChatRoom(room, user.id, profile)) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }

    const { data, error } = await dataClient
      .from("chat_messages")
      .insert({
        user_id: user.id,
        content: message,
        room,
      })
      .select("id, user_id, content, created_at, room")
      .limit(1)
      .maybeSingle<ChatMessageRow>();

    if (error && hasMissingColumnError(error, "room")) {
      if (room !== "smoke_room") {
        return NextResponse.json({ error: "This room is temporarily unavailable." }, { status: 503 });
      }

      const fallbackInsert = await dataClient
        .from("chat_messages")
        .insert({
          user_id: user.id,
          content: message,
        })
        .select("id, user_id, content, created_at")
        .limit(1)
        .maybeSingle<Omit<ChatMessageRow, "room">>();

      if (fallbackInsert.error || !fallbackInsert.data) {
        throw fallbackInsert.error || new Error("Failed to save chat message.");
      }

      const inserted = { ...fallbackInsert.data, room: "smoke_room" } as ChatMessageRow;
      const authors = await loadAuthors(dataClient, [inserted]);
      return NextResponse.json({ message: serializeMessages([inserted], authors)[0] });
    }

    if (error || !data) {
      throw error || new Error("Failed to save chat message.");
    }

    const authors = await loadAuthors(dataClient, [data]);
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

    const dataClient = await createChatDataClient();
    let existing: { id: string; user_id: string; room: string | null } | null = null;
    let existingError: any = null;

    const existingWithRoom = await dataClient
      .from("chat_messages")
      .select("id, user_id, room")
      .eq("id", messageId)
      .limit(1);

    if (existingWithRoom.error && hasMissingColumnError(existingWithRoom.error, "room")) {
      const fallbackExisting = await dataClient
        .from("chat_messages")
        .select("id, user_id")
        .eq("id", messageId)
        .limit(1)
        .maybeSingle<{ id: string; user_id: string }>();

      existingError = fallbackExisting.error;
      existing = fallbackExisting.data ? { ...fallbackExisting.data, room: "smoke_room" } : null;
    } else {
      existingError = existingWithRoom.error;
      existing = existingWithRoom.data as { id: string; user_id: string; room: string | null } | null;
    }

    if (existingError || !existing) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    if (existing.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updateWithRoom = await dataClient
      .from("chat_messages")
      .update({ content: message })
      .eq("id", messageId)
      .select("id, user_id, content, created_at, room")
      .limit(1);

    let data: ChatMessageRow | null = null;
    let error: any = updateWithRoom.error;

    if (updateWithRoom.error && hasMissingColumnError(updateWithRoom.error, "room")) {
      const fallbackUpdate = await dataClient
        .from("chat_messages")
        .update({ content: message })
        .eq("id", messageId)
        .select("id, user_id, content, created_at")
        .limit(1)
        .maybeSingle<Omit<ChatMessageRow, "room">>();

      error = fallbackUpdate.error;
      data = fallbackUpdate.data ? ({ ...fallbackUpdate.data, room: "smoke_room" } as ChatMessageRow) : null;
    } else {
      data = updateWithRoom.data as ChatMessageRow | null;
    }

    if (error || !data) {
      throw error || new Error("Failed to update chat message.");
    }

    const authors = await loadAuthors(dataClient, [data]);
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

    const dataClient = await createChatDataClient();
    const { data: existing, error: existingError } = await dataClient
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

    const { error } = await dataClient.from("chat_messages").delete().eq("id", messageId);
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