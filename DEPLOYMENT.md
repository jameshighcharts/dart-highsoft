# Deployment Guide

This guide is for someone who has already cloned the repo locally and wants to deploy their own copy of the app with:

- Vercel for the Next.js app
- Supabase for the database and realtime backend
- A persistent worker host such as Railway or Render when using Scolia boards

The repo already contains the database migrations in [`supabase/migrations`](./supabase/migrations), so the main job is:

1. Create your own Supabase project
2. Push this repo's schema to that project
3. Create your own Vercel project
4. Add the required environment variables
5. Deploy

## What This App Needs

Required environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Optional environment variables for AI commentary / TTS:

```env
OPENAI_API_KEY=
COMMENTARY_PERSONA=
COMMENTARY_MODEL=
OPENAI_REALTIME_COMMENTARY_MODEL=gpt-realtime-2.1
```

Sign in with Slack gates the whole app (`/login`) and the `/admin` user panel
(`/signin`); same values as the Compass app. `SLACK_BOT_TOKEN` enables the
Slack member import:

```env
AUTH_SECRET=
AUTH_SLACK_ID=
AUTH_SLACK_SECRET=
AUTH_SLACK_TEAM_ID=
AUTH_SLACK_ALLOWED_EMAIL_DOMAINS=highsoft.com
AUTH_SLACK_ADMIN_EMAILS=your.admin@highsoft.com
SLACK_BOT_TOKEN=
```

See `docs/SLACK_DARTS.md` for the Slack app configuration. Without these,
`/login` and `/signin` report that sign-in is not configured and nobody can
enter the app, so set them before deploying. Also apply migration
`0059_player_avatars_and_nicknames.sql` for profile pictures and nicknames.

Scolia requires one additional secret in both the Next.js app and the worker:

```env
SCOLIA_ACCESS_TOKEN=
```

Notes:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` come from your Supabase project.
- `SUPABASE_SERVICE_ROLE_KEY` is also from Supabase, but it is secret. Do not expose it in client code.
- The app will still run without `OPENAI_API_KEY`, but the commentary and TTS routes will not work.

## Before You Start

Make sure you have:

- A GitHub account
- A Vercel account
- A Supabase account
- Node.js 22+ installed
- `npm install` already run in this repo

If you want the easy GitHub-based deployment flow, put the repo in your own GitHub account first.

## Option 1: Easiest Path For Most People

This is the recommended path:

- Create the Supabase project in the Supabase UI
- Push the schema from your local terminal
- Import the GitHub repo into Vercel in the Vercel UI

### Step 1: Put The Repo In Your Own GitHub Account

If you cloned someone else's repo, create a new GitHub repo in your own account and push your local copy there.

Example:

```bash
git remote -v
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

If you already have your own GitHub repo for this code, skip this step.

### Step 2: Create A Supabase Project In The UI

1. Go to `https://supabase.com/dashboard`
2. Click `New project`
3. Choose your organization
4. Give the project a name
5. Choose a strong database password and save it somewhere safe
6. Pick a region close to your Vercel region
7. Click `Create new project`
8. Wait for the project to finish provisioning

### Step 3: Link Your Local Repo To That Supabase Project

Install the Supabase CLI if you do not already have it, then log in:

```bash
supabase login
```

Now find your project reference in the Supabase dashboard URL. It looks like:

```text
https://supabase.com/dashboard/project/abcdefghijklmnop
```

In this example, the project ref is `abcdefghijklmnop`.

Link this repo to that project:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

It may ask for your database password. Use the password you chose when you created the project.

### Step 4: Push This Repo's Database Migrations To Supabase

Run:

```bash
supabase db push
```

This applies the SQL files in [`supabase/migrations`](./supabase/migrations) to your remote Supabase database.

### Step 5: Copy The Supabase Keys You Need

In the Supabase dashboard:

1. Open your project
2. Go to `Project Settings` -> `API`
3. Copy these values:
   - `Project URL`
   - `anon` / publishable key
   - `service_role` key

You will use them in Vercel as:

