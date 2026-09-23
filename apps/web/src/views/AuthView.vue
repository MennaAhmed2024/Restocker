<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { Eye, EyeOff, ArrowRight, CheckCircle2 } from '@lucide/vue';
import { api, errorMessage } from '../lib/api';
import { useAuthStore } from '../stores/auth';
const route = useRoute(); const router = useRouter(); const auth = useAuthStore();
const register = computed(() => route.path === '/register'); const loading = ref(false); const showPassword = ref(false); const error = ref('');
const form = reactive({ fullName: '', email: '', password: '', confirmPassword: '', companyName: '', companyType: 'Retail', country: 'Egypt', termsAccepted: false });
async function submit() {
  error.value = ''; loading.value = true;
  try {
    if (register.value) {
      const { data } = await api.post('/auth/register', form);
      auth.acceptTokens(data.data.accessToken, data.data.refreshToken);
    } else await auth.login(form.email, form.password);
    await router.push('/');
  } catch (cause) { error.value = errorMessage(cause); } finally { loading.value = false; }
}
</script>
<template>
  <main class="auth-page">
    <section class="auth-story">
      <div><img src="/restockr-logo.png" alt="ReStockr" class="auth-logo" /><p class="eyebrow">THE INVENTORY NETWORK</p></div>
      <div><h1>Turn surplus into<br><span>opportunity.</span></h1><p>Balance stock across every location, then tap into a trusted B2B network when your own inventory isn't enough.</p></div>
      <div class="trust-line"><CheckCircle2 :size="18" /> Private by default · Built for multi-company operations</div>
    </section>
    <section class="auth-panel">
      <form class="auth-card" @submit.prevent="submit">
        <div class="mobile-brand"><img src="/restockr-logo.png" alt="ReStockr" /></div>
        <p class="eyebrow">{{ register ? 'START YOUR NETWORK' : 'WELCOME BACK' }}</p>
        <h2>{{ register ? 'Create your workspace' : 'Sign in to ReStockr' }}</h2>
        <p class="muted">{{ register ? 'Set up your company in less than two minutes.' : 'See what’s happening across your inventory network.' }}</p>
        <div v-if="error" class="form-error" role="alert">{{ error }}</div>
        <label v-if="register">Full name<input v-model.trim="form.fullName" autocomplete="name" required minlength="2" placeholder="Ahmed Hassan" /></label>
        <label v-if="register">Company name<input v-model.trim="form.companyName" autocomplete="organization" required placeholder="Nova Retail" /></label>
        <div v-if="register" class="form-row">
          <label>Company type<select v-model="form.companyType"><option>Retail</option><option>Wholesale</option><option>Distributor</option><option>Manufacturer</option></select></label>
          <label>Country<input v-model.trim="form.country" required /></label>
        </div>
        <label>Work email<input v-model.trim="form.email" type="email" autocomplete="email" required placeholder="you@company.com" /></label>
        <label>Password<span class="password-field"><input v-model="form.password" :type="showPassword ? 'text' : 'password'" :autocomplete="register ? 'new-password' : 'current-password'" required minlength="8" placeholder="At least 8 characters" /><button type="button" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword"><EyeOff v-if="showPassword" :size="18" /><Eye v-else :size="18" /></button></span></label>
        <label v-if="register">Confirm password<input v-model="form.confirmPassword" type="password" autocomplete="new-password" required /></label>
        <label v-if="register" class="check"><input v-model="form.termsAccepted" type="checkbox" required /> I agree to the Terms and Privacy Policy.</label>
        <div v-else class="form-meta"><span></span><RouterLink to="/forgot-password">Forgot password?</RouterLink></div>
        <button class="primary wide" :disabled="loading">{{ loading ? 'Please wait…' : register ? 'Create workspace' : 'Sign in' }}<ArrowRight v-if="!loading" :size="18" /></button>
        <p class="auth-switch">{{ register ? 'Already have an account?' : 'New to ReStockr?' }} <RouterLink :to="register ? '/login' : '/register'">{{ register ? 'Sign in' : 'Create account' }}</RouterLink></p>
      </form>
    </section>
  </main>
</template>
