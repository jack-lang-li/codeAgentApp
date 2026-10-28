import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useChat } from '../src/composables/useChat'
import { ChatApiError, requestChat } from '../src/api/chat'
import { deferred } from './helpers'

afterEach(() => vi.restoreAllMocks())

describe('chat state and cancellation', () => {
  it('rejects blank input before making any HTTP request', async () => {
    const transport = vi.fn<typeof requestChat>()
    const chat = useChat(transport)
    chat.draft.value = ' \n\t '
    await expect(chat.send()).resolves.toBe(false)
    expect(transport).not.toHaveBeenCalled()
    expect(chat.currentRecords.value).toHaveLength(0)
    expect(chat.validationError.value).toContain('不能只包含空白')
  })

  it('keeps status events separate from body and marks done success', async () => {
    const task = deferred()
    const transport = vi.fn<typeof requestChat>((_mode, _body, _signal, hooks) => {
      hooks.onStatus('正在请求模型，第 1 轮')
      hooks.onDelta('正文\n  保留缩进')
      return task.promise
    })
    const chat = useChat(transport)
    chat.draft.value = '问题'
    const sending = chat.send()
    expect(chat.status.value).toBe('正在请求模型，第 1 轮')
    expect(chat.latestRecord.value?.answer).toBe('正文\n  保留缩进')
    task.resolve()
    await sending
    expect(chat.state.value).toBe('complete')
    expect(chat.status.value).toBe('已完成')
    expect(chat.busy.value).toBe(false)
    expect(chat.latestRecord.value?.debug.endedAt).toBeTypeOf('number')
  })

  it('retains partial text on failure and keeps the error outside the answer', async () => {
    const chat = useChat(async (_mode, _body, _signal, hooks) => {
      hooks.onDelta('部分正文')
      throw new ChatApiError('连接中断，未收到完成事件', '诊断信息')
    })
    chat.draft.value = '问题'
    await chat.send()
    expect(chat.latestRecord.value).toMatchObject({ answer: '部分正文', state: 'failed', status: '失败', error: '连接中断，未收到完成事件' })
    expect(chat.latestRecord.value?.debug.responsePreview).toBe('诊断信息')
  })

  it('stop preserves partial body and an old finally cannot unlock or overwrite a new request', async () => {
    const oldTask = deferred()
    const newTask = deferred()
    const transport = vi.fn<typeof requestChat>()
      .mockImplementationOnce((_mode, _body, _signal, hooks) => { hooks.onDelta('旧正文'); return oldTask.promise })
      .mockImplementationOnce((_mode, _body, _signal, hooks) => { hooks.onDelta('新正文'); return newTask.promise })
    const chat = useChat(transport)
    chat.draft.value = '旧问题'
    const oldSending = chat.send()
    chat.stop()
    expect(transport.mock.calls[0]?.[2].aborted).toBe(true)
    expect(chat.currentRecords.value[0]).toMatchObject({ state: 'stopped', answer: '旧正文', status: '已停止接收' })
    chat.draft.value = '新问题'
    const newSending = chat.send()
    transport.mock.calls[0]?.[3].onDelta('迟到的文本')
    transport.mock.calls[0]?.[3].onStatus('迟到的状态')
    oldTask.reject(new DOMException('aborted', 'AbortError'))
    await oldSending
    expect(chat.busy.value).toBe(true)
    expect(chat.latestRecord.value).toMatchObject({ state: 'requesting', answer: '新正文', status: '请求中' })
    expect(chat.currentRecords.value[0]?.answer).toBe('旧正文')
    expect(chat.latestRecord.value?.debug.endedAt).toBeUndefined()
    newTask.resolve()
    await newSending
    expect(chat.state.value).toBe('complete')
    expect(chat.busy.value).toBe(false)
  })

  it('blocks duplicate sends and keeps modes independent when clearing', async () => {
    const task = deferred()
    const transport = vi.fn<typeof requestChat>().mockReturnValueOnce(task.promise).mockResolvedValue(undefined)
    const chat = useChat(transport)
    chat.draft.value = 'Agent 问题'
    const sending = chat.send()
    chat.draft.value = '重复请求'
    await expect(chat.send()).resolves.toBe(false)
    expect(transport).toHaveBeenCalledTimes(1)
    task.resolve()
    await sending
    chat.mode.value = 'dify'
    chat.draft.value = 'Dify 问题'
    await chat.send()
    chat.clear()
    expect(chat.records.dify).toHaveLength(0)
    expect(chat.records.agent).toHaveLength(1)
  })

  it('clearing an active request cancels it and late completion cannot restore records', async () => {
    const task = deferred()
    const chat = useChat(() => task.promise)
    chat.draft.value = '问题'
    const sending = chat.send()
    chat.clear()
    task.resolve()
    await sending
    expect(chat.currentRecords.value).toHaveLength(0)
    expect(chat.selectedRecord.value).toBeUndefined()
    expect(chat.status.value).toBe('待发送')
    expect(chat.busy.value).toBe(false)
  })

  it('bounds diagnostic logs without losing any answer text', async () => {
    const chat = useChat(async (_mode, _body, _signal, hooks) => {
      for (let index = 0; index < 300; index++) {
        hooks.onEvent({ event: 'delta', data: '{"text":"字"}' })
        hooks.onDelta('字')
      }
    })
    chat.logLimit.value = 50
    chat.draft.value = '问题'
    await chat.send()
    expect(chat.latestRecord.value?.answer).toBe('字'.repeat(300))
    expect(chat.latestRecord.value?.debug.events).toHaveLength(50)
    expect(chat.latestRecord.value?.debug.eventCount).toBe(300)
    expect(chat.latestRecord.value?.debug.events[0]?.sequence).toBe(251)
  })

  it('applies a reduced log limit to existing records', async () => {
    const scope = effectScope()
    const chat = scope.run(() => useChat(async (_mode, _body, _signal, hooks) => {
      for (let index = 0; index < 150; index++) hooks.onEvent({ event: 'delta', data: '{}' })
    }))!
    chat.logLimit.value = 200
    chat.draft.value = '问题'
    await chat.send()
    expect(chat.latestRecord.value?.debug.events).toHaveLength(150)
    chat.logLimit.value = 50
    await nextTick()
    expect(chat.latestRecord.value?.debug.events).toHaveLength(50)
    scope.stop()
  })
})
