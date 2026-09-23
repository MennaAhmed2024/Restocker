import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { vus: 20, duration: '20s', thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] } };
const baseUrl = __ENV.BASE_URL || 'http://host.docker.internal:8081';
export default function () {
  const response = http.get(`${baseUrl}/api/v1/${['dashboard/summary','products','inventory','analytics'][__ITER % 4]}`, { headers: { Authorization: `Bearer ${__ENV.ACCESS_TOKEN}` } });
  check(response, { 'status 200': (r) => r.status === 200 }); sleep(.2);
}
