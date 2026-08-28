declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    [key: string]: unknown;
  };
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

// Cloudflare provides this runtime shape in production; the local shim keeps
// framework-generated environment declarations type-checkable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D1Database = any;

type ScheduledController = object;
