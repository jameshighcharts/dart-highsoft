# Slack dart polls

The Slack integration lets someone run `/dart 14:00` in a channel. It posts a
Yes/No poll, closes voting at that time, and creates a one-leg 501 double-out
match when at least two people voted Yes. The completed poll links directly to
the scoring page. A time that has already passed means the following day.

## Slack app setup

1. Create a Slack app for the workspace.
2. Add the bot scopes `chat:write` and `users:read`, then install the app.
3. Create the `/dart` slash command with this request URL:
   `https://YOUR_APP/api/slack/darts`.
4. Enable Interactivity and use the same request URL.
5. Invite the bot to each channel where polls should be available.

Add these server-only variables to Vercel:

```env
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=xoxb-...
BACKGROUND_JOB_SECRET=
NEXT_PUBLIC_APP_URL=https://YOUR_APP
SLACK_DART_TIME_ZONE=Europe/Oslo
```

`SLACK_DART_TIME_ZONE` and `NEXT_PUBLIC_APP_URL` are optional. The time zone
defaults to `Europe/Oslo`; the app URL defaults to the job request origin.
Generate `BACKGROUND_JOB_SECRET` as a random value of at least 32 characters.

## Sign in with Slack: global gate and admin panel

The whole app is behind Sign in with Slack. `/login` gates the game (any
verified member of the Highsoft workspace), `/signin` gates `/admin` (members
on `AUTH_SLACK_ADMIN_EMAILS`. An empty list grants no admin access. Both pages
share one light card with a single "Login with Slack" button. Server-to-server
endpoints stay public and authenticate on their own: `/api/slack/*` (request
signatures), `/api/background-jobs` (bearer secret) and `/api/auth/*`.

### My profile (`/profile`)

Every signed-in member has a self-service profile. On first visit they link
their Slack account to a player ("This is me" from the unclaimed players, or
"Create my player"); afterwards they can upload or remove their picture, edit
nicknames (comma-separated) and location, and see their stats (matches, wins,
win rate, average, legs won, last-10 form, 1v1 and multiplayer Elo). Names are
changed by admins only. Backed by `/api/me`, `/api/me/link`, `/api/me/avatar`.

### Profile pictures and nicknames

Migration `0059_player_avatars_and_nicknames.sql` adds `players.avatar_url`,
`players.nicknames text[]` and a public-read `avatars` storage bucket. Admins
upload PNG/JPEG/WebP pictures (max 2 MB) per player in `/admin`; the server
sniffs the real image type and stores `players/<id>.<ext>`. Nicknames are
entered comma-separated. The `PlayerAvatar` component renders the picture (or
initials) as a circle at fixed sizes wherever players appear.


`/admin` is a light, minimal user-management page (players, pictures,
nicknames, locations, active flag, and Slack identity links). Auth uses the
same env contract as the Compass app, so the Compass Slack OAuth values can be
reused as-is:

```env
AUTH_SECRET=                      # openssl rand -base64 32
AUTH_SLACK_ID=                    # Slack app client id
AUTH_SLACK_SECRET=                # Slack app client secret
AUTH_SLACK_TEAM_ID=               # Highsoft workspace id (T…)
AUTH_SLACK_ALLOWED_EMAIL_DOMAINS=highsoft.com
AUTH_SLACK_ADMIN_EMAILS=          # comma-separated admin emails; empty = no admins
AUTH_TRUST_HOST=true              # only needed outside Vercel
```

On the Slack app, enable **Sign in with Slack** (OpenID Connect) and register
`https://YOUR_APP/api/auth/callback/slack` as a redirect URL. Slack requires
HTTPS, so local development needs a tunnel or the production deployment.
For a local preview without Slack, set `AUTH_DEV_BYPASS=1` in `.env.local`
and run `npm run dev`; it only works under `next dev` and signs you in as a
fake "Local dev" admin. Production builds ignore it. The Playwright server
(`npm run dev:test`) sets it so E2E tests run without Slack.

Sign-in is refused unless the Slack profile belongs to `AUTH_SLACK_TEAM_ID`
and carries a verified email on an allowed domain. `/signin` shows a single
"Login with Slack" button.

### Magic Slack linking

The admin panel reads and writes `slack_player_links`, the same table the
poll scheduler uses to turn Yes-votes into match players. Linking a player to
a Slack user in `/admin` therefore fixes how that person is resolved by
`/dart`. The signed-in admin can also link themselves with one click.

**Import Slack members** (button in `/admin`, or `npm run slack:sync-players`)
lists every full, active, human member of the workspace via `users.list`
(needs `SLACK_BOT_TOKEN` with `users:read`) and:

- creates one player per member named by first name; members who share a
  first name get `First L` (first name + last-name initial), falling back to
  the full name if that still collides;
- links a member to an existing unlinked player with exactly that name
  instead of creating a duplicate;
- skips members that already have a link. The import is idempotent.

Run `npm run slack:sync-players -- --dry` to print the plan without writing.

## Deployment

1. Apply migrations `0057_slack_dart_polls.sql` and
   `0058_background_jobs.sql`. Until the Vault values below exist, the
   scheduler returns without claiming jobs.
2. Add the Vercel variables and deploy the app so `/api/background-jobs` is
   available.
3. Store the deployed app URL and the exact same random dispatch secret in
   Supabase Vault:

```sql
select vault.create_secret(
  'https://YOUR_APP',
  'background_jobs_app_url'
);

select vault.create_secret(
  'THE_SAME_VALUE_AS_BACKGROUND_JOB_SECRET',
  'background_jobs_secret'
);
```

The migration installs one Supabase Cron job named
`dispatch-background-jobs`. It runs `dispatch_due_background_jobs()` every
five seconds. That function performs only a database query when the queue is
empty. If work is due, it claims up to ten rows using `FOR UPDATE SKIP LOCKED`
and sends their IDs to the app in one asynchronous `pg_net` request.

This does not use Vercel Cron, so arbitrary match times do not require Vercel
Pro or Enterprise. Supabase requires Postgres 15.1.1.61 or newer for
second-level Cron intervals.

## Reusing the job queue

Server-side code can schedule other work by inserting another typed job:

```sql
insert into public.background_jobs (
  job_type,
  payload,
  run_at,
  deduplication_key
)
values (
  'example_job',
  '{"recordId":"..."}'::jsonb,
  '2026-09-03 14:00:00+02',
  'example_job:...'
);
```

Add the corresponding payload validation and handler case in
`src/lib/server/backgroundJobs.ts`. Unknown job types are marked failed rather
than retried forever. Failed transient handlers are returned to the queue after
15 seconds; missing HTTP responses are reclaimed after five minutes, up to five
attempts.

Useful checks after deployment:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'dispatch-background-jobs';

select id, job_type, run_at, status, attempts, last_error
from public.background_jobs
order by created_at desc;
```

The Slack endpoint verifies every slash-command and button request using the
Slack signing secret. Poll, vote, identity-link, and job tables are
service-role-only. Supabase sends `Bearer BACKGROUND_JOB_SECRET` to the job
endpoint, and database claims are safe against overlapping Cron runs.
