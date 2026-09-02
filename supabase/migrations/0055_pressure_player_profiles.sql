-- Historical Pressure Engine profiles. These views intentionally aggregate
-- completed eligible X01 matches so live clients fetch a tiny stable profile
-- once instead of scanning throw history after every dart.

create or replace view public.player_pressure_profiles as
with eligible_turns as (
  select
    tu.id,
    tu.leg_id,
    tu.player_id,
    tu.turn_number,
    tu.total_scored,
    tu.busted,
    l.match_id,
    l.winner_player_id as leg_winner_player_id,
    m.finish,
    m.start_score::text::int as start_score,
    count(th.id)::int as darts_in_turn
  from public.turns tu
  join public.throws th on th.turn_id = tu.id
  join public.legs l on l.id = tu.leg_id
  join public.matches m on m.id = l.match_id
  join public.players p on p.id = tu.player_id
  where m.ended_early = false
    and m.winner_player_id is not null
    and p.is_test = false
    and p.is_active = true
    and tu.tiebreak_round is null
  group by
    tu.id,
    tu.leg_id,
    tu.player_id,
    tu.turn_number,
    tu.total_scored,
    tu.busted,
    l.match_id,
    l.winner_player_id,
    m.finish,
    m.start_score
), visit_states as (
  select
    et.*,
    et.start_score - coalesce(
      sum(case when et.busted then 0 else et.total_scored end) over (
        partition by et.leg_id, et.player_id
        order by et.turn_number
        rows between unbounded preceding and 1 preceding
      ),
      0
    )::int as score_before
  from eligible_turns et
)
select
  vs.player_id,
  vs.finish as finish_rule,
  count(distinct vs.match_id)::bigint as matches_played,
  count(*)::bigint as visits,
  sum(vs.darts_in_turn)::bigint as darts_thrown,
  sum(case when vs.busted then 0 else vs.total_scored end)::bigint as scoring_points,
  round(
    3 * sum(case when vs.busted then 0 else vs.total_scored end)::numeric
      / nullif(sum(vs.darts_in_turn), 0),
    2
  ) as three_dart_average,
  count(*) filter (where vs.busted)::bigint as busts,
  round(
    count(*) filter (where vs.busted)::numeric / nullif(count(*), 0),
    4
  ) as bust_rate,
  count(*) filter (
    where
      (vs.finish = 'single_out' and vs.score_before between 1 and 180)
      or (
        vs.finish = 'double_out'
        and vs.score_before between 2 and 170
        and vs.score_before not in (159, 162, 163, 165, 166, 168, 169)
      )
  )::bigint as checkout_opportunities,
  count(*) filter (
    where vs.leg_winner_player_id = vs.player_id
      and vs.busted = false
      and vs.score_before - vs.total_scored = 0
  )::bigint as checkouts,
  round(
    count(*) filter (
      where vs.leg_winner_player_id = vs.player_id
        and vs.busted = false
        and vs.score_before - vs.total_scored = 0
    )::numeric
      / nullif(
          count(*) filter (
            where
              (vs.finish = 'single_out' and vs.score_before between 1 and 180)
              or (
                vs.finish = 'double_out'
                and vs.score_before between 2 and 170
                and vs.score_before not in (159, 162, 163, 165, 166, 168, 169)
              )
          ),
          0
        ),
    4
  ) as checkout_rate
from visit_states vs
group by vs.player_id, vs.finish;

alter view public.player_pressure_profiles set (security_invoker = true);

create or replace view public.pressure_population_profiles as
select
  ppp.finish_rule,
  sum(ppp.matches_played)::bigint as player_match_samples,
  sum(ppp.visits)::bigint as visits,
  sum(ppp.darts_thrown)::bigint as darts_thrown,
  sum(ppp.scoring_points)::bigint as scoring_points,
  round(
    3 * sum(ppp.scoring_points)::numeric / nullif(sum(ppp.darts_thrown), 0),
    2
  ) as three_dart_average,
  sum(ppp.busts)::bigint as busts,
  round(sum(ppp.busts)::numeric / nullif(sum(ppp.visits), 0), 4) as bust_rate,
  sum(ppp.checkout_opportunities)::bigint as checkout_opportunities,
  sum(ppp.checkouts)::bigint as checkouts,
  round(
    sum(ppp.checkouts)::numeric / nullif(sum(ppp.checkout_opportunities), 0),
    4
  ) as checkout_rate
from public.player_pressure_profiles ppp
group by ppp.finish_rule;

alter view public.pressure_population_profiles set (security_invoker = true);

grant select on public.player_pressure_profiles to anon, authenticated, service_role;
grant select on public.pressure_population_profiles to anon, authenticated, service_role;
