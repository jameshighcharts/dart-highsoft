import { postSlackMessage } from '@/lib/slack/client';

type HealthProblem = 'worker_stale' | 'connection_down';

export type ScoliaHealthIncident = {
  boardId: string;
  name: string;
  problem: HealthProblem;
  since: string | null;
  connectionStatus?: string | null;
  boardStatus?: string | null;
};

export type ScoliaHealthRecovery = {
  boardId: string;
  name: string;
  problem: HealthProblem | null;
  since: string | null;
  recoveredAt: string;
};

export type ScoliaHealthAlertPayload = {
  incidents: ScoliaHealthIncident[];
  recoveries: ScoliaHealthRecovery[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const optionalString = (value: unknown) => (typeof value === 'string' ? value : null);
const problemOf = (value: unknown): HealthProblem | null =>
  value === 'worker_stale' || value === 'connection_down' ? value : null;

/** Parse the payload written by public.check_scolia_board_health(); null when it is malformed. */
export function parseScoliaHealthAlertPayload(payload: Record<string, unknown>): ScoliaHealthAlertPayload | null {
  const { incidents, recoveries } = payload;
  if (!Array.isArray(incidents) || !Array.isArray(recoveries)) return null;
  const parsedIncidents: ScoliaHealthIncident[] = [];
  for (const item of incidents) {
    const problem = isRecord(item) ? problemOf(item.problem) : null;
    if (!isRecord(item) || typeof item.boardId !== 'string' || typeof item.name !== 'string' || !problem) return null;
    parsedIncidents.push({
      boardId: item.boardId,
      name: item.name,
      problem,
      since: optionalString(item.since),
      connectionStatus: optionalString(item.connectionStatus),
      boardStatus: optionalString(item.boardStatus),
    });
  }
  const parsedRecoveries: ScoliaHealthRecovery[] = [];
  for (const item of recoveries) {
    if (!isRecord(item) || typeof item.boardId !== 'string' || typeof item.name !== 'string'
      || typeof item.recoveredAt !== 'string') return null;
    parsedRecoveries.push({
      boardId: item.boardId,
      name: item.name,
      problem: problemOf(item.problem),
      since: optionalString(item.since),
      recoveredAt: item.recoveredAt,
    });
  }
  return { incidents: parsedIncidents, recoveries: parsedRecoveries };
}

/** Slack renders this in each reader's own time zone. */
function slackTime(iso: string | null): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return 'an unknown time';
  return `<!date^${Math.floor(ms / 1000)}^{date_short_pretty} {time}|${new Date(ms).toISOString()}>`;
}

function describeIncident(incident: ScoliaHealthIncident): string {
  if (incident.problem === 'worker_stale') {
    return `*${incident.name}*: the Scolia worker has not reported since ${slackTime(incident.since)}. `
      + 'The worker is probably down; no darts are being scored.';
  }
  const status = incident.connectionStatus ?? 'unknown';
  const board = incident.boardStatus ? `, board ${incident.boardStatus}` : '';
  return `*${incident.name}*: no Scolia cloud connection since ${slackTime(incident.since)} (worker: ${status}${board}). `
    + 'Darts on this board are not being scored.';
}

function describeRecovery(recovery: ScoliaHealthRecovery): string {
  const what = recovery.problem === 'worker_stale' ? 'worker is reporting again' : 'Scolia connection is back';
  return `*${recovery.name}*: ${what} (down since ${slackTime(recovery.since)}).`;
}

export function buildScoliaHealthMessage(payload: ScoliaHealthAlertPayload): { text: string; blocks: object[] } | null {
  const lines = [
    ...payload.incidents.map((incident) => `:rotating_light: ${describeIncident(incident)}`),
    ...payload.recoveries.map((recovery) => `:white_check_mark: ${describeRecovery(recovery)}`),
  ];
  if (lines.length === 0) return null;
  const down = payload.incidents.length;
  const text = down > 0
    ? `Scolia: ${down} board${down === 1 ? '' : 's'} not scoring`
    : `Scolia: ${payload.recoveries.length} board${payload.recoveries.length === 1 ? '' : 's'} recovered`;
  return {
    text,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }],
  };
}

export async function publishScoliaHealthAlert(
  payload: ScoliaHealthAlertPayload,
  post: typeof postSlackMessage = postSlackMessage,
): Promise<void> {
  const message = buildScoliaHealthMessage(payload);
  if (!message) return;
  const channel = process.env.SCOLIA_ALERT_SLACK_CHANNEL?.trim();
  if (!channel || !process.env.SLACK_BOT_TOKEN) {
    // Alerts are optional; a missing configuration must not become a retry loop.
    console.info(`Scolia health alert skipped (Slack channel or bot token not configured): ${message.text}`);
    return;
  }
  await post(channel, message);
}
