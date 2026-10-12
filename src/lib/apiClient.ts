type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

/** A non-2xx response; `status` lets callers tell an outage from a request that will keep failing. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, options?: { method?: string; body?: JsonValue }): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new ApiError(message || `Request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

async function safeReadError(response: Response): Promise<string | null> {
  try {
    const data = (await response.json()) as { error?: string };
    return data?.error ?? null;
  } catch {
    return null;
  }
}
