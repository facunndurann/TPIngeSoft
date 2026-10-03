import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Copy, Printer } from 'lucide-react'
import { Button, Modal } from '@restaurant-platform/ui'
import { customerAppUrl } from '@/lib/customer-app'
import type { FloorTable } from '@/queries/floor'

function tableUrl(table: FloorTable) {
  return customerAppUrl(`/m/${table.qr_token}`)
}

/** El QR de una mesa, para copiar su link o imprimirlo. Lo abren Mesas y QR y el Salón. */
export function QrModal({
  table,
  restaurantName,
  onClose,
}: {
  table: FloorTable
  restaurantName: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const url = tableUrl(table)

  return (
    <Modal title={`QR de ${table.label}`} onClose={onClose}>
      <div id="qr-print-area" className="flex flex-col items-center gap-3 py-2">
        <p className="hidden text-lg font-bold print:block">{restaurantName}</p>
        <QRCodeSVG value={url} size={220} marginSize={2} />
        <p className="text-base font-semibold text-neutral-900">{table.label}</p>
        <p className="hidden text-sm text-muted print:block">Escaneá para ver el menú y pedir</p>
        <code className="break-all rounded bg-neutral-100 px-2 py-1 text-xs text-muted print:hidden">
          {url}
        </code>
      </div>
      <div className="mt-4 flex gap-2 print:hidden">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          <Copy size={15} /> {copied ? 'Copiado' : 'Copiar link'}
        </Button>
        <Button className="flex-1" onClick={() => window.print()}>
          <Printer size={15} /> Imprimir
        </Button>
      </div>
    </Modal>
  )
}
