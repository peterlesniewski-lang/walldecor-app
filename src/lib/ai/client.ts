import { z } from 'zod'
import { aiChatResultSchema, aiJobStatusSchema } from '@/lib/ai/contracts'

const questionSchema = z.string().trim().min(1).max(500)
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FINANCE_CHAT'), question: questionSchema, year: z.number().int().min(2020).max(2100), month: z.number().int().min(1).max(12), requestId: z.uuid().optional() }),
  z.object({ kind: z.literal('WIKI_CHAT'), question: questionSchema, articleTitle: z.string().optional(), articleCategory: z.string().optional(), articleContent: z.string().transform((value) => value.slice(0, 3000)).optional(), requestId: z.uuid().optional() }),
])
export type AiChatRequest = z.input<typeof requestSchema>

const jobSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,191}$/),
  kind: z.enum(['FINANCE_CHAT', 'WIKI_CHAT']),
  status: aiJobStatusSchema,
  result: aiChatResultSchema.nullable(),
  errorCode: z.string().max(200).nullable(),
  blockedReason: z.string().max(2000).nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).refine((job) => job.status !== 'SUCCEEDED' || job.result !== null)
const responseSchema = z.object({ job: jobSchema })
type ChatJob = z.infer<typeof jobSchema>

export interface AiChatClientState {
  job: ChatJob | null
  requestId: string | null
  busy: boolean
  canSubmit: boolean
  message: string | null
  action: 'resume' | 'recover' | 'retry' | null
}
export const AI_CHAT_INITIAL_STATE: AiChatClientState = {
  job: null, requestId: null, busy: false, canSubmit: true, message: null, action: null,
}
export interface AiChatClient {
  getState(): AiChatClientState
  submit(request: AiChatRequest): boolean
  resume(): boolean
  retry(): boolean
  dispose(): void
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH: 'AI wymaga ponownego połączenia konta. Po przywróceniu dostępu możesz ponowić zadanie.',
  QUOTA: 'Osiągnięto limit AI. Poczekaj na jego odnowienie, a potem ponów zadanie.',
  MODEL_UNAVAILABLE: 'Wybrany model AI jest niedostępny. Ponów zadanie po przywróceniu dostępności.',
  TIMEOUT: 'Przekroczono czas oczekiwania na AI. Możesz ponowić zadanie.',
  RUNNER_ERROR: 'Nie udało się przygotować odpowiedzi. Możesz ponowić zadanie.',
  INVALID_RESULT: 'AI nie zwróciło poprawnej odpowiedzi. Możesz ponowić zadanie.',
  LEASE_EXPIRED: 'Przetwarzanie zostało przerwane. Możesz ponowić zadanie.',
  ACCESS_REVOKED: 'Nie masz dostępu do tego zadania lub jego danych.',
  PAYLOAD_INVALID: 'Dane pytania są niepoprawne. Sprawdź pytanie i wybrany kontekst.',
}
const RETRYABLE_CODES = new Set(['AUTH', 'QUOTA', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'RUNNER_ERROR', 'INVALID_RESULT', 'LEASE_EXPIRED'])
const QUEUE_PAUSE_MESSAGES: Record<string, string> = {
  AUTH: 'AI wymaga ponownego połączenia konta. Po przywróceniu dostępu ponów zadanie.',
  QUOTA: 'Osiągnięto limit AI. Po odnowieniu limitu ponów zadanie.',
  MODEL_UNAVAILABLE: 'Wybrany model AI jest niedostępny. Po przywróceniu dostępności ponów zadanie.',
}
const HTTP_TIMEOUT_MS = 15_000
const POLL_LIMIT_MS = 120_000

function errorMessage(code: string | null) {
  return code && Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : 'Zadanie jest chwilowo niedostępne. Sprawdź ponownie później.'
}

class RequestFailure extends Error {
  constructor(readonly code: string, readonly httpStatus?: number) { super(code) }
}

/** Parse only controlled codes. Raw server error text is never returned to a chat panel. */
function httpErrorCode(body: unknown, status: number) {
  const parsed = z.object({ code: z.string().optional(), errorCode: z.string().optional() }).safeParse(body)
  const code = parsed.success ? parsed.data.errorCode ?? parsed.data.code : undefined
  if (code && Object.hasOwn(ERROR_MESSAGES, code)) return code
  return status === 401 ? 'AUTH' : status === 403 ? 'ACCESS_REVOKED' : status === 400 ? 'PAYLOAD_INVALID' : status === 429 ? 'QUOTA' : 'RUNNER_ERROR'
}

