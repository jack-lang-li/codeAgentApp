import { computed, getCurrentScope, onScopeDispose, reactive, ref, watch } from 'vue'
import { ChatApiError, errorMessage, requestChat } from '../api/chat'
import { MODES } from '../types/chat'
import type { ChatMode, ChatRecord, SseEvent } from '../types/chat'

interface ActiveRequest { id: number; mode: ChatMode; controller: AbortController; record: ChatRecord }

/** One active POST, with separate local records and drafts for each mode. */
export function useChat(sendRequest: typeof requestChat = requestChat) {
  const mode = ref<ChatMode>('agent')
  const records = reactive<Record<ChatMode, ChatRecord[]>>({ agent: [], dify: [] })
  const drafts = reactive<Record<ChatMode, string>>({ agent: '', dify: '' })
  const selectedIds = reactive<Record<ChatMode, number | undefined>>({ agent: undefined, dify: undefined })
  const logLimit = ref(100)
  const busy = ref(false)
  const validationError = ref('')
  let sequence = 0
  let active: ActiveRequest | undefined

  const currentRecords = computed(() => records[mode.value])
  const selectedRecord = computed(() => currentRecords.value.find((record) => record.id === selectedIds[mode.value]))
  const latestRecord = computed(() => currentRecords.value.at(-1))
  const draft = computed({ get: () => drafts[mode.value], set: (value: string) => { drafts[mode.value] = value } })
  const status = computed(() => latestRecord.value?.status || '待发送')
  const state = computed(() => latestRecord.value?.state || 'idle')

  function trimEvents(record: ChatRecord) {
    if (record.debug.events.length > logLimit.value) {
      record.debug.events.splice(0, record.debug.events.length - logLimit.value)
    }
  }

  watch(logLimit, (value) => {
    if (![50, 100, 200].includes(value)) { logLimit.value = 100; return }
    for (const record of [...records.agent, ...records.dify]) trimEvents(record)
  })
  watch(mode, () => { validationError.value = '' })

  function logEvent(record: ChatRecord, event: SseEvent) {
    record.debug.eventCount += 1
    record.debug.events.push({
      sequence: record.debug.eventCount,
      time: Date.now(),
      event: event.event.slice(0, 120),
      data: event.data.length > 2000 ? `${event.data.slice(0, 2000)}… [日志已截断]` : event.data,
    })
    trimEvents(record)
  }

  async function send(): Promise<boolean> {
    if (busy.value) return false
    const message = draft.value
    if (!message.trim()) { validationError.value = '请输入问题，不能只包含空白字符。'; return false }
    validationError.value = ''
    const requestMode = mode.value
    const id = ++sequence
    const controller = new AbortController()
    records[requestMode].push({
      id,
      question: message,
      answer: '',
      state: 'requesting',
      status: '请求中',
      debug: {
        path: MODES[requestMode].path,
        body: { message },
        startedAt: Date.now(),
        responseMode: 'unknown',
        events: [],
        eventCount: 0,
      },
    })
    // Read the reactive record, so stream updates are visible to components.
    const record = records[requestMode].at(-1)!
    active = { id, mode: requestMode, controller, record }
    selectedIds[requestMode] = id
    busy.value = true
    drafts[requestMode] = ''
    const isCurrent = () => active?.id === id && !controller.signal.aborted

    try {
      await sendRequest(requestMode, { message }, controller.signal, {
        onResponse: (metadata) => { if (isCurrent()) Object.assign(record.debug, metadata) },
        onStatus: (message) => { if (isCurrent()) record.status = message || '请求中' },
        onDelta: (text) => { if (isCurrent()) record.answer += text },
        onEvent: (event) => { if (isCurrent()) logEvent(record, event) },
      })
      if (isCurrent()) { record.state = 'complete'; record.status = '已完成' }
    } catch (error) {
      if (isCurrent()) {
        record.state = 'failed'
        record.status = '失败'
        record.error = errorMessage(error)
        record.debug.error = record.error
        if (error instanceof ChatApiError) record.debug.responsePreview = error.responsePreview
      }
    } finally {
      // A stopped request may settle after a new send or clear. It must not
      // overwrite the new request's busy state or its diagnostic timestamps.
      if (active?.id === id) {
        record.debug.endedAt = Date.now()
        active = undefined
        busy.value = false
      }
    }
    return true
  }

  function stop() {
    if (!active) return
    const previous = active
    previous.record.state = 'stopped'
    previous.record.status = '已停止接收'
    previous.record.debug.endedAt = Date.now()
    active = undefined
    busy.value = false
    previous.controller.abort()
  }

  function clear() {
    if (active?.mode === mode.value) stop()
    records[mode.value] = []
    selectedIds[mode.value] = undefined
    validationError.value = ''
  }

  function selectRecord(id: number) { selectedIds[mode.value] = id }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    mode, records, currentRecords, latestRecord, selectedRecord, draft,
    status, state, busy, validationError, logLimit, send, stop, clear, selectRecord,
  }
}
