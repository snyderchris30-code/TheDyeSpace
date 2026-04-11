import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_BUCKETS = new Set(["avatars", "banners", "posts"]);
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const FILE_SIZE_LIMIT = 10 * 1024 * 1024;

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Server misconfiguration: service role key missing");
  }

  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function ensureBucket(adminClient: ReturnType<typeof getServiceClient>, bucketName: string) {
  const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
  if (listError) {
    throw new Error(listError.message);
  }

  const existingBucket = buckets.find((bucket) => bucket.name === bucketName);
  if (!existingBucket) {
    const { error: createError } = await adminClient.storage.createBucket(bucketName, {
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
    const { error: updateError } = await adminClient.storage.updateBucket(bucketName, {
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
    const bucketValue = String(formData.get("bucket") || "avatars").trim();
    const bucket = ALLOWED_BUCKETS.has(bucketValue) ? bucketValue : "avatars";
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type || "unknown"}.` }, { status: 400 });
    }

    if (file.size > FILE_SIZE_LIMIT) {
      return NextResponse.json({ error: "File exceeds the 10 MB limit." }, { status: 400 });
    }

    const adminClient = getServiceClient();
    await ensureBucket(adminClient, bucket);

    const fileExt = file.name.split(".").pop() || "png";
    const safeName = sanitizeFilenamePart(file.name.split(".").slice(0, -1).join(".") || "upload");
    const filePath = `${user.id}/${Date.now()}-${safeName}.${fileExt}`;

    const { error: uploadError } = await adminClient.storage
      .from(bucket)
      .upload(filePath, Buffer.from(await file.arrayBuffer()), {
        upsert: true,
        contentType: file.type || undefined,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = adminClient.storage.from(bucket).getPublicUrl(filePath);

    return NextResponse.json({ publicUrl, bucket, filePath });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Upload failed." },
      { status: 500 }
    );
  }
}
