import axios from 'axios';

export const api = axios.create({ baseURL: '/api/v1', timeout: 12_000 });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use((response) => response, async (error: unknown) => Promise.reject(error));

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError<{ error?: { message?: string } }>(error)) return error.response?.data.error?.message ?? 'Unable to reach ReStockr. Please try again.';
  return 'Something went wrong. Please try again.';
}
