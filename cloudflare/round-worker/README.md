# Movie Club round Worker

This Worker replaces the Netlify `round-admin` function and `round-timer` scheduled function.

It intentionally supports the existing `/.netlify/functions/round-admin` path so the frontend can continue using the same endpoint after Cloudflare routing is enabled.

## Secrets

Set these as encrypted Worker secrets for each environment:

```sh
npx wrangler secret put ROUND_ADMIN_TOKEN --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put ROUND_ADMIN_TOKEN --env production
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
```

The staging Worker should use a staging Supabase project before any real round actions are tested there. The production Worker uses the existing production Supabase project.

## Deploy

```sh
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

Configure Cloudflare routes for the Worker on:

- `staging.amovieclub.com/.netlify/functions/*`
- `amovieclub.com/.netlify/functions/*`

The Cron Trigger runs every five minutes and invokes `mc_process_due_rounds`.
