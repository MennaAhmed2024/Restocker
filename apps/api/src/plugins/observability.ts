import fp from 'fastify-plugin';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const observability = fp(async (app) => {
  const registry = new Registry(); collectDefaultMetrics({ register: registry, prefix: 'restockr_' });
  const requests = new Counter({ name: 'restockr_http_requests_total', help: 'HTTP requests', labelNames: ['method', 'route', 'status'], registers: [registry] });
  const duration = new Histogram({ name: 'restockr_http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'], buckets: [.01,.025,.05,.1,.25,.5,1,2.5], registers: [registry] });
  app.addHook('onRequest', async (request, reply) => { const trace = String(request.headers.traceparent ?? request.headers['x-request-id'] ?? request.id); reply.header('X-Trace-Id', trace); (request as typeof request & { startedAt: bigint }).startedAt = process.hrtime.bigint(); });
  app.addHook('onResponse', async (request, reply) => { const start = (request as typeof request & { startedAt?: bigint }).startedAt; const route = request.routeOptions.url || 'unknown'; const labels = { method: request.method, route, status: String(reply.statusCode) }; requests.inc(labels); if (start) duration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9); });
  app.get('/metrics', async (_request, reply) => reply.type(registry.contentType).send(await registry.metrics()));
});
