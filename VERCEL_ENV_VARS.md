# Vercel Environment Variables

Set the following in Vercel Project Settings -> Environment Variables.

## Required Variables

- `NEXT_PUBLIC_SUPABASE_URL`
  - Supabase project URL, e.g. `https://<project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Public anon key, e.g. `sb_publishable_...`
- `SUPABASE_SERVICE_ROLE_KEY`
  - Service role key, e.g. `sb_secret_...`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
  - Web Push VAPID public key used by the browser subscription flow.
- `VAPID_PRIVATE_KEY`
  - Web Push VAPID private key used by the server when sending push notifications.
- `VAPID_SUBJECT`
  - Contact subject for VAPID, usually `mailto:<your-email>` or a public HTTPS URL.

## Scope

- Set all three to at least:
  - `Production`
  - `Preview`

If you also run the app locally via Vercel environment sync, include `Development`.

## Notes

- Do not commit `.env.local`.
- `.env.local` is already ignored via `.gitignore`.
- After any variable change, trigger a new deployment in Vercel.
- Generate VAPID keys with `npx web-push generate-vapid-keys` and place the returned values in Vercel.
- Placeholder example values:
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=REPLACE_WITH_VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY=REPLACE_WITH_VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT=mailto:you@example.com`
