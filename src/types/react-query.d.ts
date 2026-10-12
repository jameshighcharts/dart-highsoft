import '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** Restore this query from localStorage on the next load (see QueryProvider). */
      persist?: boolean;
    };
  }
}
