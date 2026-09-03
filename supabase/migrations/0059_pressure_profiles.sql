-- Final historical Pressure Engine profile views for this unreleased feature.
-- Live match evidence is frozen at match creation; these views are the source
-- aggregates used to build that immutable snapshot.

-- Treat the final standard visit by the recorded leg winner as the
-- authoritative checkout. This supports fair-ending legs and older imported
-- matches whose aggregate turn score cannot be perfectly reconstructed.

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
    )::int as score_before,
    row_number() over (
      partition by et.leg_id, et.player_id
      order by et.turn_number desc
    ) as player_leg_reverse_turn
  from eligible_turns et
), classified_visits as (
  select
    vs.*,
    (
      vs.leg_winner_player_id = vs.player_id
      and vs.player_leg_reverse_turn = 1
      and vs.busted = false
    ) as is_checkout,
    (
      (vs.finish = 'single_out' and vs.score_before between 1 and 180)
      or (
        vs.finish = 'double_out'
        and vs.score_before between 2 and 170
        and vs.score_before not in (159, 162, 163, 165, 166, 168, 169)
      )
    ) as is_checkout_opportunity
  from visit_states vs
)
select
  cv.player_id,
  cv.finish as finish_rule,
  count(distinct cv.match_id)::bigint as matches_played,
  count(*)::bigint as visits,
  sum(cv.darts_in_turn)::bigint as darts_thrown,
  sum(case when cv.busted then 0 else cv.total_scored end)::bigint as scoring_points,
  round(
    3 * sum(case when cv.busted then 0 else cv.total_scored end)::numeric
      / nullif(sum(cv.darts_in_turn), 0),
    2
  ) as three_dart_average,
  count(*) filter (where cv.busted)::bigint as busts,
  round(
    count(*) filter (where cv.busted)::numeric / nullif(count(*), 0),
    4
  ) as bust_rate,
  count(*) filter (where cv.is_checkout_opportunity or cv.is_checkout)::bigint
    as checkout_opportunities,
  count(*) filter (where cv.is_checkout)::bigint as checkouts,
  round(
    count(*) filter (where cv.is_checkout)::numeric
      / nullif(count(*) filter (where cv.is_checkout_opportunity or cv.is_checkout), 0),
    4
  ) as checkout_rate
from classified_visits cv
group by cv.player_id, cv.finish;

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

-- Observable per-dart outcomes for the behavioral transition model. These are
-- aggregate counts, not inferred targets or raw historical throw rows.
create or replace view public.player_pressure_outcomes as
with eligible_turns as (
  select
    tu.id,
    tu.leg_id,
    tu.player_id,
    tu.turn_number,
    tu.total_scored,
    tu.busted,
    l.match_id,
    m.finish,
    m.start_score::text::int as start_score
  from public.turns tu
  join public.legs l on l.id = tu.leg_id
  join public.matches m on m.id = l.match_id
  join public.players p on p.id = tu.player_id
  where m.ended_early = false
    and m.winner_player_id is not null
    and p.is_test = false
    and p.is_active = true
    and tu.tiebreak_round is null
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
    )::int as score_before_visit
  from eligible_turns et
), dart_states as (
  select
    vs.player_id,
    vs.finish,
    greatest(
      0,
      vs.score_before_visit - coalesce(
        sum(th.scored) over (
          partition by th.turn_id
          order by th.dart_index
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::int
    ) as current_score,
    (4 - th.dart_index)::int as darts_left,
    th.scored::int as score_delta,
    (th.segment = 'DB' or th.segment ~ '^D[0-9]+$') as is_double
  from visit_states vs
  join public.throws th on th.turn_id = vs.id
)
select
  ds.player_id,
  ds.finish as finish_rule,
  ds.current_score,
  ds.darts_left,
  ds.score_delta,
  ds.is_double,
  count(*)::bigint as outcome_count
from dart_states ds
group by
  ds.player_id,
  ds.finish,
  ds.current_score,
  ds.darts_left,
  ds.score_delta,
  ds.is_double;

alter view public.player_pressure_outcomes set (security_invoker = true);

create or replace view public.pressure_population_outcomes as
select
  ppo.finish_rule,
  ppo.current_score,
  ppo.darts_left,
  ppo.score_delta,
  ppo.is_double,
  sum(ppo.outcome_count)::bigint as outcome_count
from public.player_pressure_outcomes ppo
group by
  ppo.finish_rule,
  ppo.current_score,
  ppo.darts_left,
  ppo.score_delta,
  ppo.is_double;

alter view public.pressure_population_outcomes set (security_invoker = true);

grant select on public.player_pressure_outcomes to anon, authenticated, service_role;
grant select on public.pressure_population_outcomes to anon, authenticated, service_role;
