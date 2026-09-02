import 'server-only';

import type { ScoliaBoard } from '@/lib/scolia/types';

const DEFAULT_SCOLIA_API_BASE_URL = 'https://game.scoliadarts.com';
const REQUEST_TIMEOUT_MS = 10_000;

export class ScoliaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly diagnostics?: {
      upstreamStatus: number;
      payload: unknown;
      requestId: string | null;
    }
  ) {
    super(message);
    this.name = 'ScoliaApiError';
  }
}

function getAccessToken(): string {
  const token = process.env.SCOLIA_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new ScoliaApiError('SCOLIA_ACCESS_TOKEN is not configured on the server', 503);
  }
  return token;
}

function getBaseUrl(): string {
  return (process.env.SCOLIA_API_BASE_URL?.trim() || DEFAULT_SCOLIA_API_BASE_URL).replace(/\/$/, '');
}

async function readError(response: Response): Promise<{ message: string; payload: unknown }> {
  const text = await response.text();
  if (!text) {
    return { message: `Scolia request failed (${response.status})`, payload: null };
  }
  try {
    const body = JSON.parse(text) as { error?: unknown; errorMessage?: unknown; message?: unknown };
    const message = [body.errorMessage, body.message, body.error].find(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    return { message: message || `Scolia request failed (${response.status})`, payload: body };
  } catch {
    return { message: text, payload: text };
  }
}

async function scoliaRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${getAccessToken()}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ScoliaApiError) throw error;
    throw new ScoliaApiError('Could not reach the Scolia API', 502);
  }

  if (!response.ok) {
    const { message, payload } = await readError(response);
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new ScoliaApiError(message, status, {
      upstreamStatus: response.status,
      payload,
      requestId:
        response.headers.get('x-request-id') ||
        response.headers.get('x-correlation-id') ||
        response.headers.get('cf-ray'),
    });
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ScoliaApiError('Scolia returned an invalid JSON response', 502);
  }
}

function isScoliaBoard(value: unknown): value is ScoliaBoard {
  if (!value || typeof value !== 'object') return false;
  const board = value as Record<string, unknown>;
  return (
    typeof board.name === 'string' &&
    typeof board.serialNumber === 'string' &&
    typeof board.isHomeSbc === 'boolean'
  );
}

export async function listScoliaBoards(): Promise<ScoliaBoard[]> {
  const boards = await scoliaRequest<unknown>('/api/social/boards', { method: 'GET' });
  if (!Array.isArray(boards) || !boards.every(isScoliaBoard)) {
    throw new ScoliaApiError('Scolia returned an invalid board list', 502);
  }
  return boards;
}

export async function connectScoliaBoard(serialNumber: string): Promise<ScoliaBoard> {
  const board = await scoliaRequest<unknown>('/api/social/boards', {
    method: 'PUT',
    body: JSON.stringify({ serialNumber }),
  });
  if (!isScoliaBoard(board)) {
    throw new ScoliaApiError('Scolia returned an invalid board', 502);
  }
  return board;
}

export async function disconnectScoliaBoard(serialNumber: string): Promise<void> {
  await scoliaRequest<void>(`/api/social/boards/${encodeURIComponent(serialNumber)}`, {
    method: 'DELETE',
  });
}
