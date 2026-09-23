<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { LayoutDashboard, Boxes, Store, ClipboardList, Bell, Menu, LogOut, X, ShoppingBag, ArrowLeftRight, ChartNoAxesCombined, Building2, Settings } from '@lucide/vue';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';
const auth = useAuthStore(); const router = useRouter(); const mobileOpen = ref(false);
interface Notification { id: string; title: string; message: string; readAt: string | null; createdAt: string }
const notifications = ref<Notification[]>([]); const notificationsOpen = ref(false); const unread = computed(() => notifications.value.filter((item) => !item.readAt).length);
let socket: WebSocket | undefined; let reconnectTimer: number | undefined; let disposed = false;
const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard }, { to: '/inventory', label: 'Inventory', icon: Boxes },
  { to: '/marketplace', label: 'Marketplace', icon: Store }, { to: '/requests', label: 'Requests', icon: ClipboardList },
  { to: '/orders', label: 'Orders', icon: ShoppingBag }, { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { to: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined }, { to: '/network', label: 'Companies', icon: Building2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];
async function logout() { await auth.logout(); await router.push('/login'); }
async function loadNotifications() { const { data } = await api.get('/notifications'); notifications.value = data.data; }
async function markRead(item: Notification) { if (!item.readAt) { await api.post(`/notifications/${item.id}/read`); item.readAt = new Date().toISOString(); } }
function connectRealtime() {
  const token = localStorage.getItem('accessToken'); if (!token || disposed) return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/realtime?token=${encodeURIComponent(token)}`);
  socket.onmessage = () => void loadNotifications();
  socket.onclose = () => { if (!disposed) reconnectTimer = window.setTimeout(connectRealtime, 2_000); };
}
onMounted(() => { void loadNotifications(); connectRealtime(); });
onBeforeUnmount(() => { disposed = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.close(); });
</script>
<template>
  <div class="app-layout">
    <div v-if="mobileOpen" class="scrim" @click="mobileOpen = false" />
    <aside class="sidebar" :class="{ open: mobileOpen }">
      <button class="mobile-close" aria-label="Close menu" @click="mobileOpen = false"><X :size="20" /></button>
      <img src="/restockr-logo.png" alt="ReStockr" class="sidebar-logo" />
      <nav aria-label="Main navigation">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to" @click="mobileOpen = false"><component :is="link.icon" :size="19" />{{ link.label }}</RouterLink>
      </nav>
      <button class="logout" @click="logout"><LogOut :size="18" /> Sign out</button>
    </aside>
    <main class="main-area">
      <header class="topbar">
        <button class="menu-button" aria-label="Open menu" @click="mobileOpen = true"><Menu :size="21" /></button>
        <div class="notification-menu"><button class="icon-button" aria-label="Notifications" @click="notificationsOpen = !notificationsOpen"><Bell :size="20" /><span v-if="unread" class="notification-dot" /></button><div v-if="notificationsOpen" class="notification-popover"><div class="popover-heading"><strong>Notifications</strong><span>{{ unread }} unread</span></div><button v-for="item in notifications" :key="item.id" :class="{ unread: !item.readAt }" @click="markRead(item)"><strong>{{ item.title }}</strong><span>{{ item.message }}</span><small>{{ new Date(item.createdAt).toLocaleString() }}</small></button><p v-if="!notifications.length">No notifications yet.</p></div></div>
        <div class="account"><span>{{ auth.session?.user.fullName?.split(' ')[0] }}</span><small>{{ auth.session?.organization.name }}</small></div>
        <div class="avatar">{{ auth.session?.user.fullName?.charAt(0) }}</div>
      </header>
      <section class="page"><RouterView /></section>
    </main>
  </div>
</template>
