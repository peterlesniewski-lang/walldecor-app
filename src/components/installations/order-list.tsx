import Link from 'next/link'
import { ArrowRight, ClipboardList, Plus } from 'lucide-react'

type OrderListItem = {
  id: string
  number: string
  status: string
  addressCity: string
  addressStreet: string
  client: { name: string }
  primaryEmployee: { firstName: string; lastName: string }
  backupEmployee: { firstName: string; lastName: string }
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Szkic',
  AWAITING_CLIENT: 'Czekamy na klienta',
  READY_TO_PLAN: 'Gotowe do planowania',
  SCHEDULED: 'Zaplanowane',
  IN_PROGRESS: 'W realizacji',
  ON_HOLD: 'Wstrzymane',
  CLOSED: 'Zamknięte',
}

export function InstallationOrderList({ orders }: { orders: OrderListItem[] }) {
  return (
    <section className="mx-auto max-w-6xl" aria-labelledby="installation-orders-heading">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="data-label">Montaże</p>
          <h1 id="installation-orders-heading" className="mt-1 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--wd-dark)' }}>
            Karty montaży
          </h1>
          <p className="mt-2 max-w-xl text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Klient, adres i odpowiedzialność w jednym miejscu — bez skrótów i bez zgadywania.
          </p>
        </div>
        <Link
          href="/installations/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: '#A96A20', color: '#fff', boxShadow: '0 4px 10px rgba(90, 59, 22, 0.16)' }}
        >
          <Plus className="h-4 w-4" />
          Nowa karta
        </Link>
      </div>

      {orders.length === 0 ? (
        <div
          className="rounded-2xl border px-6 py-12 text-center"
          style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}
        >
          <ClipboardList className="mx-auto h-7 w-7" style={{ color: '#A96A20' }} />
          <h2 className="mt-4 text-lg font-bold" style={{ color: 'var(--wd-dark)' }}>Brak aktywnych kart</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Pierwsza karta od razu przypisze opiekuna i jego zastępcę.
          </p>
          <Link href="/installations/new" className="mt-5 inline-flex text-sm font-bold underline underline-offset-4" style={{ color: '#8C5718' }}>
            Utwórz kartę montażu
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/installations/${order.id}`}
              className="group rounded-xl border p-5 transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: '0 1px 2px rgba(30, 30, 30, 0.04)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="num text-xs font-bold tracking-wide" style={{ color: '#8C5718' }}>{order.number}</span>
                    <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--wd-sand-light)', color: 'var(--wd-dark)' }}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-bold" style={{ color: 'var(--wd-dark)' }}>{order.client.name}</h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                    {order.addressStreet}, {order.addressCity}
                  </p>
                </div>
                <ArrowRight className="mt-1 h-5 w-5 shrink-0 transition group-hover:translate-x-1" style={{ color: '#8C5718' }} aria-hidden="true" />
              </div>
              <div className="mt-5 grid gap-2 border-t pt-4 text-sm sm:grid-cols-2" style={{ borderColor: 'rgba(30, 30, 30, 0.08)' }}>
                <p><span className="font-semibold" style={{ color: 'var(--wd-dark)' }}>Opiekun:</span> {order.primaryEmployee.firstName} {order.primaryEmployee.lastName}</p>
                <p><span className="font-semibold" style={{ color: 'var(--wd-dark)' }}>Zastępca:</span> {order.backupEmployee.firstName} {order.backupEmployee.lastName}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
