begin;
insert into public.players (id, display_name, nicknames) values
 ('235e5b43-716e-45f3-afef-7127083a78f4', 'mufasa', array['Lion']),
 ('832d8ba4-013c-4241-a243-81c97e958f73', 'Mustapha', array['lion', 'Mo']);
insert into public.slack_player_links (team_id, slack_user_id, player_id)
 values ('mustapha-test', 'U080V6ULA', '832d8ba4-013c-4241-a243-81c97e958f73');
create table public.preserved_history (player_id uuid references public.players, score integer);
insert into preserved_history values ('235e5b43-716e-45f3-afef-7127083a78f4', 180);
\ir ../migrations/20260909071600_consolidate_mustapha_player.sql
do $$
begin
 if not exists (select 1 from public.players where id = '235e5b43-716e-45f3-afef-7127083a78f4'
   and display_name = 'Mustapha' and nicknames = array['Lion', 'Mo', 'mufasa'] and is_active)
 then raise exception 'Original player not retained correctly'; end if;
 if not exists (select 1 from public.players where id = '832d8ba4-013c-4241-a243-81c97e958f73' and not is_active)
 then raise exception 'Duplicate still active'; end if;
 if not exists (select 1 from public.slack_player_links where team_id = 'mustapha-test'
   and slack_user_id = 'U080V6ULA' and player_id = '235e5b43-716e-45f3-afef-7127083a78f4')
 then raise exception 'Slack identity not transferred'; end if;
 if not exists (select 1 from preserved_history where player_id = '235e5b43-716e-45f3-afef-7127083a78f4' and score = 180)
 then raise exception 'History changed'; end if;
end;
$$;
rollback;
