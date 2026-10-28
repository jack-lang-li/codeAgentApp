import type { ChatHandlers, ChatMode, ChatRequest, ResponseMode, SseEvent } from '../types/chat'
import { MODES } from '../types/chat'
import { createSseParser } from '../utils/sse'

export class ChatApiError extends Error {
  constructor(message: string, public readonly responsePreview?: string) {
    super(message)
    this.name = 'ChatApiError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function responseMode(contentType: string): ResponseMode {
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase()
  if (mediaType === 'text/event-stream') return 'SSE'
  if (mediaType === 'application/json') return 'JSON'
  return 'unknown'
}

/** Error responses are handled before choosing a successful JSON/SSE branch. */
export async function readHttpError(response: Response): Promise<ChatApiError> {
  const body = await response.text()
  let message = ''
  try {
    const parsed: unknown = JSON.parse(body)
    if (isObject(parsed)) {
      if (nonBlank(parsed.detail)) message = parsed.detail
      else if (nonBlank(parsed.message)) message = parsed.message
    }
  } catch { /* non-JSON error: show the ordinary text below */ }
  message ||= body.trim() || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  return new ChatApiError(message, body.slice(0, 8000))
}

function parseEventData(event: SseEvent): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(event.data)
    if (!isObject(value)) throw new Error('expected object')
    return value
  } catch {
    throw new ChatApiError(`SSE 协议错误：${event.event} 事件的 data 必须是合法 JSON 对象`, event.data.slice(0, 8000))
  }
}

export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  handlers: ChatHandlers,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let terminal: 'done' | 'error' | undefined
  let businessError: ChatApiError | undefined

  const parser = createSseParser((event) => {
    // A terminal event wins even when extra events share its network chunk.
    if (terminal || signal.aborted) return
    handlers.onEvent(event)
    if (!['status', 'delta', 'done', 'error'].includes(event.event)) return
    const data = parseEventData(event)
    switch (event.event) {
      case 'status':
        if (typeof data.message !== 'string') throw new ChatApiError('SSE 协议错误：status 缺少字符串 message')
        handlers.onStatus(data.message)
        break
      case 'delta':
        if (typeof data.text !== 'string') throw new ChatApiError('SSE 协议错误：delta 缺少字符串 text')
        handlers.onDelta(data.text)
        break
      case 'done':
        terminal = 'done'
        break
      case 'error':
        terminal = 'error'
        businessError = new ChatApiError(nonBlank(data.message) ? data.message : '本次生成失败，请稍后重试', event.data.slice(0, 8000))
        break
    }
  })

  // Also make cancellation work for a pending read, including injected streams.
  const abortRead = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', abortRead, { once: true })
  try {
    signal.throwIfAborted()
    while (!terminal) {
      signal.throwIfAborted()
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (error) {
        signal.throwIfAborted()
        throw new ChatApiError('连接中断，未收到完成事件', errorMessage(error))
      }
      signal.throwIfAborted()
      if (chunk.done) {
        parser.push(decoder.decode()) // flush UTF-8 decoder at EOF
        parser.end()
        break
      }
      parser.push(decoder.decode(chunk.value, { stream: true }))
    }
    signal.throwIfAborted()
    if (businessError) throw businessError
    if (terminal !== 'done') throw new ChatApiError('连接中断，未收到完成事件')
  } finally {
    signal.removeEventListener('abort', abortRead)
    // done/error end this POST. Do not wait for the server to close its socket.
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function requestChat(
  mode: ChatMode,
  request: ChatRequest,
  signal: AbortSignal,
  handlers: ChatHandlers,
): Promise<void> {
  const response = await fetch(MODES[mode].path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json, application/problem+json',
    },
    body: JSON.stringify(request),
    signal,
  })
  signal.throwIfAborted()
  const contentType = response.headers.get('Content-Type') || ''
  const modeReceived = responseMode(contentType)
  handlers.onResponse({ httpStatus: response.status, contentType, responseMode: modeReceived })
  if (!response.ok) throw await readHttpError(response)

  if (modeReceived === 'JSON') {
    const raw = await response.text()
    signal.throwIfAborted()
    let value: unknown
    try { value = JSON.parse(raw) } catch {
      throw new ChatApiError('JSON 协议错误：响应不是合法 JSON', raw.slice(0, 8000))
    }
    if (!isObject(value) || typeof value.answer !== 'string') {
      throw new ChatApiError('JSON 协议错误：响应缺少字符串 answer', raw.slice(0, 8000))
    }
    handlers.onDelta(value.answer)
    return
  }
  if (modeReceived === 'SSE') {
    if (!response.body) throw new ChatApiError('SSE 协议错误：响应流为空')
    await consumeSse(response.body, signal, handlers)
    return
  }
  // Metadata is already retained. Fail immediately even if this invalid body
  // is a never-ending stream; waiting for its first byte could hang forever.
  if (response.body) void response.body.cancel().catch(() => undefined)
  throw new ChatApiError(`协议错误：不支持的 Content-Type「${contentType || '未提供'}」`)
}

export async function checkHealth(signal: AbortSignal): Promise<{ status: string; ok: boolean }> {
  const response = await fetch('/actuator/health', { signal, headers: { Accept: 'application/json' } })
  // Actuator can legitimately report DOWN with HTTP 503: it is still reachable.
  if (!response.ok) {
    try {
      const health: unknown = await response.clone().json()
      if (isObject(health) && nonBlank(health.status)) return { status: health.status, ok: false }
    } catch { /* fall through to the normal HTTP error details */ }
  }
  if (!response.ok) throw await readHttpError(response)
  const value: unknown = await response.json()
  if (!isObject(value) || !nonBlank(value.status)) throw new ChatApiError('后端可达，但健康检查响应缺少 status')
  return { status: value.status, ok: value.status.toUpperCase() === 'UP' }
}
