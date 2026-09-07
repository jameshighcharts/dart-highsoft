import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { runDartIQCalibration, runDartIQTraining } from './dartiqCalibration';

vi.mock('server-only', () => ({}));

function fixture(options: { existing?: boolean; rpcError?: string; insertError?: string; wrongModel?: boolean } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: options.insertError ? { code: options.insertError, message: 'save failed' } : null });
  const query = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: options.existing ? { id: 1 } : null, error: null }) };
  const from = vi.fn((table: string) => {
    if (table !== 'dartiq_calibration_reports') throw new Error(`Unexpected write target ${table}`);
    return { select: () => query, insert };
  });
  const rpc = vi.fn().mockResolvedValue({ data: { modelVersionId: options.wrongModel ? '2' : '1', rows: [] }, error: options.rpcError ? { message: options.rpcError } : null });
  return { client: { from, rpc } as unknown as SupabaseClient, insert, from, rpc };
}

describe('scheduled DartIQ calibration', () => {
  const end = '2026-09-01T12:00:00Z';

  it('persists an observation-only report with bounded source IDs and no model writes', async () => {
    const test = fixture();
    await expect(runDartIQCalibration(test.client, '1', end)).resolves.toEqual({ recommendation: 'insufficient_data' });
    expect(test.rpc).toHaveBeenCalledWith('load_dartiq_calibration_window', { p_model_version_id: '1', p_window_end: end, p_evaluator_version: expect.any(String) });
    expect(test.insert).toHaveBeenCalledWith(expect.objectContaining({ model_version_id: '1', sampled_event_ids: [],
      source_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      report: expect.objectContaining({ promotionEnabled: false, geometryModelEnabled: false }) }));
  });

  it('skips unchanged windows without appending another report', async () => {
    const test = fixture({ existing: true });
    await expect(runDartIQCalibration(test.client, '1', end)).resolves.toEqual({ skipped: 'unchanged' });
    expect(test.insert).not.toHaveBeenCalled();
  });

  it('includes the frozen artifact in deduplication and saves its independent follow-up report', async () => {
    const test = fixture();
    await runDartIQCalibration(test.client, '1', end);
    const initial = test.insert.mock.calls[0][0].source_fingerprint;
    const candidate = { reportId: '12', frozenAt: end, family: 'temperature_scaling', temperature: 0.85, sourceFingerprint: 'original' };
    test.rpc.mockResolvedValueOnce({ data: { modelVersionId: '1', rows: [], candidate }, error: null });
    await runDartIQCalibration(test.client, '1', end);
    expect(test.insert.mock.calls[1][0].source_fingerprint).not.toBe(initial);
    expect(test.insert.mock.calls[1][0].report.frozenCandidateFollowup).toMatchObject({ candidate, eventCount: 0, recommendation: 'insufficient_data' });
  });

  it('tolerates concurrent duplicate inserts but propagates other failures for retry', async () => {
    await expect(runDartIQCalibration(fixture({ insertError: '23505' }).client, '1', end)).resolves.toBeDefined();
    await expect(runDartIQCalibration(fixture({ insertError: 'XX000' }).client, '1', end)).rejects.toThrow('save failed');
    await expect(runDartIQCalibration(fixture({ rpcError: 'read failed' }).client, '1', end)).rejects.toThrow('read failed');
  });

  it('rejects malformed jobs and mismatched or oversized windows', async () => {
    const test = fixture();
    await expect(runDartIQCalibration(test.client, 'oops', end)).rejects.toThrow('Invalid');
    await expect(runDartIQCalibration(test.client, '1', 'oops')).rejects.toThrow('Invalid');
    expect(test.rpc).not.toHaveBeenCalled();
    await expect(runDartIQCalibration(fixture({ wrongModel: true }).client, '1', end)).rejects.toThrow('window');
    test.rpc.mockResolvedValueOnce({ data: { modelVersionId: '1', rows: Array(8001).fill(null) }, error: null });
    await expect(runDartIQCalibration(test.client, '1', end)).rejects.toThrow('window');
  });
});

describe('daily model training handler', () => {
  it('waits for sufficient data and never writes an empty artifact', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { generation: '0', rows: [], active: null, pending: null, previous: null }, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    await expect(runDartIQTraining(client, '2026-01-01T00:00:00Z')).resolves.toEqual({ skipped: 'insufficient_data' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid/future windows and propagates database failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'training unavailable' } });
    const client = { rpc } as unknown as SupabaseClient;
    await expect(runDartIQTraining(client, 'oops')).rejects.toThrow('Invalid');
    await expect(runDartIQTraining(client, '2999-01-01')).rejects.toThrow('Invalid');
    expect(rpc).not.toHaveBeenCalled();
    await expect(runDartIQTraining(client, '2026-01-01T00:00:00Z')).rejects.toThrow('training unavailable');
  });
});
