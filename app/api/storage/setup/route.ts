import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const POSTS_BUCKET = "posts";

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function errorToMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

async function healthCheck() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(supabaseUrl),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceRoleKey),
  };

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      env,
      checks: {
        serviceClient: false,
        bucketList: false,
      },
    };
  }

  try {
    const adminClient = getServiceClient();
    const { error } = await adminClient.storage.listBuckets();
    return {
      ok: !error,
      env,
      checks: {
        serviceClient: true,
        bucketList: !error,
      },
      bucketListError: error?.message ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      env,
      checks: {
        serviceClient: false,
        bucketList: false,
      },
      error: errorToMessage(error, "Health check failed."),
    };
  }
}

async function ensurePostsBucket() {
  const adminClient = getServiceClient();
  const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
  if (listError) {
    throw new Error(`Failed to list buckets: ${listError.message}`);
  }

  const existing = buckets.find((bucket) => bucket.name === POSTS_BUCKET);
  if (existing) {
    if (!existing.public) {
      const { error: updateError } = await adminClient.storage.updateBucket(POSTS_BUCKET, {
        public: true,
      });
      if (updateError) {
        throw new Error(`Failed to update posts bucket: ${updateError.message}`);
      }
    }
    return;
  }

  const { error: createError } = await adminClient.storage.createBucket(POSTS_BUCKET, {
    public: true,
  });
  if (createError) {
    throw new Error(`Failed to create posts bucket: ${createError.message}`);
  }
}

async function setupStoragePolicies() {
  const adminClient = getServiceClient();

  // Service-role client can configure buckets directly.
  // SQL-level policy DDL is not available through Supabase JS alone,
  // so we return clear status for policy requirements.
  const { error: listError } = await adminClient.storage.from(POSTS_BUCKET).list("", {
    limit: 1,
    offset: 0,
  });

  if (listError) {
    throw new Error(`Unable to validate '${POSTS_BUCKET}' bucket access: ${listError.message}`);
  }

  return {
    enabledRls: "manual",
    insertPolicy: "manual",
    updateOwnPolicy: "manual",
    selectPublicPolicy: "manual",
    note:
      "Supabase JS service-role client cannot execute SQL DDL for storage.objects policies. Use Supabase SQL Editor once for policy creation.",
  };
}

async function runSetup() {
  // Build the service-role client first as requested and ensure the posts bucket exists.
  await ensurePostsBucket();
  const policyStatus = await setupStoragePolicies();

  return NextResponse.json({
    ok: true,
    bucket: POSTS_BUCKET,
    policies: policyStatus,
    message: "Storage setup completed with service_role client. No DB URL required.",
  });
}

export async function GET(req: NextRequest) {
  try {
    const health = await healthCheck();
    if (req.nextUrl.searchParams.get("health") === "1") {
      return NextResponse.json({ ok: health.ok, health }, { status: health.ok ? 200 : 500 });
    }

    if (!health.ok) {
      return NextResponse.json({ ok: false, health }, { status: 500 });
    }

    return await runSetup();
  } catch (error: any) {
    console.error("[storage/setup][GET]", error);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to configure storage policies." },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const health = await healthCheck();
    if (!health.ok) {
      return NextResponse.json({ ok: false, health }, { status: 500 });
    }

    return await runSetup();
  } catch (error: any) {
    console.error("[storage/setup][POST]", error);
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to configure storage policies." },
      { status: 500 }
    );
  }
}
