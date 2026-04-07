import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createRequestLogContext, logError, logInfo, logWarn } from "@/lib/server-logging";

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
  const requestContext = createRequestLogContext(req, "posts/upload");
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logWarn("posts/upload", "Unauthorized upload attempt", {
        ...requestContext,
        authError: authError ? authError.message : null,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const files = formData
      .getAll("images")
      .filter((value): value is File => value instanceof File)
      .slice(0, MAX_IMAGE_COUNT);

    if (!files.length) {
      logWarn("posts/upload", "Rejected upload without files", {
        ...requestContext,
        userId: user.id,
      });
      return NextResponse.json({ error: "At least one image is required." }, { status: 400 });
    }

    logInfo("posts/upload", "Upload request received", {
      ...requestContext,
      userId: user.id,
      fileCount: files.length,
      names: files.map((file) => file.name),
      mimeTypes: files.map((file) => file.type || "unknown"),
    });

    const adminClient = createAdminClient();
    await ensurePostsBucket(adminClient);

    const imageUrls: string[] = [];
    for (const [index, file] of files.entries()) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        logWarn("posts/upload", "Rejected upload with unsupported mime type", {
          ...requestContext,
          userId: user.id,
          fileName: file.name,
          mimeType: file.type || null,
          fileIndex: index,
        });
        return NextResponse.json({ error: `Unsupported image type: ${file.type || "unknown"}.` }, { status: 400 });
      }

      if (file.size > FILE_SIZE_LIMIT) {
        logWarn("posts/upload", "Rejected upload over size limit", {
          ...requestContext,
          userId: user.id,
          fileName: file.name,
          fileSize: file.size,
          fileIndex: index,
        });
        return NextResponse.json({ error: `${file.name} exceeds the 10 MB limit.` }, { status: 400 });
      }

      const fileExt = file.name.split(".").pop() || "png";
      const filePath = `${user.id}/${Date.now()}-${index}.${fileExt}`;
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await adminClient.storage
        .from(POSTS_BUCKET)
        .upload(filePath, fileBuffer, { upsert: true, contentType: file.type || undefined });

      if (uploadError) {
        logError("posts/upload", "Storage upload failed", uploadError, {
          ...requestContext,
          userId: user.id,
          filePath,
          fileName: file.name,
          contentType: file.type,
        });
        return NextResponse.json({ error: uploadError.message }, { status: 500 });
      }

      const {
        data: { publicUrl },
      } = adminClient.storage.from(POSTS_BUCKET).getPublicUrl(filePath);
      imageUrls.push(publicUrl);
    }

    logInfo("posts/upload", "Upload succeeded", {
      ...requestContext,
      userId: user.id,
      imageCount: imageUrls.length,
    });

    return NextResponse.json({ imageUrls });
  } catch (error: any) {
    logError("posts/upload", "Unexpected failure", error, requestContext);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to upload post images." },
      { status: 500 }
    );
  }
}