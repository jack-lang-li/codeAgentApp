<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MODES } from '../types/chat'
import type { ChatMode, ChatRecord, RequestState } from '../types/chat'
import UiIcon from './UiIcon.vue'

const props = defineProps<{
  mode: ChatMode
  records: ChatRecord[]
  selectedId?: number
  draft: string
  busy: boolean
  state: RequestState
  status: string
  validationError: string
}>()
const emit = defineEmits<{
  'update:draft': [value: string]
  send: []
  stop: []
  clear: []
  select: [id: number]
}>()

const scroller = ref<HTMLElement>()
const textarea = ref<HTMLTextAreaElement>()
const followBottom = ref(true)
const copyNotice = ref('')
const copiedId = ref<number>()
let copyTimer: ReturnType<typeof setTimeout> | undefined
let scrollFrame = 0
const totalCharacters = computed(() => props.records.reduce((total, record) => total + record.answer.length, 0))
const samples = [
  { title: '长回答与代码', text: '用中文分八点介绍 Java 接口和抽象类，并给出代码示例。', icon: 'code', tag: '观察输出' },
  { title: '订单与物流', text: '查询订单10001的物流情况，请先查订单，再根据运单号查物流。', icon: 'order', tag: '工具调用' },
  { title: '北京时间', text: '现在北京时间几点？', icon: 'clock', tag: '试试 Dify' },
]

function onScroll() {
  const element = scroller.value
  if (element) followBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 72
}

function scrollToBottom(force = false) {
  if (force) followBottom.value = true
  if (!followBottom.value || scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const element = scroller.value
    if (element && followBottom.value) element.scrollTop = element.scrollHeight
  })
}

watch(() => [props.records.length, props.mode], async () => { await nextTick(); scrollToBottom(true) })
watch(() => [totalCharacters.value, props.status, props.records.at(-1)?.error], async () => { await nextTick(); scrollToBottom() })

function useSample(text: string) {
  emit('update:draft', text)
  textarea.value?.focus()
}

function send() {
  if (props.busy) return
  emit('send')
}

function keyboardSend(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    send()
  }
}

async function copyAnswer(record: ChatRecord) {
  try {
    await navigator.clipboard.writeText(record.answer)
    copiedId.value = record.id
    copyNotice.value = '回答已复制'
  } catch {
    copyNotice.value = '复制失败，请选择回答文本后手动复制。'
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedId.value = undefined; copyNotice.value = '' }, 2500)
}

onBeforeUnmount(() => { clearTimeout(copyTimer); cancelAnimationFrame(scrollFrame) })
</script>

