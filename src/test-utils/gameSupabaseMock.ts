/**
 * Small chainable Supabase mock for server-side game tests.
 *
 * `createTableMock(rows | handler)` returns a table whose query builder records
 * `.select/.eq/.is/.in/.not/.gt/.order/.limit/...` and resolves terminal calls
 * (`await`, `.single()`, `.maybeSingle()`) to `{ data, error, count }`.
 *
 * Pass a row array for an in-memory table (filters, order and limit are
 * applied for you) or a handler `(op) => result` for full control.
 */

export type MockRow = Record<string, unknown>;

export type MockFilter =
  | { kind: 'eq' | 'gt'; column: string; value: unknown }
  | { kind: 'is'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'not'; column: string; operator: string; value: unknown };

export type MockOp = {
  type: 'select' | 'insert' | 'update' | 'delete';
  filters: MockFilter[];
  payload?: unknown;
  options?: Record<string, unknown>;
  columns?: string;
  orders: { column: string; ascending: boolean }[];
  limit?: number;
  terminal: 'list' | 'single' | 'maybeSingle';
};

export type MockError = { message: string; code?: string };

export type MockResult = {
  data?: unknown;
  error?: MockError | null;
  count?: number | null;
};

export type TableHandler = (op: MockOp) => MockResult | Promise<MockResult>;

export type LoggedOp = MockOp & { table: string };

let idCounter = 0;

export function matchesFilters(row: MockRow, filters: MockFilter[]): boolean {
  return filters.every((filter) => {
    const actual = row[filter.column];
    switch (filter.kind) {
      case 'eq':
        return actual === filter.value;
      case 'gt':
        return (actual as number | string) > (filter.value as number | string);
      case 'is':
        return filter.value === null ? actual == null : actual === filter.value;
      case 'in':
        return filter.values.includes(actual);
      case 'not':
        if (filter.operator === 'is' && filter.value === null) return actual != null;
        if (filter.operator === 'eq') return actual !== filter.value;
        return true;
    }
  });
}

/** Default in-memory behaviour for a table backed by a row array. */
export function rowsHandler(rows: MockRow[]): TableHandler {
  return (op) => {
    if (op.type === 'insert') {
      const payloads = Array.isArray(op.payload) ? (op.payload as MockRow[]) : [op.payload as MockRow];
      const inserted = payloads.map((payload) => ({ id: `mock-${++idCounter}`, ...payload }));
      rows.push(...inserted);
      return { data: inserted, error: null, count: inserted.length };
    }
    const matching = rows.filter((row) => matchesFilters(row, op.filters));
    if (op.type === 'update') {
      for (const row of matching) Object.assign(row, op.payload as MockRow);
      return { data: matching, error: null, count: matching.length };
    }
    if (op.type === 'delete') {
      for (const row of matching) rows.splice(rows.indexOf(row), 1);
      return { data: matching, error: null, count: matching.length };
    }
    let data = matching.slice();
    for (const order of op.orders.slice().reverse()) {
      data.sort((a, b) => {
        const av = a[order.column] as number | string;
        const bv = b[order.column] as number | string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (order.ascending ? 1 : -1);
      });
    }
    if (typeof op.limit === 'number') data = data.slice(0, op.limit);
    return { data, error: null, count: data.length };
  };
}

function finalize(result: MockResult, terminal: MockOp['terminal']) {
  const error = result.error ?? null;
  let data: unknown = result.data ?? null;
  if (terminal !== 'list' && Array.isArray(data)) data = data[0] ?? null;
  if (terminal === 'single' && !error && data == null) {
    return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count: null };
  }
  return { data, error, count: result.count ?? null };
}

export function createTableMock(source: MockRow[] | TableHandler, onOp?: (op: MockOp) => void) {
  const handler: TableHandler = typeof source === 'function' ? source : rowsHandler(source);

  function builder(type: MockOp['type'], payload?: unknown, options?: Record<string, unknown>) {
    const op: MockOp = { type, filters: [], payload, options, orders: [], terminal: 'list' };
    const run = async (terminal: MockOp['terminal']) => {
      op.terminal = terminal;
      onOp?.(op);
      return finalize(await handler(op), terminal);
    };
    const chain = {
      select(columns?: string) {
        if (op.type === 'select' || columns !== undefined) op.columns = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        op.filters.push({ kind: 'eq', column, value });
        return chain;
      },
      is(column: string, value: unknown) {
        op.filters.push({ kind: 'is', column, value });
        return chain;
      },
      in(column: string, values: unknown[]) {
        op.filters.push({ kind: 'in', column, values });
        return chain;
      },
      not(column: string, operator: string, value: unknown) {
        op.filters.push({ kind: 'not', column, operator, value });
        return chain;
      },
      gt(column: string, value: unknown) {
        op.filters.push({ kind: 'gt', column, value });
        return chain;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        op.orders.push({ column, ascending: opts?.ascending !== false });
        return chain;
      },
      limit(count: number) {
        op.limit = count;
        return chain;
      },
      single: () => run('single'),
      maybeSingle: () => run('maybeSingle'),
      then<T1 = unknown, T2 = never>(
        onfulfilled?: ((value: Awaited<ReturnType<typeof run>>) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
      ) {
        return run('list').then(onfulfilled, onrejected);
      },
    };
    return chain;
  }

  return {
    select: (columns?: string) => builder('select').select(columns),
    insert: (payload: unknown, options?: Record<string, unknown>) => builder('insert', payload, options),
    update: (payload: unknown, options?: Record<string, unknown>) => builder('update', payload, options),
    delete: (options?: Record<string, unknown>) => builder('delete', undefined, options),
  };
}

/**
 * A `from(table)` client whose tables come from `tables`. Every executed
 * operation is appended to `ops` (with its table name) for assertions.
 */
export function createSupabaseMock(tables: Record<string, MockRow[] | TableHandler>) {
  const ops: LoggedOp[] = [];
  const client = {
    ops,
    from(table: string) {
      const source = tables[table];
      if (!source) throw new Error(`Unexpected table: ${table}`);
      return createTableMock(source, (op) => ops.push({ table, ...op }));
    },
    /** Operations logged for one table, optionally narrowed by type. */
    opsFor(table: string, type?: MockOp['type']) {
      return ops.filter((op) => op.table === table && (!type || op.type === type));
    },
  };
  return client;
}

export function filterValue(op: MockOp, column: string): unknown {
  const filter = op.filters.find((candidate) => candidate.column === column);
  if (!filter) return undefined;
  return 'value' in filter ? filter.value : filter.values;
}
