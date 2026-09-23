<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ArrowRight } from '@lucide/vue';
import { api, errorMessage } from '../lib/api';
const route = useRoute(); const router = useRouter(); const resetting = computed(() => route.path === '/reset-password');
const form = reactive({ email: '', token: String(route.query.token ?? ''), password: '', confirmPassword: '' });
const loading = ref(false); const error = ref(''); const message = ref('');
async function submit() {
  error.value = ''; loading.value = true;
  try {
    if (resetting.value) {
      if (form.password !== form.confirmPassword) throw new Error('Passwords do not match');
      const { data } = await api.post('/auth/reset-password', { token: form.token, password: form.password }); message.value = data.data.message; setTimeout(() => void router.push('/login'), 1200);
    } else { const { data } = await api.post('/auth/forgot-password', { email: form.email }); message.value = data.data.message; }
  } catch (cause) { error.value = cause instanceof Error && cause.message === 'Passwords do not match' ? cause.message : errorMessage(cause); } finally { loading.value = false; }
}
</script>
<template><main class="auth-page"><section class="auth-story"><div><img src="/restockr-logo.png" alt="ReStockr" class="auth-logo" /></div><div><h1>Keep your<br><span>network secure.</span></h1><p>Reset credentials safely. Active sessions are revoked after a password change.</p></div><div class="trust-line">Short-lived, single-use reset tokens</div></section><section class="auth-panel"><form class="auth-card" @submit.prevent="submit"><div class="mobile-brand"><img src="/restockr-logo.png" alt="ReStockr" /></div><p class="eyebrow">ACCOUNT RECOVERY</p><h2>{{ resetting ? 'Choose a new password' : 'Reset your password' }}</h2><p class="muted">{{ resetting ? 'Use the secure token from your recovery email.' : 'We’ll send instructions if an account matches this email.' }}</p><div v-if="error" class="form-error">{{ error }}</div><div v-if="message" class="success-message">{{ message }}</div><template v-if="resetting"><label>Reset token<input v-model="form.token" required /></label><label>New password<input v-model="form.password" type="password" minlength="8" required /></label><label>Confirm password<input v-model="form.confirmPassword" type="password" required /></label></template><label v-else>Work email<input v-model.trim="form.email" type="email" required /></label><button class="primary wide" :disabled="loading">{{ loading ? 'Please wait…' : resetting ? 'Update password' : 'Send reset instructions' }}<ArrowRight :size="18" /></button><p class="auth-switch"><RouterLink to="/login">Back to sign in</RouterLink></p></form></section></main></template>
