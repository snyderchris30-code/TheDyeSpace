# AI Watcher

Required Edge Function secrets:

- `AI_WATCHER_CRON_TOKEN`
- `OPENAI_API_KEY` or `XAI_API_KEY`
- `AI_WATCHER_PROVIDER` (`openai` or `grok`, optional)
- `AI_WATCHER_MODEL` (optional)

Required Vault secrets for the scheduled cron invocation:

- `project_url`
- `ai_watcher_cron_token`

Deploy with:

```bash
supabase functions deploy ai-watcher
```