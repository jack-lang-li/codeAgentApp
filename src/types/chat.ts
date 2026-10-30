export type ChatMode = 'agent' | 'dify'
export type RequestState = 'idle' | 'requesting' | 'complete' | 'stopped' | 'failed'
export type ResponseMode = 'JSON' | 'SSE' | 'unknown'

export const MODES = {
  agent: { label: '自建 Agent', path: '/api/chat/chat', description: '模型调用 · 工具执行 · Agent 循环', short: 'AG' },
  dify: { label: 'Dify Workflow', path: '/api/chat/dify', description: '已发布的 Dify 工作流', short: 'DF' },
} as const

export interface ChatRequest { message: string }
export interface SseEvent { event: string; data: string; id?: string }
export interface ResponseMetadata {
  httpStatus: number
  contentType: string
  responseMode: ResponseMode
}
export interface DebugEvent { sequence: number; time: number; event: string; data: string }
export interface DebugInfo {
  path: string
  body: ChatRequest
  startedAt: number
  endedAt?: number
  httpStatus?: number
  contentType?: string
  responseMode: ResponseMode
  events: DebugEvent[]
  eventCount: number
  error?: string
  errorCode?: string
  responsePreview?: string
}
export interface ChatRecord {
  id: number
  question: string
  answer: string
  state: RequestState
  status: string
  error?: string
  debug: DebugInfo
}
export interface ChatHandlers {
  onResponse: (metadata: ResponseMetadata) => void
  onStatus: (message: string) => void
  onDelta: (text: string) => void
  onEvent: (event: SseEvent) => void
}
