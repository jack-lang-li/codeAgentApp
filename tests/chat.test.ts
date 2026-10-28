import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkHealth, requestChat } from '../src/api/chat'
import { handlers, textStream } from './helpers'

afterEach(() => vi.unstubAllGlobals())

describe('chat HTTP transport', () => {
  it.each([['agent', '/api/chat/chat'], ['dify', '/api/chat/dify']] as const)('sends only message to %s and renders JSON once', async (mode, path) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answer: '完整回答\n  代码缩进' }), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } }))
    vi.stubGlobal('fetch', fetchMock)
    const hooks = handlers()
    const controller = new AbortController()
    await requestChat(mode, { message: '测试' }, controller.signal, hooks)
    expect(fetchMock).toHaveBeenCalledWith(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json, application/problem+json' },
      body: '{"message":"测试"}', signal: controller.signal,
    })
    expect(hooks.onResponse).toHaveBeenCalledWith({ httpStatus: 200, contentType: 'application/json;charset=UTF-8', responseMode: 'JSON' })
    expect(hooks.onDelta).toHaveBeenCalledExactlyOnceWith('完整回答\n  代码缩进')
    expect(hooks.onEvent).not.toHaveBeenCalled()
  })

  it('chooses SSE from Content-Type without calling response.text/json', async () => {
    const response = new Response(textStream('event: delta\ndata: {"text":"增量"}\n\nevent: done\ndata: {}\n\n'), { headers: { 'Content-Type': 'text/event-stream;charset=UTF-8' } })
    const textSpy = vi.spyOn(response, 'text')
    const jsonSpy = vi.spyOn(response, 'json')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const hooks = handlers()
    await requestChat('agent', { message: 'SSE' }, new AbortController().signal, hooks)
    expect(textSpy).not.toHaveBeenCalled()
    expect(jsonSpy).not.toHaveBeenCalled()
    expect(hooks.onDelta).toHaveBeenCalledWith('增量')
    expect(hooks.onResponse).toHaveBeenCalledWith(expect.objectContaining({ responseMode: 'SSE' }))
  })

  it('treats an HTTP 200 error event as failure without making it an assistant answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(textStream('event: error\ndata: {"message":"业务失败"}\n\n'), { headers: { 'Content-Type': 'text/event-stream' } })))
    const hooks = handlers()
    await expect(requestChat('agent', { message: 'x' }, new AbortController().signal, hooks)).rejects.toThrow('业务失败')
    expect(hooks.onDelta).not.toHaveBeenCalled()
  })

  it.each([
    ['{"detail":"参数错误","message":"次要信息"}', '参数错误'],
    ['{"message":"Dify 不可用"}', 'Dify 不可用'],
    ['普通错误文本', '普通错误文本'],
    ['', 'HTTP 502 Bad Gateway'],
  ])('prioritizes HTTP error details: %s', async (body, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'application/problem+json' } })))
    const hooks = handlers()
    await expect(requestChat('dify', { message: 'x' }, new AbortController().signal, hooks)).rejects.toThrow(expected)
    expect(hooks.onDelta).not.toHaveBeenCalled()
    expect(hooks.onResponse).toHaveBeenCalledWith(expect.objectContaining({ httpStatus: 502 }))
  })

  it('handles non-2xx before the successful SSE protocol branch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"HTTP 错误优先"}', { status: 400, headers: { 'Content-Type': 'text/event-stream' } })))
    await expect(requestChat('agent', { message: 'x' }, new AbortController().signal, handlers())).rejects.toThrow('HTTP 错误优先')
  })

  it.each(['{"data":{"outputs":{"answer":"不是前端协议"}}}', 'not-json', '{"answer":null}'])('rejects malformed successful JSON instead of silently rendering it', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } })))
    await expect(requestChat('agent', { message: 'x' }, new AbortController().signal, handlers())).rejects.toThrow('JSON 协议错误')
  })

  it('rejects an unknown Content-Type immediately even if the body never produces a byte', async () => {
    const body = new ReadableStream<Uint8Array>({})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/html' } })))
    await expect(requestChat('agent', { message: 'x' }, new AbortController().signal, handlers())).rejects.toThrow('不支持的 Content-Type「text/html」')
  })
})

describe('health check', () => {
  it('uses the relative actuator path and recognizes UP', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'UP' }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    await expect(checkHealth(signal)).resolves.toEqual({ status: 'UP', ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/actuator/health', { signal, headers: { Accept: 'application/json' } })
  })

  it('retains the DOWN health status even for HTTP 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'DOWN' }, { status: 503 })))
    await expect(checkHealth(new AbortController().signal)).resolves.toEqual({ status: 'DOWN', ok: false })
  })
})
