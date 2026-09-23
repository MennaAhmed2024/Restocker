import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';
import AuthView from './views/AuthView.vue';
import AppShell from './components/AppShell.vue';
import DashboardView from './views/DashboardView.vue';
import InventoryView from './views/InventoryView.vue';
import MarketplaceView from './views/MarketplaceView.vue';
import RequestsView from './views/RequestsView.vue';
import PasswordRecoveryView from './views/PasswordRecoveryView.vue';
import OrdersView from './views/OrdersView.vue';
import TransfersView from './views/TransfersView.vue';
import ProductDetailsView from './views/ProductDetailsView.vue';
import AnalyticsView from './views/AnalyticsView.vue';
import SettingsView from './views/SettingsView.vue';
import NetworkView from './views/NetworkView.vue';
import OrderDetailsView from './views/OrderDetailsView.vue';

export const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/login', component: AuthView, meta: { guest: true } },
  { path: '/register', component: AuthView, meta: { guest: true } },
  { path: '/forgot-password', component: PasswordRecoveryView, meta: { guest: true } },
  { path: '/reset-password', component: PasswordRecoveryView, meta: { guest: true } },
  { path: '/', component: AppShell, children: [
    { path: '', name: 'dashboard', component: DashboardView },
    { path: 'inventory', name: 'inventory', component: InventoryView },
    { path: 'products/:id', name: 'product-details', component: ProductDetailsView },
    { path: 'analytics', name: 'analytics', component: AnalyticsView },
    { path: 'network', name: 'network', component: NetworkView },
    { path: 'settings', name: 'settings', component: SettingsView },
    { path: 'marketplace', name: 'marketplace', component: MarketplaceView },
    { path: 'requests', name: 'requests', component: RequestsView },
    { path: 'orders', name: 'orders', component: OrdersView },
    { path: 'orders/:id', name: 'order-details', component: OrderDetailsView },
    { path: 'transfers', name: 'transfers', component: TransfersView },
  ] },
] });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!to.meta.guest && !auth.isAuthenticated) return '/login';
  if (!to.meta.guest && !auth.session) { try { await auth.loadSession(); } catch { await auth.logout(); return '/login'; } }
  if (to.meta.guest && auth.isAuthenticated) return '/';
});
