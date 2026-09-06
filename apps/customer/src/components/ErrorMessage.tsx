const FALLBACK = 'No pudimos conectar. Revisá tu conexión e intentá nuevamente.'

type ErrorMessageProps = {
  error: unknown
  retry: () => void
}

export function ErrorMessage({ error, retry }: ErrorMessageProps) {
  const message = error instanceof Error ? error.message : FALLBACK

  return (
    <div className="notice" role="alert">
      <p>{message}</p>
      <button onClick={retry}>Reintentar</button>
    </div>
  )
}
