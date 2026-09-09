begin;
insert into public.players (id, display_name, nicknames, is_active, is_test) values
 ('00000000-0000-4000-8000-000000000091', 'Old name', array['Existing'], false, false),
 ('00000000-0000-4000-8000-000000000092', 'Other team', '{}', true, false),
 ('00000000-0000-4000-8000-000000000093', 'Test player', '{}', true, true);
insert into public.slack_player_links (team_id, slack_user_id, player_id) values
 ('sync-test', 'U1', '00000000-0000-4000-8000-000000000091'),
 ('sync-other', 'U1', '00000000-0000-4000-8000-000000000092'),
 ('sync-test', 'U3', '00000000-0000-4000-8000-000000000093');
do $$
declare v_names jsonb := '[{"slack_user_id":"U1","display_name":"New name"},{"slack_user_id":"U3","display_name":"Changed test"}]';
begin
 if public.sync_slack_player_names('sync-test', v_names) <> 1 then raise exception 'Wrong rename count'; end if;
 if not exists (select 1 from public.players where id = '00000000-0000-4000-8000-000000000091'
   and display_name = 'New name' and nicknames = array['Existing', 'Old name'] and not is_active)
 then raise exception 'Name, nicknames, or inactive status lost'; end if;
 if public.sync_slack_player_names('sync-test', v_names) <> 0 then raise exception 'Retry was not idempotent'; end if;
 if exists (select 1 from public.players where id = '00000000-0000-4000-8000-000000000092' and display_name <> 'Other team')
 then raise exception 'Cross-team rename'; end if;
 if exists (select 1 from public.players where id = '00000000-0000-4000-8000-000000000093' and display_name <> 'Test player')
 then raise exception 'Test player renamed'; end if;
 if has_function_privilege('authenticated', 'public.sync_slack_player_names(text,jsonb)', 'EXECUTE')
   or has_function_privilege('anon', 'public.sync_slack_player_names(text,jsonb)', 'EXECUTE')
 then raise exception 'RPC exposed to non-service role'; end if;
end;
$$;
rollback;
