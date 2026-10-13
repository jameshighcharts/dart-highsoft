-- The match page's Realtime channel (dart_match_<id>: who is watching, and the "rematch created"
-- message that moves spectators along) becomes private. A public channel is open to anyone with
-- the anon key, which every page's JavaScript holds, so a stranger could watch presence or send a
-- fake rematch. Private channels are checked against these realtime.messages policies.

create policy "members receive on match channels"
on realtime.messages
for select
to authenticated
using (
  starts_with(realtime.topic(), 'dart_match_')
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "members send on match channels"
on realtime.messages
for insert
to authenticated
with check (
  starts_with(realtime.topic(), 'dart_match_')
  and realtime.messages.extension in ('broadcast', 'presence')
);