async function requestJob(url: string, method: 'GET' | 'POST', body: string | undefined, signal: AbortSignal): Promise<ChatJob> {
  const requestAbort = new AbortController()
  const timeout = setTimeout(() => requestAbort.abort(), HTTP_TIMEOUT_MS)
  const abort = () => { clearTimeout(timeout); requestAbort.abort() }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    const response = await fetch(url, {
      method, body, signal: requestAbort.signal, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new RequestFailure(httpErrorCode(data, response.status), response.status)
    const parsed = responseSchema.safeParse(data)
    if (!parsed.success) throw new RequestFailure('INVALID_RESULT')
    return parsed.data.job
  } catch (error) {
    if (error instanceof RequestFailure) throw error
    throw new RequestFailure(requestAbort.signal.aborted ? 'TIMEOUT' : 'NETWORK')
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

function waitForPoll(milliseconds: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    const finish = (continuePolling: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve(continuePolling)
    }
    const abort = () => finish(false)
    const timer = setTimeout(() => finish(true), milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Browser-only controller. GET polling is bounded; every POST requires an explicit user action. */
export function createAiChatClient(callbacks: { onState: (state: AiChatClientState) => void; onAnswer: (answer: string) => void }): AiChatClient {
  let state = { ...AI_CHAT_INITIAL_STATE }
  let submission: { url: string; body: string; kind: ChatJob['kind'] } | null = null
  let activeRequest: AbortController | null = null
  let generation = 0
  let disposed = false
  const delivered = new Set<string>()

  function publish(next: AiChatClientState) {
    if (disposed) return
    state = next
    callbacks.onState(state)
  }

  function acceptJob(job: ChatJob): boolean {
    if (job.status === 'SUCCEEDED' && job.result) {
      publish({ ...state, job, busy: false, canSubmit: true, message: null, action: null })
      if (!delivered.has(job.id)) { delivered.add(job.id); callbacks.onAnswer(job.result.answer) }
      return false
    }
    if (job.status === 'CANCELLED') {
      publish({ ...state, job, busy: false, canSubmit: true, message: 'Zadanie zostało anulowane.', action: null })
      return false
    }
    if (job.status === 'FAILED' || job.status === 'BLOCKED') {
      const code = job.errorCode ?? job.blockedReason
      publish({ ...state, job, busy: false, canSubmit: true, message: errorMessage(code), action: code && RETRYABLE_CODES.has(code) ? 'retry' : null })
      return false
    }
    if (job.status === 'QUEUED' && job.blockedReason) {
      const explanation = Object.hasOwn(QUEUE_PAUSE_MESSAGES, job.blockedReason)
        ? QUEUE_PAUSE_MESSAGES[job.blockedReason] : 'Po przywróceniu dostępu ponów zadanie.'
      publish({ ...state, job, busy: false, canSubmit: false, message: `Kolejka jest wstrzymana. ${explanation}`, action: 'retry' })
      return false
    }
    publish({ ...state, job, busy: true, canSubmit: false, message: job.status === 'QUEUED' ? 'W kolejce' : 'Przygotowuję odpowiedź', action: null })
    return true
  }

  function begin(mode: 'submit' | 'resume' | 'retry') {
    if (!submission) return
    activeRequest?.abort()
    const controller = new AbortController()
    activeRequest = controller
    const ticket = ++generation
    const savedSubmission = submission
    const expectedId = state.job?.id
    publish({ ...state, busy: true, canSubmit: false, action: null, message: mode === 'submit' ? 'Wysyłam pytanie' : 'Sprawdzam zadanie' })
    const current = () => !disposed && generation === ticket && !controller.signal.aborted

    void (async () => {
      try {
        const initialUrl = mode === 'submit' ? savedSubmission.url : `/api/ai/jobs/${expectedId}${mode === 'retry' ? '/retry' : ''}`
        let job = await requestJob(initialUrl, mode === 'resume' ? 'GET' : 'POST', mode === 'submit' ? savedSubmission.body : undefined, controller.signal)
        const startedAt = Date.now()
        let polls = 0
        while (current()) {
          if (job.kind !== savedSubmission.kind || (expectedId && job.id !== expectedId) || (state.job && job.id !== state.job.id)) throw new RequestFailure('INVALID_RESULT')
          if (!acceptJob(job)) return
          const delay = Math.min(2000 + polls * 1000, 5000)
          if (Date.now() - startedAt + delay > POLL_LIMIT_MS) {
            publish({ ...state, busy: false, canSubmit: false, message: 'Zadanie nadal trwa. Możesz sprawdzić wynik później.', action: 'resume' })
            return
          }
          if (!await waitForPoll(delay, controller.signal) || !current()) return
          job = await requestJob(`/api/ai/jobs/${job.id}`, 'GET', undefined, controller.signal)
          polls += 1
        }
      } catch (error) {
        if (!current()) return
        const failure = error instanceof RequestFailure ? error : new RequestFailure('NETWORK')
        const rejected = failure.code === 'ACCESS_REVOKED' || failure.code === 'PAYLOAD_INVALID'
          || (!state.job && failure.httpStatus != null && failure.httpStatus >= 400 && failure.httpStatus < 500)
        const message = failure.httpStatus === 401 ? 'Sesja wygasła. Zaloguj się ponownie, aby kontynuować.'
          : rejected ? errorMessage(failure.code)
            : state.job ? 'Nie udało się potwierdzić wyniku. Zadanie może nadal trwać — sprawdź je ponownie.'
              : 'Nie udało się potwierdzić przyjęcia pytania. Zadanie mogło powstać — odzyskaj je, zachowując to samo pytanie.'
        publish({ ...state, busy: false, canSubmit: rejected, message, action: rejected ? null : state.job ? 'resume' : 'recover' })
      }
    })()
  }

  return {
    getState: () => state,
    submit(request) {
      if (disposed || state.busy || !state.canSubmit) return false
      const parsed = requestSchema.safeParse(request)
      if (!parsed.success) {
        publish({ ...state, message: 'Wpisz pytanie od 1 do 500 znaków i wybierz poprawny okres lub artykuł.', action: null })
        return false
      }
      const { kind, requestId: providedId, ...payload } = parsed.data
      const requestId = providedId ?? crypto.randomUUID()
      submission = { kind, url: kind === 'FINANCE_CHAT' ? '/api/ai/chat' : '/api/knowledge/ai', body: JSON.stringify({ ...payload, requestId }) }
      state = { ...AI_CHAT_INITIAL_STATE, requestId }
      begin('submit')
      return true
    },
    resume() {
      if (disposed || state.busy || (state.action !== 'resume' && state.action !== 'recover')) return false
      begin(state.job ? 'resume' : 'submit')
      return true
    },
    retry() {
      if (disposed || state.busy || state.action !== 'retry' || !state.job) return false
      begin('retry')
      return true
    },
    dispose() {
      disposed = true
      generation += 1
      activeRequest?.abort()
    },
  }
}
