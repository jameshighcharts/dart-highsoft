-- Keep bull-off accuracy separate from X01 statistics. Null distances are
-- unmeasured misses: report them, but never manufacture a distance for AVG.
create view public.bull_off_leaderboard with (security_invoker = true) as
select
  b.player_id,
  p.display_name,
  count(b.distance_mm)::integer as measured_darts,
  count(*) filter (where b.distance_mm is null)::integer as misses,
  count(distinct b.match_id)::integer as bull_offs,
  avg(b.distance_mm) / 25.4 as average_inches
from public.bull_off_throws b
join public.players p on p.id = b.player_id
join public.matches m on m.id = b.match_id
where m.bull_off->>'phase' = 'complete'
  and not coalesce(p.is_test, false)
group by b.player_id, p.display_name
having count(b.distance_mm) > 0;

grant select on public.bull_off_leaderboard to anon, authenticated, service_role;
