import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../lib/api';

interface Session { user: { id: string; fullName: string; email: string }; organization: { id: string; name: string }; role: string }
export const useAuthStore = defineStore('auth', () => {
  const session = ref<Session | null>(null);
  const accessToken = ref<string | null>(localStorage.getItem('accessToken'));
  const isAuthenticated = computed(() => Boolean(accessToken.value));
  function acceptTokens(nextAccessToken: string, refreshToken: string) {
    localStorage.setItem('accessToken', nextAccessToken);
    localStorage.setItem('refreshToken', refreshToken);
    accessToken.value = nextAccessToken;
  }
  async function login(email: string, password: string) {
    const { data: response } = await api.post('/auth/login', { email, password });
    acceptTokens(response.data.accessToken, response.data.refreshToken);
    session.value = { user: response.data.user, organization: response.data.organization, role: 'OWNER' };
  }
  async function loadSession() { const { data } = await api.get('/auth/me'); session.value = data.data; }
  async function logout() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken'); accessToken.value = null; session.value = null;
  }
  return { session, isAuthenticated, acceptTokens, login, loadSession, logout };
});
