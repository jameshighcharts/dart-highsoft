-- Default profile pictures: 80 goblin icons in public/avatars/default
-- (goblin-01..goblin-80). Instead of hashing the player id in the client
-- (which can hand two players the same goblin), store the assigned default in
-- players.avatar_url as an app-relative path. A trigger hands every new
-- player, and every player whose picture is removed, a random goblin that no
-- other player currently has; with more than 80 unpictured players it falls
-- back to any random goblin. The one-off update below reshuffles everyone
-- without an uploaded picture into a fresh random, collision-free assignment.

create or replace function public.assign_default_avatar() returns trigger
language plpgsql security definer set search_path='' as $$
declare picked text;
begin
  if new.avatar_url is not null and new.avatar_url <> '' then
    return new;
  end if;
  select k into picked
  from (
    select '/avatars/default/goblin-' || lpad(g::text, 2, '0') || '.png' as k
    from generate_series(1, 80) g
  ) keys
  where not exists (
    select 1 from public.players p where p.avatar_url = keys.k and p.id <> new.id
  )
  order by random()
  limit 1;
  if picked is null then
    picked := '/avatars/default/goblin-' || lpad((1 + floor(random() * 80))::int::text, 2, '0') || '.png';
  end if;
  new.avatar_url := picked;
  return new;
end;
$$;
revoke all on function public.assign_default_avatar() from public, anon, authenticated;

drop trigger if exists trg_assign_default_avatar on public.players;
create trigger trg_assign_default_avatar
before insert or update of avatar_url on public.players
for each row execute function public.assign_default_avatar();

-- Reshuffle: every player without an uploaded picture gets a new random,
-- unique goblin from the pool of 80.
with pool as (
  select '/avatars/default/goblin-' || lpad(g::text, 2, '0') || '.png' as k,
         row_number() over (order by random()) as rn
  from generate_series(1, 80) g
),
targets as (
  select id, row_number() over (order by random()) as rn
  from public.players
  where avatar_url is null or avatar_url = '' or avatar_url like '/avatars/default/%'
)
update public.players p
set avatar_url = coalesce(pool.k, '/avatars/default/goblin-' || lpad((1 + floor(random() * 80))::int::text, 2, '0') || '.png')
from targets
left join pool on pool.rn = targets.rn
where p.id = targets.id;
