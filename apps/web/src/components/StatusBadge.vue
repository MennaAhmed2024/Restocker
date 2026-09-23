<script setup lang="ts">defineProps<{ status: string }>();</script>
<template><span class="status" :class="status.toLowerCase()">{{ status.replaceAll('_', ' ') }}</span></template>
