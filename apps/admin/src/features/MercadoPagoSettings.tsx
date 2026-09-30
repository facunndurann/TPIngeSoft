import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acceptsPaymentMethod,
  paymentProviderEnvironmentLabels,
  type PaymentProviderConfig,
  type PaymentProviderEnvironment,
} from '@restaurant-platform/shared'
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  QueryView,
  Select,
  useConfirm,
  useSaveErrors,
} from '@restaurant-platform/ui'
import { branchesQuery, type Branch } from '@/queries/branches'
import {
  deletePaymentProvider,
  paymentProviderKey,
  paymentProviderQuery,
  savePaymentProvider,
} from '@/queries/payment-provider'

export function MercadoPagoSettings({ restaurantId }: { restaurantId: string }) {
  const config = useQuery(paymentProviderQuery(restaurantId))
  const branches = useQuery(branchesQuery(restaurantId))

  return (
    <section className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-neutral-900">Mercado Pago</h2>
          {config.data && (
            <Badge color={config.data.configured ? 'green' : 'neutral'}>
              {config.data.configured ? 'Configurado' : 'Sin configurar'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted">
          La cuenta receptora es del restaurante. Cada sucursal sigue habilitando “Pago desde el celular” en sus medios
          de pago; acá elegís cuáles usan esta cuenta de Mercado Pago.
        </p>
      </div>

      <QueryView query={config} fallback="No pudimos cargar la configuración de Mercado Pago.">
        {(saved) => (
          <QueryView query={branches} fallback="No pudimos cargar las sucursales.">
            {(allBranches) => (
              <MercadoPagoForm
                key={`${saved.updatedAt ?? 'empty'}:${saved.configured}`}
                restaurantId={restaurantId}
                saved={saved}
                branches={allBranches}
              />
            )}
          </QueryView>
        )}
      </QueryView>
    </section>
  )
}

function MercadoPagoForm({
  restaurantId,
  saved,
  branches,
}: {
  restaurantId: string
  saved: PaymentProviderConfig
  branches: Branch[]
}) {
  const queryClient = useQueryClient()
  const errors = useSaveErrors()
  const { confirm, dialog } = useConfirm()
  const [environment, setEnvironment] = useState(saved.environment)
  const [accessToken, setAccessToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [branchIds, setBranchIds] = useState(saved.branchIds)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: paymentProviderKey(restaurantId) })

  const save = useMutation(
    errors.saving('No pudimos guardar la configuración de Mercado Pago.', {
      mutationFn: () =>
        savePaymentProvider({
          restaurantId,
          environment,
          branchIds,
          accessToken: accessToken.trim() || undefined,
          webhookSecret: webhookSecret.trim() || undefined,
        }),
      onSuccess: async () => {
        setAccessToken('')
        setWebhookSecret('')
        await invalidate()
      },
    }),
  )

  const remove = useMutation(
    errors.saving('No pudimos desvincular Mercado Pago.', {
      mutationFn: () => deletePaymentProvider(restaurantId),
      onSuccess: invalidate,
    }),
  )

  const environmentChanged = environment !== saved.environment
  const tokenRequired = !saved.configured || environmentChanged
  const dirty =
    tokenRequired ||
    accessToken.trim().length > 0 ||
    webhookSecret.trim().length > 0 ||
    [...branchIds].sort().join(',') !== [...saved.branchIds].sort().join(',')

  function toggleBranch(branchId: string, checked: boolean) {
    setBranchIds((current) => (checked ? [...current, branchId] : current.filter((id) => id !== branchId)))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  const busy = save.isPending || remove.isPending

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Ambiente" hint="Pruebas no procesa dinero real; producción usa la cuenta real del restaurante.">
        <Select
          value={environment}
          disabled={busy}
          onChange={(event) => setEnvironment(event.target.value as PaymentProviderEnvironment)}
        >
          {Object.entries(paymentProviderEnvironmentLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={saved.configured ? 'Reemplazar Access Token (opcional)' : 'Access Token'}
        hint={
          saved.accessTokenHint
            ? `Guardado de forma cifrada; termina en ${saved.accessTokenHint}. Dejalo vacío para conservarlo.`
            : 'Copialo desde Tus integraciones de Mercado Pago. Se envía al backend y no vuelve al panel.'
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={accessToken}
          required={tokenRequired}
          minLength={20}
          maxLength={512}
          disabled={busy}
          onChange={(event) => setAccessToken(event.target.value)}
        />
      </Field>

      <Field
        label="Reemplazar secreto de webhook (opcional)"
        hint={
          saved.webhookConfigured
            ? 'Hay un secreto guardado de forma cifrada. Dejalo vacío para conservarlo.'
            : 'Podés cargarlo ahora o antes de activar el webhook en una fase posterior.'
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={webhookSecret}
          minLength={16}
          maxLength={512}
          disabled={busy}
          onChange={(event) => setWebhookSecret(event.target.value)}
        />
      </Field>

      <fieldset className="space-y-2 rounded-lg border border-neutral-200 p-3">
        <legend className="px-1 text-sm font-medium">Sucursales asociadas</legend>
        {branches.map((branch) => {
          const mobileEnabled = acceptsPaymentMethod(branch, 'mobile')
          return (
            <label key={branch.id} className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={branchIds.includes(branch.id)}
                disabled={busy}
                onChange={(event) => toggleBranch(branch.id, event.target.checked)}
              />
              <span>{branch.name}</span>
              {!branch.is_active && <Badge color="red">Inactiva</Badge>}
              {!mobileEnabled && <span className="text-xs text-muted">Pago desde el celular apagado</span>}
            </label>
          )
        })}
        {branches.length === 0 && <p className="text-sm text-muted">Todavía no hay sucursales.</p>}
      </fieldset>

      <ErrorText error={errors.message} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || busy}>
          {save.isPending ? 'Guardando…' : 'Guardar Mercado Pago'}
        </Button>
        {saved.configured && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              const accepted = await confirm({
                title: '¿Desvincular Mercado Pago?',
                message: 'No se podrán iniciar pagos nuevos. Los intentos ya creados conservan su historial.',
                confirmLabel: 'Desvincular',
              })
              if (accepted) remove.mutate()
            }}
          >
            Desvincular
          </Button>
        )}
        {save.isSuccess && (
          <p role="status" className="text-sm text-green-700">
            Configuración guardada.
          </p>
        )}
      </div>
      {dialog}
    </form>
  )
}
