import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin-utils";
import {
  PRIVATE_ROOM_POSTS_BUCKET,
  PRIVATE_ROOM_PROFILE_SELECT,
  canAccessPrivateRoom,
  getPrivateRoomExpiryIso,
  parsePrivateRoomKey,
  type PrivateRoomAccessProfile,
  type PrivateRoomKey,
} from "@/lib/private-rooms";

type RoomPostRow = {
  id: string;
  room: PrivateRoomKey;
  user_id: string;
  content: string | null;
  image_bucket: string | null;
  image_path: string | null;
  created_at: string;
  expires_at: string;
};

type AuthorRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  verified_badge?: boolean | null;
  member_number?: number | null;
};

async function cleanupExpiredRoomPosts(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.from("room_posts").delete().lte("expires_at", new Date().toISOString());
  if (error) {
    throw error;
  }
}

async function resolveAuthorizedUser(room: PrivateRoomKey) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, adminClient: null as ReturnType<typeof createAdminClient> | null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const adminClient = createAdminClient();
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select(PRIVATE_ROOM_PROFILE_SELECT)
    .eq("id", user.id)
    .limit(1)
    .maybeSingle<PrivateRoomAccessProfile>();

  if (profileError) {
    throw profileError;
  }

  if (!canAccessPrivateRoom(profile, room)) {
    return { user: null, adminClient, error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }

  return { user, adminClient, error: undefined as NextResponse<unknown> | undefined };
}

export async function GET(req: NextRequest) {
  try {
    const room = parsePrivateRoomKey(req.nextUrl.searchParams.get("room"));
    if (!room) {
      return NextResponse.json({ error: "A valid room is required." }, { status: 400 });
    }

    const { user, adminClient, error } = await resolveAuthorizedUser(room);
    if (error || !user || !adminClient) {
      return error;
    }

    await cleanupExpiredRoomPosts(adminClient);

    const { data: posts, error: postsError } = await adminClient
      .from("room_posts")
      .select("id, room, user_id, content, image_bucket, image_path, created_at, expires_at")
      .eq("room", room)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

    if (postsError) {
      throw postsError;
    }

    const rows = (posts || []) as RoomPostRow[];
    const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
    const authorMap = new Map<string, AuthorRow>();

    if (userIds.length) {
      const { data: authors, error: authorsError } = await adminClient
        .from("profiles")
        .select("id, username, display_name, verified_badge, member_number")
        .in("id", userIds);

      if (authorsError) {
        throw authorsError;
      }

      (authors || []).forEach((author) => {
        authorMap.set(author.id, author as AuthorRow);
      });
    }

    const signedUrlMap = new Map<string, string | null>();
    await Promise.all(
      rows.map(async (row) => {
        if (!row.image_path) {
          signedUrlMap.set(row.id, null);
          return;
        }

        const bucket = row.image_bucket || PRIVATE_ROOM_POSTS_BUCKET;
        const { data, error: signedUrlError } = await adminClient.storage.from(bucket).createSignedUrl(row.image_path, 3600);
        if (signedUrlError) {
          signedUrlMap.set(row.id, null);
          return;
        }

        signedUrlMap.set(row.id, data.signedUrl);
      })
    );

    return NextResponse.json({
      posts: rows.map((row) => ({
        ...row,
        image_url: signedUrlMap.get(row.id) || null,
        author: authorMap.get(row.user_id) || null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to load room posts." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      room?: string;
      content?: string;
      imageBucket?: string | null;
      imagePath?: string | null;
    };

    const room = parsePrivateRoomKey(body.room);
    if (!room) {
      return NextResponse.json({ error: "A valid room is required." }, { status: 400 });
    }

    const { user, adminClient, error } = await resolveAuthorizedUser(room);
    if (error || !user || !adminClient) {
      return error;
    }

    await cleanupExpiredRoomPosts(adminClient);

    const content = typeof body.content === "string" ? body.content.trim().slice(0, 1500) : "";
    const imageBucket = typeof body.imageBucket === "string" && body.imageBucket.trim() ? body.imageBucket.trim() : null;
    const imagePath = typeof body.imagePath === "string" && body.imagePath.trim() ? body.imagePath.trim() : null;

    if (!content && !imagePath) {
      return NextResponse.json({ error: "Add some text or a photo before posting." }, { status: 400 });
    }

    if (imagePath && imageBucket !== PRIVATE_ROOM_POSTS_BUCKET) {
      return NextResponse.json({ error: "Invalid image bucket." }, { status: 400 });
    }

    const expiresAt = getPrivateRoomExpiryIso();
    const { data: inserted, error: insertError } = await adminClient
      .from("room_posts")
      .insert({
        room,
        user_id: user.id,
        content: content || null,
        image_bucket: imageBucket,
        image_path: imagePath,
        expires_at: expiresAt,
      })
      .select("id, room, user_id, content, image_bucket, image_path, created_at, expires_at")
      .limit(1)
      .maybeSingle<RoomPostRow>();

    if (insertError || !inserted) {
      throw insertError || new Error("Failed to create room post.");
    }

    const { data: author } = await adminClient
      .from("profiles")
      .select("id, username, display_name, verified_badge, member_number")
      .eq("id", user.id)
      .limit(1)
      .maybeSingle<AuthorRow>();

    const imageUrl = imagePath
      ? (await adminClient.storage.from(PRIVATE_ROOM_POSTS_BUCKET).createSignedUrl(imagePath, 3600)).data?.signedUrl || null
      : null;

    return NextResponse.json({
      post: {
        ...inserted,
        image_url: imageUrl,
        author: author || null,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to create room post." },
      { status: 500 }
    );
  }
}