import type { FinishRule } from '@/utils/x01';

export type Player = { id: string; display_name: string };

export type MatchRecord = {
  id: string;
  mode: 'x01';
  start_score: '201' | '301' | '501';
  finish: FinishRule;
  legs_to_win: number;
  winner_player_id?: string | null;
  ended_early?: boolean;
  fair_ending?: boolean;
  tournament_match_id?: string | null;
  scolia_board_id?: string | null;
  rematch_of_match_id?: string | null;
};

export type LegRecord = {
  id: string;
  match_id: string;
  leg_number: number;
  starting_player_id: string;
  winner_player_id: string | null;
};

export type TurnRecord = {
  id: string;
  leg_id: string;
  player_id: string;
  turn_number: number;
  total_scored: number;
  busted: boolean;
  tiebreak_round: number | null;
};

export type MatchPlayersRow = {
  match_id: string;
  player_id: string;
  play_order: number;
  players: Player;
};

export type ThrowRecord = {
  id: string;
  turn_id: string;
  dart_index: number;
  segment: string;
  scored: number;
  scolia_event_id?: number | null;
  impact_x_mm?: number | null;
  impact_y_mm?: number | null;
  angle_horizontal_deg?: number | null;
  angle_vertical_deg?: number | null;
};

export type TurnWithThrows = TurnRecord & {
  throws: ThrowRecord[];
};
