/** Keep the last failure readable through rapid reconnect/status transitions. */
export function RealtimeConnectionError({ message, connected }: { message?: string | null; connected: boolean }) {
  if (!message) return null;
  return (
    <div role="status" className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-amber-400/50 bg-white/95 p-3 text-xs text-slate-900 shadow-lg dark:bg-slate-950/95 dark:text-slate-100">
      <p className="font-semibold">{connected ? 'Realtime recovered — last error' : 'Realtime connection error'}</p>
      <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words select-text">{message}</p>
    </div>
  );
}
