import type { DartIQHistoricalFact, DartIQPlayerHistoryProfile, DartIQPopulationProfile } from './evidence';
import { createAdaptiveDartIQModel, type DartIQModelDeployment } from './model/training';
import type { DartIQOutcomeObservation } from './model/outcomes';
import type { DartIQReplayInput } from './replay';
import { DartIQTracker, type DartIQTrackerSnapshot } from './tracker';
import { summarizeDartIQForTurn } from './insights';
import { buildCommentaryNarrativeMemory } from '@/lib/commentary/commentaryNarrative';

export type DartIQLiveEvidence = {
  modelDeployment?: DartIQModelDeployment;
  playerProfiles: DartIQPlayerHistoryProfile[];
  populationProfile?: DartIQPopulationProfile;
  playerOutcomes: Array<DartIQOutcomeObservation & { playerId: string }>;
  populationOutcomes: DartIQOutcomeObservation[];
  historicalFacts?: DartIQHistoricalFact[];
};
export type DartIQLiveInput = Omit<DartIQReplayInput, 'playerProfiles' | 'populationProfile' | 'outcomeModels'>;
export type DartIQLiveRequest = {
  id: number;
  input: DartIQLiveInput;
  evidence?: DartIQLiveEvidence;
  commentary?: { turnId: string; playerId: string };
};
export type DartIQLiveResponse = {
  id: number;
  snapshot: DartIQTrackerSnapshot | null;
  commentary?: {
    dartiq: ReturnType<typeof summarizeDartIQForTurn>;
    narrative: ReturnType<typeof buildCommentaryNarrativeMemory>;
  };
};

/** Owned by one browser worker. Retain models and evidence identities across darts. */
export class DartIQLiveProcessor {
  private tracker = new DartIQTracker();
  private profiles: DartIQReplayInput['playerProfiles'];
  private population: DartIQReplayInput['populationProfile'];
  private models: NonNullable<DartIQReplayInput['outcomeModels']> = {};
  private evidence?: DartIQLiveEvidence;
  private playerKey = '';

  commentary(input: DartIQLiveInput, turnId: string, playerId: string) {
    const events = this.tracker.events();
    return {
      dartiq: summarizeDartIQForTurn(events, turnId, playerId),
      narrative: buildCommentaryNarrativeMemory({ events, finishRule: input.finishRule }),
    };
  }

  update({ input, evidence }: DartIQLiveRequest): DartIQTrackerSnapshot {
    const playerKey = JSON.stringify(input.playerIds);
    evidence ??= playerKey !== this.playerKey ? this.evidence : undefined;
    if (!evidence && !this.evidence) throw new Error('DartIQ worker requires initial evidence');
    if (evidence) {
      this.profiles = Object.fromEntries(evidence.playerProfiles.map((profile) => [profile.playerId, profile]));
      this.population = evidence.populationProfile;
      const personal = new Map<string, DartIQOutcomeObservation[]>();
      for (const row of evidence.playerOutcomes) {
        const rows = personal.get(row.playerId) ?? [];
        rows.push(row);
        personal.set(row.playerId, rows);
      }
      this.models = Object.fromEntries(input.playerIds.map((playerId) => [playerId, createAdaptiveDartIQModel({
        playerId, personal: personal.get(playerId), population: evidence.populationOutcomes,
        deployment: evidence.modelDeployment,
      })]));
      this.tracker = new DartIQTracker();
      this.evidence = evidence;
      this.playerKey = playerKey;
    }
    return this.tracker.update({ ...input, playerProfiles: this.profiles, populationProfile: this.population, outcomeModels: this.models });
  }
}
