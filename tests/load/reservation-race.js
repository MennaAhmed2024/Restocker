import http from 'k6/http';
import { check } from 'k6';
export const options = { scenarios: { race: { executor: 'shared-iterations', vus: 100, iterations: 100, maxDuration: '30s' } }, thresholds: { http_req_failed: ['rate<0.91'] } };
const baseUrl = __ENV.BASE_URL || 'http://localhost:8080';
export default function () {
  const response = http.post(`${baseUrl}/api/v1/marketplace/listings/${__ENV.LISTING_ID}/requests`, JSON.stringify({ quantity: 10, destinationLocationId: __ENV.DESTINATION_LOCATION_ID }), { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${__ENV.ACCESS_TOKEN}` } });
  check(response, { 'reserved or safely rejected': (result) => result.status === 201 || result.status === 409 });
}
