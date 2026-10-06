import type { Env } from "./env";
import { ALL_SYMBOLS, OPHT_TICKERS } from "./tickers";
import { buildChartDataJson, buildHoldings, priceKey } from "./api";
import { getMarketCaps, getStatus } from "./db";
import { BATCH_COUNT, symbolsForBatch } from "./batch";
import { runUpdate } from "./update";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (message: string, status: number) => json({ status: "error", message }, status);

async function chartData(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default; // no-op on *.workers.dev, active on a custom domain
  const cacheKey = new Request(new URL("/api/chart-data", request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const values = await env.CHART_CACHE.get(ALL_SYMBOLS.map(priceKey), "text");
  const body = buildChartDataJson(ALL_SYMBOLS.map((s) => [s, values.get(priceKey(s)) ?? null]));
  const res = new Response(body, {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function adminUpdate(request: Request, env: Env, params: URLSearchParams): Promise<Response> {
  if (!env.ADMIN_TOKEN) return error("Not found", 404);
  if (request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return error("Unauthorized", 401);
  const batch = Number(params.get("batch"));
  if (!params.has("batch") || !Number.isInteger(batch) || batch < 0 || batch >= BATCH_COUNT) {
    return error(`batch must be 0..${BATCH_COUNT - 1}`, 400);
  }
  return json(await runUpdate(env, symbolsForBatch(batch), batch === BATCH_COUNT - 1));
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  try {
    if (request.method === "GET" && pathname === "/api/status") {
      return json({
        seeded: (await getStatus(env.DB, "initial_seed")) === "complete",
        lastUpdate: await getStatus(env.DB, "last_update"),
        seedInProgress: false,
      });
    }
    if (request.method === "GET" && pathname === "/api/chart-data") return await chartData(request, env, ctx);
    if (request.method === "GET" && pathname === "/api/holdings") {
      return json(buildHoldings(OPHT_TICKERS, await getMarketCaps(env.DB)));
    }
    if (request.method === "POST" && pathname === "/api/admin/update") return await adminUpdate(request, env, searchParams);
    return error("Not found", 404);
  } catch (err) {
    console.error(`API error on ${pathname}:`, err);
    return error("Internal Server Error", 500);
  }
}
