<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import DebugConsole from './components/DebugConsole.vue'
import LoginView from './components/LoginView.vue'
import UiIcon from './components/UiIcon.vue'
import { useAuth } from './composables/useAuth'

const auth = useAuth()
const { status, user, userKey, busy, verifying, error, notice } = auth

// Render gate also guards direct URLs, browser Back, and refresh. Only a
// successfully verified /me response can mount the console.
function guardLocation() {
  if (status.value === 'checking') return
  const path = status.value === 'authenticated' && user.value ? '/' : '/login'
  if (window.location.pathname !== path) window.history.replaceState(null, '', path)
}
watch([status, userKey], guardLocation)
function revalidateOnFocus() {
  if (status.value === 'authenticated' && !busy.value && document.visibilityState === 'visible') void auth.restore(true)
}
onMounted(() => {
  window.addEventListener('popstate', guardLocation)
  window.addEventListener('focus', revalidateOnFocus)
  document.addEventListener('visibilitychange', revalidateOnFocus)
  void auth.restore()
})
onBeforeUnmount(() => {
  window.removeEventListener('popstate', guardLocation)
  window.removeEventListener('focus', revalidateOnFocus)
  document.removeEventListener('visibilitychange', revalidateOnFocus)
  auth.dispose()
})
</script>

<template>
  <div v-if="status === 'checking'" class="auth-checking" role="status"><span class="brand-mark"><UiIcon name="code" :size="26" /></span><h1>Agent Lab</h1><p><span class="mini-spinner" />{{ busy ? '正在退出登录…' : '正在验证登录状态…' }}</p></div>
  <DebugConsole v-else-if="status === 'authenticated' && user" :key="userKey" :user="user" :auth-error="error" :verifying="verifying" @logout="auth.logout" @verify="auth.restore(true)" />
  <LoginView v-else :busy="busy" :error="error" :notice="notice" :unavailable="status === 'unavailable'" @login="auth.login" @retry="auth.restore()" />
</template>