<template>
  <section class="chat-panel panel" aria-label="聊天接口调试">
    <div class="panel-toolbar">
      <div class="panel-title"><UiIcon name="message" :size="18" /><h2>交互记录</h2><span class="count-badge">{{ records.length }}</span></div>
      <button class="button text-button" :disabled="!records.length" @click="emit('clear')"><UiIcon name="trash" :size="15" />清空记录</button>
    </div>

    <div class="transport-bar"><span class="method">POST</span><code>{{ MODES[mode].path }}</code><span class="transport-note">自动识别 JSON / SSE</span></div>

    <div ref="scroller" class="message-scroller" tabindex="0" aria-label="调试消息记录" @scroll.passive="onScroll">
      <div v-if="!records.length" class="empty-state">
        <div class="empty-symbol"><UiIcon :name="mode === 'agent' ? 'terminal' : 'workflow'" :size="30" /></div>
        <p class="eyebrow">READY TO EXPLORE</p>
        <h3>从一个问题开始调试</h3>
        <p class="empty-description">发送请求，查看回答与处理状态。<br />响应模式由后端实际返回的 Content-Type 决定。</p>
        <div class="sample-list">
          <button v-for="sample in samples" :key="sample.title" class="sample-card" @click="useSample(sample.text)">
            <span class="sample-icon"><UiIcon :name="sample.icon" :size="19" /></span>
            <span class="sample-copy"><strong>{{ sample.title }}</strong><span>{{ sample.text }}</span></span>
            <span class="sample-tag">{{ sample.tag }}</span><UiIcon class="sample-arrow" name="arrow" :size="16" />
          </button>
        </div>
        <p class="empty-footnote">选择示例填入输入框，点击发送后才会调用接口。</p>
      </div>

      <div v-else class="message-list">
        <article v-for="(record, index) in records" :key="record.id" class="exchange" :class="{ 'exchange-selected': record.id === selectedId }">
          <div class="exchange-heading"><span>请求 {{ String(index + 1).padStart(2, '0') }}</span><button class="inline-button" @click="emit('select', record.id)">{{ record.id === selectedId ? '正在查看调试' : '查看调试' }}<UiIcon name="chevron" :size="12" /></button></div>
          <div class="message-row user-row"><span class="avatar user-avatar">你</span><div class="message-body"><div class="message-label">用户问题</div><pre class="message-text">{{ record.question }}</pre></div></div>
          <div class="message-row assistant-row">
            <span class="avatar assistant-avatar"><UiIcon :name="mode === 'agent' ? 'terminal' : 'workflow'" :size="16" /></span>
            <div class="message-body">
              <div class="message-label">{{ MODES[mode].label }}<span v-if="record.debug.responseMode !== 'unknown'" class="protocol-tag" :class="record.debug.responseMode.toLowerCase()">{{ record.debug.responseMode }}</span><span v-if="record.state === 'requesting'" class="generating-label"><span class="mini-spinner" />接收中</span></div>
              <pre v-if="record.answer" class="message-text answer-text">{{ record.answer }}</pre>
              <p v-else-if="record.state === 'requesting'" class="waiting-text">等待后端返回正文<span class="waiting-dots">…</span></p>
              <p v-else-if="record.state === 'complete'" class="muted">后端已完成，回答正文为空。</p>
              <p v-else class="muted">未接收到回答正文。</p>
              <div v-if="record.error" class="message-error" role="alert"><UiIcon name="info" :size="16" /><div><strong>请求失败</strong><pre>{{ record.error }}</pre></div></div>
              <p v-if="record.state === 'stopped'" class="stopped-note">已停止接收{{ record.answer ? '，已保留部分正文' : '' }}。这不代表后端或模型已立即停止。</p>
              <div class="answer-footer"><span class="record-state" :class="record.state"><span class="state-dot" />{{ record.status }}</span><button v-if="record.answer" class="inline-button copy-button" :aria-label="`复制第 ${index + 1} 条回答`" @click="copyAnswer(record)"><UiIcon :name="copiedId === record.id ? 'check' : 'copy'" :size="14" />{{ copiedId === record.id ? '已复制' : '复制回答' }}</button></div>
            </div>
          </div>
        </article>
      </div>
    </div>
    <div v-if="!followBottom && records.length" class="jump-row"><button class="button secondary-button jump-button" @click="scrollToBottom(true)"><UiIcon name="down" :size="14" />回到最新消息</button></div>

    <form class="composer" @submit.prevent="send">
      <div class="current-status" role="status" aria-live="polite"><span class="state-dot" :class="state" /><span>{{ status }}</span><span v-if="busy" class="status-caption">正文到达后会自动更新</span></div>
      <label class="sr-only" for="question">输入问题</label>
      <div class="input-shell" :class="{ 'input-invalid': validationError }">
        <textarea id="question" ref="textarea" :value="draft" rows="3" :aria-invalid="Boolean(validationError)" :aria-describedby="validationError ? 'input-error' : 'composer-help'" placeholder="输入你想调试的问题…" @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)" @keydown="keyboardSend" />
        <div class="composer-controls"><span class="shortcut"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 发送</span><div class="composer-buttons"><button type="button" class="button secondary-button" :disabled="!busy" @click="emit('stop')"><UiIcon name="stop" :size="14" />停止接收</button><button type="submit" class="button primary-button" :disabled="busy"><UiIcon name="send" :size="16" />发送</button></div></div>
      </div>
      <p v-if="validationError" id="input-error" class="validation-error" role="alert">{{ validationError }}</p>
      <p id="composer-help" class="composer-note"><UiIcon name="info" :size="13" />仅发送当前 message；记录仅存于本页，不代表后端具有多轮记忆。</p>
      <span v-if="copyNotice" class="copy-notice" role="status">{{ copyNotice }}</span>
    </form>
  </section>
</template>
