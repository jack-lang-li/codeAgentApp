import { vi } from 'vitest'
import type { ChatHandlers } from '../src/types/chat'

export function handlers(): ChatHandlers {
  return { onResponse: vi.fn(), onStatus: vi.fn(), onDelta: vi.fn(), onEvent: vi.fn() }
}

export function byteStream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close() } })
}

export function textStream(...chunks: string[]) {
  return byteStream(chunks.map((chunk) => new TextEncoder().encode(chunk)))
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
