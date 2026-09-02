import { describe, expect, it } from 'vitest';

import {
  boardStatePatchForMessage,
  detectedThrowFromMessage,
  occurredAtForMessage,
  parseScoliaMessage,
  reconnectDelayMs,
} from '@/lib/scolia/protocol';

describe('Scolia protocol helpers', () => {
  it('parses valid messages and rejects malformed input', () => {
    expect(parseScoliaMessage('{"type":"THROW_DETECTED","id":"event-1","payload":{"sector":"T20"}}')).toEqual({
      type: 'THROW_DETECTED',
      id: 'event-1',
      payload: { sector: 'T20' },
    });
    expect(parseScoliaMessage('nope')).toBeNull();
    expect(parseScoliaMessage('{"type":"THROW_DETECTED"}')).toBeNull();
  });

  it('maps status and phase events into board-state patches', () => {
    expect(
      boardStatePatchForMessage({
        type: 'HELLO_CLIENT',
        id: 'event-1',
        payload: { boardStatus: 'Ready', boardPhase: 'Throw', errorType: null },
      })
    ).toEqual({ board_status: 'Ready', board_phase: 'Throw', error_type: null });
    expect(boardStatePatchForMessage({ type: 'TAKEOUT_STARTED', id: 'event-2' })).toEqual({
      board_phase: 'Takeout',
    });
    expect(boardStatePatchForMessage({ type: 'TAKEOUT_FINISHED', id: 'event-3' })).toEqual({
      board_phase: 'Throw',
    });
  });

  it('extracts valid event timestamps', () => {
    expect(
      occurredAtForMessage({
        type: 'THROW_DETECTED',
        id: 'event-1',
        payload: { detectionTime: '2026-09-01T10:00:00.000Z' },
      })
    ).toBe('2026-09-01T10:00:00.000Z');
    expect(occurredAtForMessage({ type: 'THROW_DETECTED', id: 'event-2', payload: { detectionTime: 'bad' } })).toBeNull();
  });

  it.each([
    ['S20', false, { segment: 'S20', scored: 20 }],
    ['s1', false, { segment: 'S1', scored: 1 }],
    ['D16', false, { segment: 'D16', scored: 32 }],
    ['T19', false, { segment: 'T19', scored: 57 }],
    ['25', false, { segment: 'SB', scored: 25 }],
    ['Bull', false, { segment: 'DB', scored: 50 }],
    ['None', false, { segment: 'Miss', scored: 0 }],
    ['T20', true, { segment: 'Miss', scored: 0 }],
  ])('maps Scolia sector %s (bounceout %s)', (sector, bounceout, expected) => {
    expect(detectedThrowFromMessage({
      type: 'THROW_DETECTED',
      id: 'event-1',
      payload: { sector, bounceout },
    })).toEqual(expected);
  });

  it('rejects malformed detected throws', () => {
    expect(detectedThrowFromMessage({ type: 'TAKEOUT_STARTED', id: 'event-1' })).toBeNull();
    expect(detectedThrowFromMessage({
      type: 'THROW_DETECTED',
      id: 'event-2',
      payload: { sector: 'T21', bounceout: false },
    })).toBeNull();
    expect(detectedThrowFromMessage({
      type: 'THROW_DETECTED',
      id: 'event-3',
      payload: { sector: 'T20' },
    })).toBeNull();
  });

  it('extracts valid impact geometry for live board rendering', () => {
    expect(detectedThrowFromMessage({
      type: 'THROW_DETECTED',
      id: 'event-geometry',
      payload: {
        sector: 'T20',
        bounceout: false,
        coordinates: [-4, 103],
        angle: { horizontal: -3.5, vertical: 20.25 },
      },
    })).toEqual({
      segment: 'T20',
      scored: 60,
      impactXmm: -4,
      impactYmm: 103,
      angleHorizontalDeg: -3.5,
      angleVerticalDeg: 20.25,
    });
  });

  it('backs off longer for duplicate and invalid credentials', () => {
    expect(reconnectDelayMs(4101, 0, () => 0)).toBe(30_000);
    expect(reconnectDelayMs(4102, 0, () => 0)).toBe(300_000);
    expect(reconnectDelayMs(1006, 0, () => 0)).toBe(1_000);
    expect(reconnectDelayMs(1006, 10, () => 0)).toBe(30_000);
  });
});
