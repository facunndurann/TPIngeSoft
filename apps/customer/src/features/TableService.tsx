import { useMutation } from '@tanstack/react-query'
import type { Announce } from '@/features/announcements'
import { AGE_TICK_MS, relativeAge } from '@/features/freshness'
import {
  TABLE_SERVICE_KINDS,
  type TableServiceKind,
  requestTableService,
  tableServiceCopy,
  tableServiceRequestedAt,
} from '@/features/table-service'
import { useNow } from '@/hooks/useNow'
import type { loadSession } from '@/features/session'

type Session = Awaited<ReturnType<typeof loadSession>>

type TableServiceProps = {
  sessionId?: string
  session?: Session
  onAnnounce: Announce
  onDone: () => void
}

/**
 * La salida hacia una persona. Está en todas las pantallas de la mesa porque es
 * lo que el comensal busca cuando algo no sale como esperaba, y cada aviso se
 * puede cancelar mientras el mozo no haya llegado.
 */
export function TableService({ sessionId, session, onAnnounce, onDone }: TableServiceProps) {
  const now = useNow(AGE_TICK_MS)

  const send = useMutation({
    mutationFn: ({ kind, requested }: { kind: TableServiceKind; requested: boolean }) =>
      requestTableService(sessionId!, kind, requested),
    onSuccess: (_result, { kind, requested }) => {
      const copy = tableServiceCopy[kind]
      onAnnounce(requested ? copy.sent : copy.cancelled)
      onDone()
    },
  })

  // Sin mesa conectada no hay a quién avisarle; el panel de la mesa ya explica por qué.
  if (!sessionId || session?.status !== 'open') return null

  return (
    <section className="service-panel" aria-label="Ayuda del restaurante">
      <h2>¿Necesitás algo?</h2>
      <p className="muted">
        El aviso llega al salón con el número de tu mesa. Podés cancelarlo si ya no lo necesitás.
      </p>

      {send.isError && (
        <p className="notice" role="alert">
          {send.error instanceof Error
            ? send.error.message
            : 'No pudimos avisar al salón. Intentá nuevamente.'}
        </p>
      )}

      <div className="service-actions">
        {TABLE_SERVICE_KINDS.map((kind) => {
          const copy = tableServiceCopy[kind]
          const requestedAt = tableServiceRequestedAt(session, kind)
          // Un aviso por tipo: mientras está pendiente, el botón lo cancela.
          const pending = requestedAt !== undefined
          const busy = send.isPending && send.variables?.kind === kind

          return (
            <div key={kind} className="service-request">
              <button
                className={pending ? '' : 'primary'}
                disabled={send.isPending}
                onClick={() => send.mutate({ kind, requested: !pending })}
              >
                {busy ? 'Avisando…' : pending ? 'Cancelar aviso' : copy.request}
              </button>
              {pending && (
                <p className="muted" role="status">
                  {copy.waiting} {relativeAge(Date.parse(requestedAt), now)}.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
