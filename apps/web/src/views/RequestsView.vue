<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ClipboardList } from '@lucide/vue';
import { api, errorMessage } from '../lib/api';
import StatusBadge from '../components/StatusBadge.vue';
interface RequestRow { id: string; quantity: number; unitPrice: string; status: string; expiresAt: string; listing: { title: string; currency: string }; buyerOrganization?: { name: string }; sellerOrganization?: { name: string } }
const tab = ref<'incoming' | 'outgoing'>('incoming'); const rows = ref<RequestRow[]>([]); const loading = ref(true); const error = ref('');
async function load(next = tab.value) { tab.value = next; loading.value = true; try { const { data } = await api.get(`/requests/${tab.value}`); rows.value = data.data; } catch (cause) { error.value = errorMessage(cause); } finally { loading.value = false; } }
async function decide(id: string, action: 'accept' | 'decline') { try { await api.post(`/requests/${id}/${action}`); await load(); } catch (cause) { error.value = errorMessage(cause); } }
onMounted(() => load());
</script>
<template>
  <div class="page-heading"><div><p class="eyebrow">TRADE WORKFLOW</p><h1>Stock requests</h1><p>Review incoming demand and track your outbound requests.</p></div></div>
  <div class="tabs"><button :class="{ active: tab === 'incoming' }" @click="load('incoming')">Incoming</button><button :class="{ active: tab === 'outgoing' }" @click="load('outgoing')">Outgoing</button></div>
  <div v-if="error" class="form-error">{{ error }}</div>
  <article class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Company</th><th>Product</th><th>Quantity</th><th>Value</th><th>Expires</th><th>Status</th><th v-if="tab === 'incoming'">Action</th></tr></thead><tbody><tr v-if="loading" v-for="n in 4" :key="n"><td colspan="7"><div class="skeleton line" /></td></tr><tr v-else v-for="row in rows" :key="row.id"><td><strong>{{ row.buyerOrganization?.name ?? row.sellerOrganization?.name }}</strong></td><td>{{ row.listing.title }}</td><td>{{ row.quantity }}</td><td>{{ (row.quantity * Number(row.unitPrice)).toLocaleString() }} {{ row.listing.currency }}</td><td>{{ new Date(row.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</td><td><StatusBadge :status="row.status" /></td><td v-if="tab === 'incoming'"><div v-if="row.status === 'RESERVED'" class="row-actions"><button class="text-button success" @click="decide(row.id, 'accept')">Accept</button><button class="text-button danger" @click="decide(row.id, 'decline')">Decline</button></div></td></tr></tbody></table></div><div v-if="!loading && !rows.length" class="empty"><ClipboardList :size="32" /><strong>No {{ tab }} requests</strong><p>Requests will appear here as companies trade inventory.</p></div></article>
</template>
