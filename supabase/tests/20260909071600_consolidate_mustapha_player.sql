begin;
do $$
begin
 if not exists (select 1 from pg_catalog.pg_constraint
   where conrelid = 'public.players'::regclass and conname = 'players_display_name_key'
     and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (display_name)')
 then raise exception 'Run this regression with the real unique player-name constraint'; end if;
end;
$$;
insert into public.players (id, display_name, nicknames) values
 ('235e5b43-716e-45f3-afef-7127083a78f4', 'mufasa', array['Lion']),
 ('832d8ba4-013c-4241-a243-81c97e958f73', 'Mustapha', array['lion', 'Mo']);
insert into public.slack_player_links (team_id, slack_user_id, player_id)
 values ('mustapha-test', 'U080V6ULA', '832d8ba4-013c-4241-a243-81c97e958f73');
create table public.preserved_history (player_id uuid references public.players, score integer);
insert into preserved_history values ('235e5b43-716e-45f3-afef-7127083a78f4', 180);
savepoint before_consolidation;
\ir ../migrations/20260909071600_consolidate_mustapha_player.sql
do $$
begin
 if not exists (select 1 from public.players where id = '235e5b43-716e-45f3-afef-7127083a78f4'
   and display_name = 'Mustapha' and nicknames = array['Lion', 'Mo', 'mufasa'] and is_active)
 then raise exception 'Original player not retained correctly'; end if;
 if not exists (select 1 from public.players where id = '832d8ba4-013c-4241-a243-81c97e958f73'
   and display_name = 'Mustapha (imported duplicate)' and nicknames = array['lion', 'Mo'] and not is_active)
 then raise exception 'Duplicate was not retained with a distinct name and its existing nicknames'; end if;
 if not exists (select 1 from public.slack_player_links where team_id = 'mustapha-test'
   and slack_user_id = 'U080V6ULA' and player_id = '235e5b43-716e-45f3-afef-7127083a78f4')
 then raise exception 'Slack identity not transferred'; end if;
 if not exists (select 1 from preserved_history where player_id = '235e5b43-716e-45f3-afef-7127083a78f4' and score = 180)
 then raise exception 'History changed'; end if;
end;
$$;

-- A direct retry must reject the changed identities without changing the result.
savepoint before_retry;
\set ON_ERROR_STOP off
\ir ../migrations/20260909071600_consolidate_mustapha_player.sql
\set retry_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
rollback to before_retry;
select :'retry_sqlstate' = 'P0001' as retry_rejected \gset
\if :retry_rejected
\else
 do $$ begin raise exception 'Retry did not reject the changed player records'; end $$;
\endif

rollback to before_consolidation;
insert into preserved_history values ('832d8ba4-013c-4241-a243-81c97e958f73', 60);
savepoint before_history_rejection;
\set ON_ERROR_STOP off
\ir ../migrations/20260909071600_consolidate_mustapha_player.sql
\set history_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
rollback to before_history_rejection;
select :'history_sqlstate' = 'P0001' as history_rejected \gset
\if :history_rejected
\else
 do $$ begin raise exception 'Consolidation did not reject imported-player history'; end $$;
\endif
do $$
begin
 if not exists (select 1 from public.slack_player_links where team_id = 'mustapha-test'
   and slack_user_id = 'U080V6ULA' and player_id = '832d8ba4-013c-4241-a243-81c97e958f73')
 then raise exception 'Rejected consolidation changed the Slack identity'; end if;
 if not exists (select 1 from public.players where id = '235e5b43-716e-45f3-afef-7127083a78f4'
   and display_name = 'mufasa' and nicknames = array['Lion'] and is_active)
   or not exists (select 1 from public.players where id = '832d8ba4-013c-4241-a243-81c97e958f73'
   and display_name = 'Mustapha' and nicknames = array['lion', 'Mo'] and is_active)
 then raise exception 'Rejected consolidation changed a player'; end if;
 if (select count(*) from preserved_history) <> 2
 then raise exception 'Rejected consolidation changed history'; end if;
end;
$$;
rollback;