```env
NEXT_PUBLIC_SUPABASE_URL=Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=anon key
SUPABASE_SERVICE_ROLE_KEY=service_role key
```

### Step 6: Import The GitHub Repo Into Vercel

1. Go to `https://vercel.com/new`
2. Import your GitHub repository
3. If Vercel asks for GitHub access, allow it
4. Confirm the root directory is the repo root
5. Vercel should detect `Next.js` automatically
6. Open the environment variable section before deploying
7. Add:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=... # optional for scoring; required for direct Scolia Realtime commentary
```

8. If you want commentary and TTS, also add:

```env
OPENAI_API_KEY=...
COMMENTARY_PERSONA=...
COMMENTARY_MODEL=...
```

9. If you use Scolia, also add:

```env
SCOLIA_ACCESS_TOKEN=...
```

10. Click `Deploy`

After the first deploy, every push to the connected GitHub repo creates a Vercel deployment.

### Step 7: Gate Production Releases

The repository's `Tests / test` GitHub check validates migration filenames, runs lint, unit tests, a production build, and three mobile Lighthouse audits. On pushes to `main`, it also waits for the exact production migration history. The timestamped production smoke migration is recorded only after it verifies the pause column and successfully creates a match and throw. Configure GitHub and Vercel once so a failed schema check, database write, or performance budget cannot reach the production domain.

1. Push `.github/workflows/test.yml` to GitHub and let `Tests / test` complete once.
2. Open the GitHub repository's rulesets or branch protection settings.
3. Protect `main`, require a pull request, and require the `Tests / test` status check.
4. If you use GitHub's merge queue, keep the workflow's `merge_group` trigger enabled.
5. Open the Vercel project's **Settings** page, then open **Deployment Checks**.
6. Add the GitHub check named `Tests / test` to the Production environment.
7. Keep automatic production aliasing enabled. Vercel builds the commit, waits for the check, and assigns the production domain only after the check passes.

The Supabase migration workflow and the production phase of `Tests / test` require a GitHub Actions secret named `SUPABASE_ACCESS_TOKEN` and a repository variable named `SUPABASE_PROJECT_ID`. The workflow's legacy baseline is the exact migration name `0055_game_sessions`. Applied migrations are compared by complete name, so another migration cannot be skipped merely because it shares a numeric prefix.

All future files in `supabase/migrations` must use a unique 14-digit UTC timestamp followed by a description, for example:

```text
20260904123000_add_match_column.sql
```

Historical numbered migrations are recorded in `supabase/migrations/legacy-numbered-migrations.txt`; do not add new entries to that allowlist. Validate names locally with:

```bash
node scripts/supabase-migrations.mjs validate
```

The `20260904091825_verify_match_creation_and_throw.sql` migration first verifies that `matches.paused_at` exists, then creates two players, an X01 match, a turn, and a throw. It deletes every test row before it can be recorded in production migration history. Any failed assertion aborts the migration, keeps it out of history, fails `Tests / test`, and prevents Vercel production promotion.

The Lighthouse limits live in `.lighthouserc.json`. Run the same check locally after `npm run build`:

```bash
npm run test:performance
```

GitHub keeps each run's Lighthouse reports as a `lighthouse-reports` artifact for 14 days. Change a budget only after you measure a new baseline and explain why the old limit is no longer valid.

#### Recover a failed, unapplied migration

Follow the [migration recovery rule in AGENTS.md](AGENTS.md#failed-unapplied-migration-recovery). An already authorized deployment may include a correction to a failed, unapplied migration without another policy waiver. Applied migrations remain immutable.

1. Save the failed workflow URL and source commit. Check current migration history by complete name in every retained database that could have received the SQL, including manual application and local reconciliation records. Inspect affected rows and objects to confirm full rollback. A failed workflow or missing history entry alone is insufficient.
2. Reproduce the failure in disposable PostgreSQL with the relevant production constraints, indexes, and triggers. Test the smallest correction, rollback on rejected input, retry behavior, and preservation of IDs, links, aliases, and referenced history as applicable. Keep the original filename and timestamp. Do not weaken constraints or guards to make the SQL pass.
3. Record the evidence and correction in a follow-up PR or durable deployment notes, then use a new corrective commit and the normal review/release gates. Run filename validation and the affected SQL regression checks before deployment. A later migration alone cannot unblock this runner: it stops at the earlier failure.
4. Recheck application history and run **Deploy Supabase Migrations** against the corrected commit on `main`. Do not rerun the old failed job, which uses the original source commit, or run a manual deployment alongside the workflow. The runner skips previously applied complete names and resumes with pending migrations.
5. Confirm exact production migration history, the repaired data invariants, and `Tests / test` before production promotion. History verification alone does not validate the repaired data. Keep the existing deployment and Vercel checks enabled.

If the migration applied in any retained database, or has unresolved partial effects, the in-place exception does not apply. Prepare a forward recovery plan that also addresses databases blocked by the original SQL. Never falsify migration history to skip the failure.

For [PR #43](https://github.com/jameshighcharts/dart-highsoft/pull/43), the [original deployment run](https://github.com/jameshighcharts/dart-highsoft/actions/runs/34321917796) applied `20260909071500_sync_slack_player_names.sql`, then failed `20260909071600_consolidate_mustapha_player.sql` on `players_display_name_key`. The name-sync migration must remain unchanged. The consolidation migration is a candidate for this procedure only after fresh history and rollback checks; its regression must include the unique display-name constraint from `0001_init.sql`.

### Step 8: Verify The Deployment

After Vercel finishes:

1. Open the deployed URL
2. Go to `Players` and create a player
3. Start a new match
4. Confirm that the match page loads and scores save correctly

If that works, your deployment is live.

## Deploying The Persistent Scolia Worker

Vercel runs request-scoped functions and must not host the persistent Scolia WebSocket worker. Deploy the worker as a separate always-on service after the Supabase migrations have been pushed.

The worker requires:

```env
SCOLIA_ACCESS_TOKEN=...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SECRET_KEY` can be used instead of `SUPABASE_SERVICE_ROLE_KEY` when the Supabase project provides the newer secret-key format. Never expose either value to browser code.

### Railway

The worker remains one Node 22 process started by `npm run scolia:worker`.
The script imports `scripts/workerLoader.mjs` to resolve the shared DartIQ/commentary
TypeScript imports (`@/` aliases and extensionless paths) outside Next.js. The
Dockerfile includes this loader; no extra Railway service or build dependency is
needed. Local launches use the same script and require Node 22.15 or newer.

Apply migrations `0062_scolia_worker_notifications.sql` and
`0063_worker_snapshots.sql` along with the preceding commentary migrations before
deploying this version of the app and worker. The worker calls the new snapshot
RPCs, so deploying code before the schema will stop scoring until it is migrated.
The notification migration adds service-role
Realtime wake-ups for outbound corrections and commentary work without granting
browser access to those tables. A 15-second reconciliation poll recovers missed
notifications; incoming darts still arrive directly over the Scolia WebSocket.
Snapshot RPCs retain fresh post-insert scoring reads and return unchanged telemetry
revisions without downloading history. Source-row triggers invalidate revisions
on scoring, corrections, player order, configuration, and evidence changes.

Migration `0064_continuous_dartiq_calibration.sql` adds daily background evaluation
at 02:17 (UTC with the default pg_cron timezone). Deploy the app's
`dartiq_calibration` job handler alongside this migration. It uses the existing
`/api/background-jobs` dispatcher: Supabase Vault must contain
`background_jobs_app_url` and `background_jobs_secret`, and the app's
`BACKGROUND_JOB_SECRET` must match. No new Railway service is needed. Missing
dispatcher configuration leaves jobs queued rather than running calibration.
The evaluator writes private reports only; it neither promotes models nor changes
live predictions. It checks at most four recent model versions per day, with a
90-day / 200-match / 40-prediction-per-match cap, and skips unchanged reports.
This report-only temperature evaluator records geometry coverage; the separate
training job below owns fitted geometry and automatic activation.
The first qualifying temperature report becomes a frozen follow-up candidate for
its model/evaluator version; subsequent daily jobs evaluate only matches started
after that report was saved. This adds no live scoring writes or extra service.
Migration `0065_dartiq_model_training.sql` adds automatic behavioural/spatial
training at 02:27 UTC (default pg_cron timezone), through the same dispatcher and
secrets. Deploy the `dartiq_training` handler with it. No extra Railway service,
dependency, or per-dart job is needed. The registry starts empty: 30 matches / 500
darts fit a candidate; at least 30 further matches / 500 darts are needed before
automatic activation. Geometry has additional per-context validation gates.
New matches pin activated artifacts; existing matches retain their frozen model.
Supported regressions disable the active artifact for future matches automatically.
The first geometry version only covers scoring above 170; checkout aim inference
is not implemented. These thresholds can leave geometry hidden for weeks at low
office volume, which is expected rather than a worker failure.

1. Create another service in the Railway project from this GitHub repository.
2. Configure it to build with `Dockerfile.scolia-worker`.
3. Add the worker environment variables above. Include `OPENAI_API_KEY` when using Realtime commentary.
4. Keep the service private; it does not need a public domain or inbound port.
5. Set the replica count to exactly **one** and disable sleeping/serverless scaling.

Deploy between matches when possible. The new worker retries failed scoring
events in order; commentary delivery runs on a separate queue so provider delays
do not hold up the next dart. Persisted pending darts are recovered on reconnect
and while the worker is idle.

### Render

1. Create a **Background Worker** from this GitHub repository.
2. Use `npm ci` as the build command and `npm run scolia:worker` as the start command, or build `Dockerfile.scolia-worker`.
3. Add the worker environment variables above. Include `OPENAI_API_KEY` when using Realtime commentary.
4. Run exactly **one** instance.

The one-replica rule is important: every worker instance attempts one WebSocket per board, and Scolia rejects competing connections to the same board.

### Verify The Worker

After deployment:

1. Confirm the logs contain `managing N board(s)` and `cloud connection open`.
2. Open `/boards` and confirm the persisted board state.
3. Confirm `Scolia: Connected` and `Board: Ready` have a fresh heartbeat.
4. Start a match with that board and throw one dart.
5. Confirm exactly one app throw appears through Supabase realtime.
6. Use Undo on a current-round dart and confirm the corresponding `scolia_commands` row becomes `acknowledged` or `refused`.

Outbound commands time out after 10 seconds and retry up to three total attempts. A command that never receives a response becomes `failed` instead of remaining stuck as `sent`. Throw events themselves are separately deduplicated and replayed after worker recovery.

Board management is available from `/boards` in production. The worker discovers and persists every board registered to the Scolia account, and ready boards appear in New Match.

## Option 2: CLI-First Deployment

This path is useful if you want to create both projects from the terminal.

## Supabase With The CLI

### Step 1: Log In

```bash
supabase login
```

### Step 2: Find Your Supabase Org ID

```bash
supabase orgs list
```

Pick the org where you want the new project to live.

### Step 3: Create The Supabase Project

Example:

```bash
supabase projects create dart-highsoft-prod \
  --org-id YOUR_ORG_ID \
  --region YOUR_REGION
