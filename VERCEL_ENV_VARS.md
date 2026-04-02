# Vercel Environment Variables

Set the following in Vercel Project Settings -> Environment Variables.

## Required Variables

- `NEXT_PUBLIC_SUPABASE_URL`
  - Supabase project URL, e.g. `https://<project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Public anon key, e.g. `sb_publishable_...`
- `SUPABASE_SERVICE_ROLE_KEY`
  - Service role key, e.g. `sb_secret_...`

## Scope

- Set all three to at least:
  - `Production`
  - `Preview`

If you also run the app locally via Vercel environment sync, include `Development`.

## Notes

- Do not commit `.env.local`.
- `.env.local` is already ignored via `.gitignore`.
- After any variable change, trigger a new deployment in Vercel.
