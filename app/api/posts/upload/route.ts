import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const POSTS_BUCKET = "posts";
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_COUNT = 10;
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

function createAdminClient() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }

  return createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

async function ensurePostsBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
  if (listError) {
    throw new Error(listError.message);
  }

  const existingBucket = buckets.find((bucket) => bucket.name === POSTS_BUCKET);
  if (!existingBucket) {
    const { error: createError } = await adminClient.storage.createBucket(POSTS_BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    if (createError) {
      throw new Error(createError.message);
    }
    return;
  }

  if (!existingBucket.public) {
    const { error: updateError } = await adminClient.storage.updateBucket(POSTS_BUCKET, {
      public: true,
      fileSizeLimit: FILE_SIZE_LIMIT,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    });

    if (updateError) {
      throw new Error(updateError.message);
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
    const files = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File)
      .slice(0, MAX_IMAGE_COUNT);

    if (!files.length) {
      return NextResponse.json({ error: "At least one image is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    await ensurePostsBucket(adminClient);

    const imageUrls: string[] = [];
    for (const [index, file] of files.entries()) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return NextResponse.json({ error: `Unsupported image type: ${file.type || "unknown"}.` }, { status: 400 });
      }

      if (file.size > FILE_SIZE_LIMIT) {
        return NextResponse.json({ error: `${file.name} exceeds the 10 MB limit.` }, { status: 400 });
      }

      const fileExt = file.name.split(".").pop() || "png";
      const filePath = `${user.id}/${Date.now()}-${index}.${fileExt}`;
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await adminClient.storage
        .from(POSTS_BUCKET)
        .upload(filePath, fileBuffer, { upsert: true, contentType: file.type || undefined });

      if (uploadError) {
        return NextResponse.json({ error: uploadError.message }, { status: 500 });
      }

      const {
        data: { publicUrl },
      } = adminClient.storage.from(POSTS_BUCKET).getPublicUrl(filePath);
      imageUrls.push(publicUrl);
    }

    return NextResponse.json({ imageUrls });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to upload post images." },
      { status: 500 }
    );
  }
}