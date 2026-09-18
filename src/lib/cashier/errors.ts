export class CashierError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409, readonly code: string, message: string) {
    super(message)
    this.name = 'CashierError'
  }
}

export function staleVersion(): never {
  throw new CashierError(409, 'STALE_VERSION', 'Dane zmieniły się w międzyczasie. Odśwież raport i potwierdź aktualne kwoty.')
}

export function requireReason(reason: string | null | undefined) {
  if (!reason || reason.trim().length < 3) {
    throw new CashierError(400, 'EXPLANATION_REQUIRED', 'Podaj wyjaśnienie różnicy lub brakującej kasy stałej (co najmniej 3 znaki).')
  }
}
