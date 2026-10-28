<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import ChatPanel from './components/ChatPanel.vue'
import DebugPanel from './components/DebugPanel.vue'
import UiIcon from './components/UiIcon.vue'
import { useChat } from './composables/useChat'
import { checkHealth, errorMessage } from './api/chat'
import { MODES } from './types/chat'
import type { ChatMode } from './types/chat'

const { mode, currentRecords, selectedRecord, draft, status, state, busy, validationError, logLimit, send, stop, clear, selectRecord } = useChat()
const healthState = ref<'unchecked' | 'checking' | 'up' | 'down' | 'warning'>('unchecked')
const healthLabel = ref('尚未检测')
const healthDetail = ref('健康检查仅说明后端可达，不代表模型或 Dify 调用正常。')
let healthController: AbortController | undefined

async function health() {
  if (healthState.value === 'checking') return
  healthController = new AbortController()
  const controller = healthController
  const timeout = setTimeout(() => controller.abort(), 8000)
  healthState.value = 'checking'
  healthLabel.value = '检测中'
  try {
    const result = await checkHealth(controller.signal)
    healthState.value = result.ok ? 'up' : 'warning'
    healthLabel.value = `后端可达 · ${result.status}`
    healthDetail.value = '健康检查仅说明后端可达，不代表模型或 Dify 调用正常。'
  } catch (error) {
    healthState.value = 'down'
    healthLabel.value = '检测失败'
    healthDetail.value = controller.signal.aborted ? '健康检查超时（8 秒），请检查后端和代理目标。' : `健康检查失败：${errorMessage(error)}。请检查后端和 Vite 代理目标。`
  } finally {
    clearTimeout(timeout)
    if (healthController === controller) healthController = undefined
  }
}
onBeforeUnmount(() => healthController?.abort())

function switchMode(nextMode: ChatMode) { if (!busy.value) mode.value = nextMode }
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="Agent Lab 首页"><span class="brand-mark"><UiIcon name="code" :size="23" /></span><span>Agent<span class="brand-light"> Lab</span><small>LOCAL DEVELOPMENT</small></span></a>
      <div class="sidebar-section"><p class="nav-label">调用模式 <span>02</span></p><nav class="mode-navigation" aria-label="调用模式"><button v-for="(item, key) in MODES" :key="key" class="mode-button" :class="{ active: mode === key }" :aria-pressed="mode === key" :disabled="busy" @click="switchMode(key)"><span class="mode-icon"><UiIcon :name="key === 'agent' ? 'terminal' : 'workflow'" :size="20" /></span><span><strong>{{ item.label }}</strong><small>{{ key === 'agent' ? 'Java 原生调用链路' : 'Dify 工作流调用' }}</small></span><span v-if="mode === key" class="active-dot" /></button></nav></div>
      <div class="route-card"><span class="field-caption">CURRENT ENDPOINT</span><code>{{ MODES[mode].path }}</code><div><span class="method">POST</span><span>仅发送 message</span></div></div>
      <div class="sidebar-bottom"><div class="local-indicator"><span class="state-dot" />本地调试环境</div><p>密钥由 Java 后端管理。<br />前端通过 Vite 代理访问接口。</p><div class="sidebar-version"><span>Vue 3 + TypeScript</span><span>v1.0</span></div></div>
    </aside>

    <main class="main-content">
      <header class="page-header"><div><div class="breadcrumb">开发工具<span>/</span>接口调试</div><div class="page-title-row"><h1>Agent 接口调试台</h1><span class="local-badge">LOCAL</span></div><p>调试请求，观察响应，了解 Agent 的每一步。</p></div><div class="health-control"><button class="button health-button" :disabled="healthState === 'checking'" @click="health"><UiIcon name="pulse" :size="17" />{{ healthState === 'checking' ? '正在检测…' : '检测后端连接' }}</button><span class="health-label" :class="healthState" role="status"><span class="state-dot" />{{ healthLabel }}</span></div></header>
      <div v-if="healthState === 'down' || healthState === 'warning'" class="health-alert" role="alert"><UiIcon name="info" :size="16" />{{ healthDetail }}</div>
      <section class="mode-overview"><div class="mode-overview-icon"><UiIcon :name="mode === 'agent' ? 'terminal' : 'workflow'" :size="20" /></div><div><h2>{{ MODES[mode].label }}</h2><p>{{ MODES[mode].description }}</p></div><span class="compatibility-badge"><span class="state-dot" />JSON / SSE 兼容</span></section>
      <div class="workspace-grid">
        <ChatPanel :mode="mode" :records="currentRecords" :selected-id="selectedRecord?.id" v-model:draft="draft" :busy="busy" :state="state" :status="status" :validation-error="validationError" @send="send" @stop="stop" @clear="clear" @select="selectRecord" />
        <DebugPanel :record="selectedRecord" :path="MODES[mode].path" :draft="draft" v-model:log-limit="logLimit" />
      </div>
      <footer class="page-footer"><span><UiIcon name="info" :size="13" />健康检查成功 ≠ 模型或 Dify 调用成功</span><span>调试记录仅在当前页面保留 · 刷新即清空</span></footer>
    </main>
  </div>
</template>
