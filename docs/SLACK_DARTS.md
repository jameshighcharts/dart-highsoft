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
