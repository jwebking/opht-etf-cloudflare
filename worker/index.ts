import type { Env } from "./env";
import { handleApi } from "./routes";
import { runScheduled } from "./update";

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.scheduledTime, env));
  },
} satisfies ExportedHandler<Env>;
