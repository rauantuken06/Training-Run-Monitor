/**
 * Web Worker entry: one request in, one response out (with transferred buffers).
 * The worker keeps no data between jobs; the main thread terminates it after each job.
 */
import { runJob, type RunJobRequest } from './runJob';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RunJobRequest>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const { response, transfer } = runJob(event.data);
  scope.postMessage(response, transfer);
};
