import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin-utils";
import {
  PRIVATE_ROOM_POSTS_BUCKET,
  PRIVATE_ROOM_PROFILE_SELECT,
  canAccessPrivateRoom,
  parsePrivateRoomKey,
  type PrivateRoomAccessProfile,
} from "@/lib/private-rooms";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function ensurePrivateRoomBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
  if (listError) {
    throw listError;
  }

  const existingBucket = buckets.find((bucket) => bucket.name === PRIVATE_ROOM_POSTS_BUCKET);
  if (!existingBucket) {
    const { error: createError } = await adminClient.storage.createBucket(PRIVATE_ROOM_POSTS_BUCKET, {
      public: false,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    if (createError) {
      throw createError;
    }
    return;
  }

  if (existingBucket.public) {
    const { error: updateError } = await adminClient.storage.updateBucket(PRIVATE_ROOM_POSTS_BUCKET, {
      public: false,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    if (updateError) {
      throw updateError;
    }
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

    const formData = await req.formData();
    const room = parsePrivateRoomKey(String(formData.get("room") || ""));
    const file = formData.get("image");

    if (!room) {
      return NextResponse.json({ error: "A valid room is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "An image is required." }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type || "unknown"}.` }, { status: 400 });
    }

    if (file.size > FILE_SIZE_LIMIT) {
      return NextResponse.json({ error: "File exceeds the 10 MB limit." }, { status: 400 });
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
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await ensurePrivateRoomBucket(adminClient);

    const fileExt = file.name.split(".").pop() || "png";
    const safeName = sanitizeFilenamePart(file.name.split(".").slice(0, -1).join(".") || "upload");
    const filePath = `${room}/${user.id}/${Date.now()}-${safeName}.${fileExt}`;

    const { error: uploadError } = await adminClient.storage
      .from(PRIVATE_ROOM_POSTS_BUCKET)
      .upload(filePath, Buffer.from(await file.arrayBuffer()), {
        upsert: true,
        contentType: file.type || undefined,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    return NextResponse.json({ bucket: PRIVATE_ROOM_POSTS_BUCKET, filePath });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to upload room image." },
      { status: 500 }
    );
  }
}