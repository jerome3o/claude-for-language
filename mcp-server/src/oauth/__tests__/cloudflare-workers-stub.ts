/** `cloudflare:workers` for Node tests: the oauth provider only extends WorkerEntrypoint. */
export class WorkerEntrypoint {
  constructor(public ctx?: unknown, public env?: unknown) {}
}