```

You can also provide `--db-password YOUR_PASSWORD` if you want to set it in the command.

After the project is created, note its project ref.

### Step 4: Link This Repo To The New Supabase Project

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### Step 5: Push The Schema

```bash
supabase db push
```

### Step 6: Get Your Supabase API Values

The simplest way is still the dashboard:

1. Open the project in Supabase
2. Go to `Project Settings` -> `API`
3. Copy the `Project URL`, `anon` key, and `service_role` key

## Vercel With The CLI

### Step 1: Log In

```bash
vercel login
```

### Step 2: Create Or Link The Vercel Project

From the repo root, run:

```bash
vercel link
```

If the project does not exist yet, Vercel can create it during the prompt flow.

### Step 3: Add Environment Variables

Add the required variables at minimum for `production`:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

If you want preview deployments to work too, add the same variables for `preview`:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
vercel env add SUPABASE_SERVICE_ROLE_KEY preview
```

Optional commentary variables:

```bash
vercel env add OPENAI_API_KEY production
vercel env add COMMENTARY_PERSONA production
vercel env add COMMENTARY_MODEL production
```

### Step 4: Deploy

```bash
vercel --prod
```

Vercel will build the app and give you a production URL.

## Important Difference: Vercel GitHub Import vs CLI Deploy

