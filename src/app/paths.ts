/** Central route path builders, so pages never hand-assemble URLs. */
export const paths = {
  runs: '/',
  runDetails: (runId: string) => `/runs/${encodeURIComponent(runId)}`,
} as const;
