import { describe, expect, it } from 'vitest'
import { createSseParser } from '../src/utils/sse'
import { consumeSse } from '../src/api/chat'
import type { SseEvent } from '../src/types/chat'
import { byteStream, handlers, textStream } from './helpers'

describe('incremental SSE framing', () => {
  it('joins an event split across multiple network chunks', () => {
    const events: SseEvent[] = []
    const parser = createSseParser((event) => events.push(event))
    parser.push('eve')
    parser.push('nt: delta\nda')
    parser.push('ta: {"text":"Java"}\n')
    expect(events).toHaveLength(0)
    parser.push('\n')
    expect(events).toEqual([{ event: 'delta', data: '{"text":"Java"}', id: undefined }])
  })

  it('dispatches several events in one chunk and retains unknown events', () => {
    const events: SseEvent[] = []
    const parser = createSseParser((event) => events.push(event))
    parser.push('event: delta\ndata: {"text":"A"}\n\nevent: custom\ndata: opaque\n\nevent: done\ndata: {}\n\n')
    expect(events.map((event) => event.event)).toEqual(['delta', 'custom', 'done'])
  })

  it('handles LF, CRLF split between chunks, lone CR and comment heartbeats', () => {
    const events: SseEvent[] = []
    const parser = createSseParser((event) => events.push(event))
    parser.push('\uFEFF: heartbeat\r')
    parser.push('\nevent: delta\r')
    parser.push('\ndata: {"text":"A"}\r\n\r')
    parser.push('\n: another heartbeat\n\nevent: done\rdata: {}\r\r')
    expect(events.map((event) => event.event)).toEqual(['delta', 'done'])
  })

  it('joins multiple data fields with newlines and removes only one leading space', () => {
    const events: SseEvent[] = []
    const parser = createSseParser((event) => events.push(event))
    parser.push('event: status\ndata: {\ndata:   "message": "处理中"\ndata: }\n\n')
    expect(events[0]?.data).toBe('{\n  "message": "处理中"\n}')
  })

  it('ignores empty events and discards incomplete last frames at EOF', () => {
    const events: SseEvent[] = []
    const parser = createSseParser((event) => events.push(event))
    parser.push(': ping\n\nevent: done\ndata: {}\n')
    parser.end()
    expect(events).toHaveLength(0)
  })

  it('resets event names between frames and recognizes data with no colon', () => {
    const events: SseEvent[] = []
    const parser = createSseParser((event) => events.push(event))
    parser.push('event: custom\ndata: first\n\ndata\n\n')
    expect(events.map((event) => [event.event, event.data])).toEqual([['custom', 'first'], ['message', '']])
  })
})

describe('SSE stream lifecycle', () => {
  it('decodes Chinese UTF-8 split at every byte, preserves whitespace, and completes only on done', async () => {
    const hooks = handlers()
    const data = new TextEncoder().encode('event: status\ndata: {"message":"正在请求模型，第 1 轮"}\n\nevent: delta\ndata: {"text":"中文接口\\n  Java"}\n\nevent: done\ndata: {}\n\n')
    await consumeSse(byteStream(Array.from(data, (byte) => Uint8Array.of(byte))), new AbortController().signal, hooks)
    expect(hooks.onStatus).toHaveBeenCalledWith('正在请求模型，第 1 轮')
    expect(hooks.onDelta).toHaveBeenCalledExactlyOnceWith('中文接口\n  Java')
  })

  it('updates the answer before the connection is closed; done need not wait for EOF', async () => {
    const hooks = handlers()
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller } })
    const task = consumeSse(body, new AbortController().signal, hooks)
    streamController.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"first"}\n\n'))
    await Promise.resolve()
    expect(hooks.onDelta).toHaveBeenCalledWith('first')
    streamController.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'))
    await task
  })

  it('supports multi-line JSON data', async () => {
    const hooks = handlers()
    await consumeSse(textStream('event: delta\ndata: {\ndata: "text": "多行"\ndata: }\n\nevent: done\ndata: {}\n\n'), new AbortController().signal, hooks)
    expect(hooks.onDelta).toHaveBeenCalledWith('多行')
  })

  it('reports an error event after partial text, even on an otherwise successful HTTP stream', async () => {
    const hooks = handlers()
    await expect(consumeSse(textStream('event: delta\ndata: {"text":"保留正文"}\n\nevent: error\ndata: {"message":"本次生成失败"}\n\nevent: delta\ndata: {"text":"不应追加"}\n\n'), new AbortController().signal, hooks)).rejects.toThrow('本次生成失败')
    expect(hooks.onDelta).toHaveBeenCalledExactlyOnceWith('保留正文')
  })

  it.each(['', 'event: delta\ndata: {"text":"部分正文"}\n\n', 'event: done\ndata: {}\n'])('rejects EOF without a dispatched done or error (%s)', async (content) => {
    await expect(consumeSse(textStream(content), new AbortController().signal, handlers())).rejects.toThrow('连接中断，未收到完成事件')
  })

  it('reports an interrupted reader with the explicit incomplete connection error', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('socket reset')) } })
    await expect(consumeSse(body, new AbortController().signal, handlers())).rejects.toThrow('连接中断，未收到完成事件')
  })

  it('logs unknown events without appending their data to the answer', async () => {
    const hooks = handlers()
    await consumeSse(textStream('event: tool\ndata: not-json\n\nevent: done\ndata: {}\n\n'), new AbortController().signal, hooks)
    expect(hooks.onEvent).toHaveBeenCalledTimes(2)
    expect(hooks.onDelta).not.toHaveBeenCalled()
  })

  it.each([
    'event: delta\ndata: not-json\n\n',
    'event: delta\ndata: {"text":42}\n\n',
    'event: status\ndata: {}\n\n',
  ])('rejects malformed known events', async (content) => {
    await expect(consumeSse(textStream(content), new AbortController().signal, handlers())).rejects.toThrow('SSE 协议错误')
  })

  it('handles a pending read cancellation and releases the reader lock', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({})
    const task = consumeSse(body, controller.signal, handlers())
    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(body.locked).toBe(false)
  })

  it('checks cancellation even before the first read', async () => {
    const controller = new AbortController()
    controller.abort()
    const body = textStream('event: done\ndata: {}\n\n')
    await expect(consumeSse(body, controller.signal, handlers())).rejects.toMatchObject({ name: 'AbortError' })
    expect(body.locked).toBe(false)
  })
})