- If you import the repo in the Vercel UI, Vercel connects directly to GitHub and auto-deploys on each push.
- If you only deploy with `vercel --prod`, you are doing manual CLI deployments.

If you want GitHub-based automatic deployments, use the Vercel UI import flow even if you also use the CLI later.

## Does Supabase Need The GitHub Repo Connected?

Not for the first deployment.

For this repo, the important Supabase step is that your remote project gets the SQL schema from [`supabase/migrations`](./supabase/migrations). The simplest reliable way to do that is:

1. Create the project in Supabase
2. Run `supabase link --project-ref ...`
3. Run `supabase db push`

Supabase also has GitHub-connected branching workflows, but that is optional and not required just to get this app live.

## Recommended Production Checklist

Before you call the deploy done, make sure:

- The Supabase project exists
- `supabase db push` ran without errors
- The Vercel project has the three required env vars
- The deployed site can create players and matches
- Vercel and Supabase are in nearby regions

## Troubleshooting

### Error: `function uuid_generate_v4() does not exist`

If `supabase db push` fails on a fresh project with an error like:

```text
ERROR: function uuid_generate_v4() does not exist
```

pull the latest version of this repo and run:

```bash
supabase db push
```

This repo now includes a compatibility migration that creates a `public.uuid_generate_v4()` shim for Supabase projects where `uuid-ossp` lives under the `extensions` schema.

