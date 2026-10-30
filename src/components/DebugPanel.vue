<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatRecord } from '../types/chat'
import UiIcon from './UiIcon.vue'

const props = defineProps<{ record?: ChatRecord; path: string; draft: string; logLimit: number }>()
const emit = defineEmits<{ 'update:logLimit': [value: number] }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
watch(() => props.record?.state === 'requesting', (running) => {
  clearInterval(timer)
  now.value = Date.now()
  if (running) timer = setInterval(() => { now.value = Date.now() }, 200)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))
const body = computed(() => JSON.stringify(props.record?.debug.body || { message: props.draft }, null, 2))
const duration = computed(() => {
  const debug = props.record?.debug
  if (!debug) return '—'
  return `${((Math.max(debug.endedAt || now.value, debug.startedAt) - debug.startedAt) / 1000).toFixed(2)} s`
})
const hiddenEvents = computed(() => props.record ? props.record.debug.eventCount - props.record.debug.events.length : 0)
function time(value: number) { return new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) }
function timestamp(value: number) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
</script>

<template>
  <details class="debug-panel panel" open>
    <summary class="panel-toolbar"><span class="panel-title"><UiIcon name="terminal" :size="18" /><span class="debug-heading">请求调试</span></span><UiIcon class="details-chevron" name="chevron" :size="16" /></summary>
    <div class="debug-content">
      <p class="debug-caption">{{ record ? '当前选中请求的实际信息' : '发送后查看响应与事件' }}</p>
      <section class="debug-section"><h3>REQUEST <span>请求</span></h3><div class="debug-endpoint"><span class="method">POST</span><code>{{ record?.debug.path || path }}</code></div><span class="field-caption">BODY · application/json</span><pre class="code-block request-body">{{ body }}</pre></section>
      <section class="debug-section"><h3>RESPONSE <span>响应</span></h3><dl class="metadata"><div><dt>HTTP 状态</dt><dd :class="record?.debug.httpStatus && record.debug.httpStatus >= 400 ? 'error-color' : ''">{{ record?.debug.httpStatus || '—' }}</dd></div><div><dt>实际模式</dt><dd><span class="protocol-tag" :class="record?.debug.responseMode.toLowerCase()">{{ record && record.debug.responseMode !== 'unknown' ? record.debug.responseMode : record?.debug.httpStatus ? '未知协议' : '等待响应' }}</span></dd></div><div class="metadata-stacked"><dt>Content-Type</dt><dd class="mono">{{ record?.debug.contentType || '—' }}</dd></div><div><dt>开始时间</dt><dd :title="record ? timestamp(record.debug.startedAt) : ''">{{ record ? time(record.debug.startedAt) : '—' }}</dd></div><div><dt>耗时</dt><dd class="mono">{{ duration }}</dd></div></dl></section>
      <section class="debug-section"><div class="event-heading"><h3>EVENTS <span>SSE 事件</span><span class="count-badge">{{ record?.debug.eventCount || 0 }}</span></h3><label class="log-limit">保留<select :value="logLimit" aria-label="SSE 日志保留条数" @change="emit('update:logLimit', Number(($event.target as HTMLSelectElement).value))"><option :value="50">50 条</option><option :value="100">100 条</option><option :value="200">200 条</option></select></label></div><p v-if="hiddenEvents" class="log-notice">较早的 {{ hiddenEvents }} 条已移出日志，回答正文完整保留。</p><div v-if="record?.debug.events.length" class="event-log" tabindex="0" aria-label="SSE 事件日志"><div v-for="event in record.debug.events" :key="event.sequence" class="event-entry"><div><span class="event-name" :class="`event-${event.event}`">{{ event.event }}</span><time>{{ time(event.time) }}</time><span>#{{ event.sequence }}</span></div><pre>{{ event.data }}</pre></div></div><div v-else class="empty-log"><UiIcon name="terminal" :size="22" /><span>{{ record?.debug.responseMode === 'JSON' ? '本次为 JSON 响应，无 SSE 事件' : '暂无 SSE 事件' }}</span></div><p class="log-explanation">只记录 Java 转换后的事件。日志条数与预览长度受限，正文接收不受影响。</p></section>
      <section v-if="record?.debug.error" class="debug-section debug-error"><h3>ERROR <span>错误详情</span></h3><p v-if="record.debug.errorCode" class="error-code">{{ record.debug.errorCode }}</p><pre>{{ record.debug.error }}</pre><details v-if="record.debug.responsePreview"><summary>响应片段 / 底层详情</summary><pre>{{ record.debug.responsePreview }}</pre></details></section>
    </div>
  </details>
</template>
