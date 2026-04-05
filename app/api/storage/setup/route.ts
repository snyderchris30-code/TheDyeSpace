import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { Pool } from "pg";

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

function getDatabaseUrl() {
  return process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL || null;
}

function buildPgPool(connectionString: string) {
  return new Pool({
    connectionString,
    // Supabase-managed Postgres may present a cert chain that fails strict verification in some runtimes.
    ssl: { rejectUnauthorized: false },
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
  const databaseUrl = getDatabaseUrl();

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(supabaseUrl),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceRoleKey),
    DATABASE_URL: Boolean(databaseUrl),
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
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("Missing SUPABASE_DB_URL (or POSTGRES_URL / DATABASE_URL) for SQL policy setup.");
  }

  const runPolicySql = async () => {
    const pool = buildPgPool(databaseUrl);

    try {
      await pool.query("begin");
      await pool.query("alter table storage.objects enable row level security");

      await pool.query('drop policy if exists "posts_authenticated_upload" on storage.objects');
      await pool.query('drop policy if exists "posts_authenticated_update_own" on storage.objects');
      await pool.query('drop policy if exists "posts_public_read" on storage.objects');

      await pool.query(`
        create policy "posts_authenticated_upload"
        on storage.objects
        for insert
        to authenticated
        with check (bucket_id = 'posts')
      `);

      await pool.query(`
        create policy "posts_authenticated_update_own"
        on storage.objects
        for update
        to authenticated
        using (bucket_id = 'posts' and owner = auth.uid())
        with check (bucket_id = 'posts' and owner = auth.uid())
      `);

      await pool.query(`
        create policy "posts_public_read"
        on storage.objects
        for select
        to anon, authenticated
        using (bucket_id = 'posts')
      `);

      await pool.query("commit");
    } catch (error) {
      try {
        await pool.query("rollback");
      } catch {
        // ignore rollback errors
      }
      throw error;
    } finally {
      await pool.end();
    }
  };

  try {
    await runPolicySql();
  } catch (firstError) {
    const firstMessage = errorToMessage(firstError, "Unknown SQL error.");
    console.error("[storage/setup] First attempt failed:", firstMessage);
    // Retry once for transient TLS/network failures.
    await runPolicySql();
  }
}

async function runSetup() {
  // Build the service-role client first as requested and ensure the posts bucket exists.
  await ensurePostsBucket();
  await setupStoragePolicies();

  return NextResponse.json({
    ok: true,
    bucket: POSTS_BUCKET,
    policies: [
      "posts_authenticated_upload",
      "posts_authenticated_update_own",
      "posts_public_read",
    ],
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
