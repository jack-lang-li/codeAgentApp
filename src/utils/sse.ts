import type { SseEvent } from '../types/chat'

/** Incremental SSE framing. A network chunk is never assumed to be one event. */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let line = ''
  let skipLf = false
  let firstCharacter = true
  let eventName = ''
  let dataLines: string[] = []
  let eventId: string | undefined

  function consumeLine(value: string) {
    if (value === '') {
      if (dataLines.length > 0) {
        onEvent({ event: eventName || 'message', data: dataLines.join('\n'), id: eventId })
      }
      eventName = ''
      dataLines = []
      return
    }
    if (value.startsWith(':')) return // comment / heartbeat
    const colon = value.indexOf(':')
    const field = colon < 0 ? value : value.slice(0, colon)
    let content = colon < 0 ? '' : value.slice(colon + 1)
    if (content.startsWith(' ')) content = content.slice(1)
    if (field === 'event') eventName = content
    if (field === 'data') dataLines.push(content)
    if (field === 'id' && !content.includes('\0')) eventId = content
    // retry and unrecognized fields do not change the application protocol.
  }

  return {
    push(chunk: string) {
      for (const character of chunk) {
        if (firstCharacter) {
          firstCharacter = false
          if (character === '\uFEFF') continue
        }
        if (skipLf) {
          skipLf = false
          if (character === '\n') continue
        }
        if (character === '\r' || character === '\n') {
          const completedLine = line
          line = ''
          skipLf = character === '\r'
          consumeLine(completedLine)
        } else {
          line += character
        }
      }
    },
    end() {
      // SSE dispatches only at a blank line. Never turn a truncated last frame
      // (including an unfinished done frame) into a successful completion.
      line = ''
      dataLines = []
      eventName = ''
    },
  }
}
