import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildScoliaHealthMessage,
  parseScoliaHealthAlertPayload,
  publishScoliaHealthAlert,
} from './scoliaHealthAlert';

const since = '2026-10-12T10:00:00.000Z';
const incident = {
  boardId: 'b1', name: 'Bergen', problem: 'connection_down', since,
  connectionStatus: 'reconnecting', boardStatus: 'Ready', heartbeatAt: since,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseScoliaHealthAlertPayload', () => {
  it('accepts the payload written by check_scolia_board_health', () => {
    const parsed = parseScoliaHealthAlertPayload({
      incidents: [incident],
      recoveries: [{ boardId: 'b2', name: 'Vik', problem: 'worker_stale', since, recoveredAt: since }],
      checkedAt: since,
    });
    expect(parsed?.incidents[0]).toMatchObject({ name: 'Bergen', problem: 'connection_down', connectionStatus: 'reconnecting' });
    expect(parsed?.recoveries[0]).toMatchObject({ name: 'Vik', problem: 'worker_stale' });
  });

  it('rejects malformed payloads', () => {
    expect(parseScoliaHealthAlertPayload({ incidents: 'nope', recoveries: [] })).toBeNull();
    expect(parseScoliaHealthAlertPayload({ incidents: [{ ...incident, problem: 'bogus' }], recoveries: [] })).toBeNull();
    expect(parseScoliaHealthAlertPayload({ incidents: [], recoveries: [{ boardId: 'b', name: 'x' }] })).toBeNull();
  });
});

describe('buildScoliaHealthMessage', () => {
  it('names the board, the problem and when it started', () => {
    const message = buildScoliaHealthMessage(parseScoliaHealthAlertPayload({ incidents: [incident], recoveries: [] })!);
    expect(message?.text).toBe('Scolia: 1 board not scoring');
    const body = JSON.stringify(message?.blocks);
    expect(body).toContain(`*Bergen*: no Scolia cloud connection since <!date^${Date.parse(since) / 1000}^`);
    expect(body).toContain('worker: reconnecting, board Ready');
  });

  it('distinguishes a dead worker from a lost Scolia connection', () => {
    const message = buildScoliaHealthMessage({
      incidents: [{ boardId: 'b1', name: 'Bergen', problem: 'worker_stale', since }],
      recoveries: [],
    });
    expect(JSON.stringify(message?.blocks)).toContain('worker has not reported since');
  });

  it('reports recoveries and returns nothing for an empty payload', () => {
    const message = buildScoliaHealthMessage({
      incidents: [],
      recoveries: [{ boardId: 'b1', name: 'Bergen', problem: 'connection_down', since, recoveredAt: since }],
    });
    expect(message?.text).toBe('Scolia: 1 board recovered');
    expect(JSON.stringify(message?.blocks)).toContain('Scolia connection is back');
    expect(buildScoliaHealthMessage({ incidents: [], recoveries: [] })).toBeNull();
  });
});

describe('publishScoliaHealthAlert', () => {
  const payload = { incidents: [{ boardId: 'b1', name: 'Bergen', problem: 'worker_stale' as const, since }], recoveries: [] };

  it('posts to the configured channel', async () => {
    vi.stubEnv('SCOLIA_ALERT_SLACK_CHANNEL', 'C123');
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    const post = vi.fn(async () => 'ts');
    await publishScoliaHealthAlert(payload, post);
    expect(post).toHaveBeenCalledWith('C123', expect.objectContaining({ text: 'Scolia: 1 board not scoring' }));
  });

  it('completes as a no-op when alerts are not configured', async () => {
    vi.stubEnv('SCOLIA_ALERT_SLACK_CHANNEL', '');
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const post = vi.fn(async () => 'ts');
    await expect(publishScoliaHealthAlert(payload, post)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});
