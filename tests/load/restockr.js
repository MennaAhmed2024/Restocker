import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = {
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 5, duration: '30s' },
    normal: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: 50 }, { duration: '2m', target: 50 }, { duration: '20s', target: 0 }], startTime: '35s' },
    spike: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '10s', target: 200 }, { duration: '20s', target: 200 }, { duration: '10s', target: 0 }], startTime: '4m' },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] },
};
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
export default function () {
  const headers = { Authorization: `Bearer ${__ENV.ACCESS_TOKEN}` };
  const paths = ['/api/v1/dashboard/summary', '/api/v1/products', '/api/v1/inventory', '/api/v1/marketplace/listings'];
  const response = http.get(`${baseUrl}${paths[__ITER % paths.length]}`, { headers });
  check(response, { 'read endpoint responds': (result) => result.status === 200, 'latency below 500ms': (result) => result.timings.duration < 500 });
  sleep(1);
}
