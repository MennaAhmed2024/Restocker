<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Boxes, ClipboardClock, Store, ArrowLeftRight, ArrowUpRight } from '@lucide/vue';
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { api, errorMessage } from '../lib/api';
import { useAuthStore } from '../stores/auth';
ChartJS.register(ArcElement, Tooltip, Legend);
const auth = useAuthStore(); const loading = ref(true); const error = ref('');
const summary = ref({ totalInventory: 0, activeRequests: 0, openOffers: 0, successfulTransfers: 0, stockStatuses: {} as Record<string, number>, recentActivity: [] as Array<{ id: string; action: string; createdAt: string }> });
const cards = computed(() => [
  { label: 'Total Inventory Value', value: new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(summary.value.totalInventory), icon: Boxes, tone: 'blue' },
  { label: 'Active Requests', value: summary.value.activeRequests, icon: ClipboardClock, tone: 'amber' },
  { label: 'Open Offers', value: summary.value.openOffers, icon: Store, tone: 'mint' },
  { label: 'Successful Transfers', value: summary.value.successfulTransfers, icon: ArrowLeftRight, tone: 'violet' },
]);
const chartData = computed(() => ({ labels: Object.keys(summary.value.stockStatuses).map((value) => value.replaceAll('_', ' ')), datasets: [{ data: Object.values(summary.value.stockStatuses), backgroundColor: ['#ef6a6a', '#f4a261', '#f3c969', '#3cc8a0', '#2f80ed', '#8b6ce1'], borderWidth: 0 }] }));
async function load() { loading.value = true; try { const { data } = await api.get('/dashboard/summary'); summary.value = data.data; } catch (cause) { error.value = errorMessage(cause); } finally { loading.value = false; } }
onMounted(load);
</script>
<template>
  <div class="page-heading"><div><p class="eyebrow">OPERATIONS OVERVIEW</p><h1>Welcome back, {{ auth.session?.user.fullName.split(' ')[0] }}</h1><p>Here’s what’s happening across your inventory network.</p></div><button class="secondary">Last 30 days</button></div>
  <div v-if="error" class="form-error">{{ error }} <button @click="load">Retry</button></div>
  <div class="kpi-grid">
    <article v-for="card in cards" :key="card.label" class="kpi-card"><div class="kpi-icon" :class="card.tone"><component :is="card.icon" :size="21" /></div><p>{{ card.label }}</p><h2>{{ loading ? '—' : card.value }}</h2><small><ArrowUpRight :size="14" /> Live operational data</small></article>
  </div>
  <div class="dashboard-grid">
    <article class="panel chart-panel"><div class="panel-heading"><div><h3>Stock health</h3><p>Available inventory by risk level</p></div></div><div v-if="loading" class="skeleton chart-skeleton" /><div v-else-if="!Object.keys(summary.stockStatuses).length" class="empty">Add inventory to see stock health.</div><Doughnut v-else :data="chartData" :options="{ responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } } }" /></article>
    <article class="panel"><div class="panel-heading"><div><h3>Recent activity</h3><p>Latest changes in your organization</p></div></div><div v-if="loading" class="activity-list"><div v-for="n in 4" :key="n" class="skeleton line" /></div><div v-else-if="!summary.recentActivity.length" class="empty">No activity yet.</div><ul v-else class="activity-list"><li v-for="item in summary.recentActivity" :key="item.id"><span class="activity-mark" /><div><strong>{{ item.action.replaceAll('_', ' ') }}</strong><small>{{ new Date(item.createdAt).toLocaleString() }}</small></div></li></ul></article>
  </div>
</template>
