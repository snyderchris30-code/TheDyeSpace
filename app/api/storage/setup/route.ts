import { NextResponse } from "next/server";
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

  const pool = new Pool({ connectionString: databaseUrl });

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
    await pool.query("rollback");
    throw error;
  } finally {
    await pool.end();
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

export async function GET() {
  try {
    return await runSetup();
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to configure storage policies." },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    return await runSetup();
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to configure storage policies." },
      { status: 500 }
    );
  }
}