If you are already stuck on a project and want to unblock it immediately, run this in the Supabase SQL Editor, then run `supabase db push` again:

```sql
create extension if not exists "uuid-ossp" with schema extensions;

create or replace function public.uuid_generate_v4()
returns uuid
language sql
stable
as $$
  select extensions.uuid_generate_v4();
$$;
```

## Useful Official Docs

- Vercel CLI overview: `https://vercel.com/docs/cli`
- Vercel project linking: `https://vercel.com/docs/cli/link`
- Vercel environment variables: `https://vercel.com/docs/cli/env`
- Vercel deploy command: `https://vercel.com/docs/cli/deploy`
- Supabase CLI reference: `https://supabase.com/docs/reference/cli/supabase-bootstrap`
- Supabase linking / deploy flow: `https://supabase.com/docs/guides/functions/deploy`


### Google sign-in and the primary Slack identity

Google is an alternate sign-in method. Player ownership remains keyed by the configured Slack workspace and Slack user ID in `slack_player_links`; Google sign-in reuses the same player and does not create or reassign player links.

Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_SLACK_TEAM_ID`, and `AUTH_SLACK_ALLOWED_EMAIL_DOMAINS`. The production `SLACK_BOT_TOKEN` must belong to that workspace and include `users:read.email` for `users.lookupByEmail`. `users:read` alone is insufficient. After adding the email scope to the Slack app, reinstall/reauthorize it in the workspace and update the deployed bot token if Slack issues a new one. See [Slack lookup documentation](https://docs.slack.dev/reference/methods/users.lookupByEmail/).

The verified Google email must exactly match the active full Slack member's email, ignoring case and surrounding whitespace. Email aliases, names, guests, bots, deactivated users, and other workspaces are not automatically linked. If the emails differ, sign in with Slack or correct the workspace directory email through its administrator.

An unresolved Google session retries on its next request after one minute. Resolved Google identities revalidate after five minutes; a failed revalidation disables player editing until Slack confirms the identity again, without logging the user out of the app. Concurrent lookups share a bounded one-minute process cache and time out after four seconds. The profile error state offers Retry and direct Slack sign-in. Server warnings report a safe failure reason such as `missing_scope`, `not_configured`, or `rate_limited`, without emails or credentials. Existing Google sessions are checked automatically after deployment.
