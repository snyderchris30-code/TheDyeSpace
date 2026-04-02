import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const REQUIRED_BUCKETS = ["avatars", "banners", "posts"] as const;

export async function POST() {
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: service role key missing" },
      { status: 500 }
    );
  }

  const adminClient = createServiceClient(serviceUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  for (const bucketName of REQUIRED_BUCKETS) {
    const existingBucket = buckets.find((bucket) => bucket.name === bucketName);

    if (!existingBucket) {
      const { error: createError } = await adminClient.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      });

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }

      continue;
    }

    if (!existingBucket.public) {
      const { error: updateError } = await adminClient.storage.updateBucket(bucketName, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      });

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
