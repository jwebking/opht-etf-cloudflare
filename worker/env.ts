export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CHART_CACHE: KVNamespace;
  FMP_API_KEY?: string;
  ADMIN_TOKEN?: string;
}
