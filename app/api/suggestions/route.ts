import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SuggestionBody = {
  name?: string;
  email?: string;
  message?: string;
};

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

function normalizeOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as SuggestionBody;
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const adminClient = createAdminClient();
    const { error } = await adminClient.from("suggestions").insert({
      user_id: user?.id ?? null,
      name: normalizeOptional(body.name),
      email: normalizeOptional(body.email),
      message,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: typeof error?.message === "string" ? error.message : "Failed to submit suggestion." },
      { status: 500 }
    );
  }
}