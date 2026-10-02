// Local PostgREST/Auth/Vault + real checkout orchestration and signature validator.
// Mercado Pago is replaced by a deterministic provider; no money or external API calls.
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { checkoutGateway } from '../functions/mobile-payment/checkout.ts'
import { checkoutRepository } from '../functions/mobile-payment/repository.ts'
import { createMobilePaymentHandler } from '../functions/mobile-payment/handler.ts'
import { createMercadoPagoWebhook } from '../functions/mercado-pago-webhook/handler.ts'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
assert.ok(url && anonKey && serviceKey, 'Set local SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Only local Supabase is allowed.')
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
const admin = createClient(url, serviceKey, { auth })
const owner = createClient(url, anonKey, { auth })
const diner = createClient(url, anonKey, { auth })
const stranger = createClient(url, anonKey, { auth })
const users = []
let restaurantId
const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}
const insert = async (table, input) => unwrap(await admin.from(table).insert(input).select().single())
const stamp = () => new Date().toISOString()
const secret = 'integration-webhook-secret-123456'
const token = 'integration-fake-token-never-sent-to-provider'
const settings = {
  appUrl: 'https://menu.example.com',
  webhookUrl: 'https://project.supabase.co/functions/v1/mercado-pago-webhook',
}
let creates = 0
let remotePreference
let remotePayment
const provider = {
  async create(context) {
    creates++
    remotePreference = {
      id: '456-local-integration',
      collector_id: 456,
      external_reference: context.external_reference,
      init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=456-local-integration',
      items: [{ quantity: 1, unit_price: context.amount, currency_id: context.currency_id }],
    }
    // The remote write succeeded but its response was lost.
    throw new Error('simulated lost response')
  },
  async findPreference(reference) {
    return remotePreference?.external_reference === reference ? remotePreference : null
  },
  async findPayments() {
    return remotePayment ? [remotePayment] : []
  },
  async getPayment(id) {
    assert.equal(id, String(remotePayment.id))
    return remotePayment
  },
}
const providerFor = (receivedToken) => {
  assert.equal(receivedToken, token)
  return provider
}
const request = (body) =>
  new Request('http://local/mobile-payment', {
    method: 'POST',
    headers: { authorization: 'Bearer verified-integration-user', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
function signedNotification(paymentId, signatureSecret = secret) {
  const dataId = String(remotePayment.id)
  const requestId = 'integration-request'
  const ts = String(Date.now())
  const v1 = createHmac('sha256', signatureSecret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex')
  return new Request(`${settings.webhookUrl}?payment_id=${paymentId}&data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` },
    body: JSON.stringify({ type: 'payment', data: { id: dataId } }),
  })
}

try {
  const email = `checkout-${randomUUID()}@example.test`
  const password = randomUUID()
  const { user: ownerUser } = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true }))
  users.push(ownerUser.id)
  unwrap(await owner.auth.signInWithPassword({ email, password }))
  const { user: dinerUser } = unwrap(await diner.auth.signInAnonymously())
  const { user: strangerUser } = unwrap(await stranger.auth.signInAnonymously())
  users.push(dinerUser.id, strangerUser.id)
  restaurantId = (await insert('restaurants', { name: 'Checkout integration', slug: randomUUID() })).id
  const branch = await insert('branches', {
    restaurant_id: restaurantId,
    name: 'Test',
    payment_methods: ['mobile', 'in_person'],
  })
  await insert('restaurant_members', { restaurant_id: restaurantId, user_id: ownerUser.id, role: 'owner' })
  const table = await insert('tables', { restaurant_id: restaurantId, branch_id: branch.id, label: 'Test table' })
  const session = await insert('table_sessions', { restaurant_id: restaurantId, table_id: table.id })
  const participant = await insert('session_participants', {
    session_id: session.id,
    user_id: dinerUser.id,
    display_name: 'Test diner',
  })
  await insert('orders', {
    restaurant_id: restaurantId,
    session_id: session.id,
    submitted_by: participant.id,
    total_amount: 1250,
    status: 'accepted',
  })
  unwrap(
    await owner.rpc('save_payment_provider_config', {
      p_restaurant_id: restaurantId,
      p_environment: 'test',
      p_branch_ids: [branch.id],
      p_access_token: token,
      p_webhook_secret: secret,
    }),
  )
  const repository = checkoutRepository(admin, diner)
  const gateway = checkoutGateway(repository, providerFor, settings, dinerUser.id)
  const handler = createMobilePaymentHandler(async () => gateway)
  const input = { action: 'create', sessionId: session.id, requestId: randomUUID(), mode: 'full' }
  const uncertain = await handler(request(input))
  assert.equal(uncertain.status, 503)
  assert.equal((await uncertain.json()).error.code, 'CHECKOUT_UNCERTAIN')
  const recovered = await handler(request(input))
  assert.equal(recovered.status, 201)
  const checkout = await recovered.json()
  assert.equal(checkout.amount, 1250)
  assert.ok(checkout.checkoutUrl)
  assert.equal(creates, 1, 'Recovery must not issue a second preference POST')
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => handler(request(input))))
  assert.ok(
    concurrent.every((response) => response.status === 201),
    'Concurrent retries reuse the ready preference',
  )
  assert.equal(creates, 1)
  assert.equal(unwrap(await diner.from('payments').select('id').eq('session_id', session.id)).length, 1)
  assert.equal(
    (await handler(request({ action: 'confirm', paymentId: checkout.paymentId, outcome: 'approved' }))).status,
    400,
  )
  await assert.rejects(
    checkoutGateway(checkoutRepository(admin, stranger), providerFor, settings, strangerUser.id).execute({
      action: 'status',
      paymentId: checkout.paymentId,
    }),
    { code: 'FORBIDDEN' },
  )
  assert.deepEqual(
    unwrap(await diner.from('payments').select('status').eq('id', checkout.paymentId)).map((row) => row.status),
    ['pending'],
  )

  // Disable current account before the delayed notification: the frozen credential must still work.
  unwrap(await owner.rpc('delete_payment_provider_config', { p_restaurant_id: restaurantId }))
  remotePayment = {
    id: 987654321,
    collector_id: 456,
    external_reference: checkout.paymentId,
    transaction_amount: 1250,
    currency_id: 'ARS',
    status: 'approved',
    date_last_updated: stamp(),
    transaction_amount_refunded: 0,
  }
  const webhook = createMercadoPagoWebhook(checkoutRepository(admin), providerFor)
  assert.equal((await webhook(signedNotification(checkout.paymentId, 'forged'))).status, 401)
  assert.equal((await webhook(signedNotification(checkout.paymentId))).status, 200)
  assert.equal((await webhook(signedNotification(checkout.paymentId))).status, 200)
  let bill = unwrap(await diner.from('session_bills').select().eq('session_id', session.id).single())
  assert.equal(Number(bill.paid_amount), 1250)
  assert.equal(Number(bill.pending_amount), 0)
  remotePayment.transaction_amount_refunded = 250
  remotePayment.date_last_updated = new Date(Date.now() + 1000).toISOString()
  assert.equal((await webhook(signedNotification(checkout.paymentId))).status, 200)
  bill = unwrap(await diner.from('session_bills').select().eq('session_id', session.id).single())
  assert.equal(Number(bill.paid_amount), 1000)
  assert.equal(Number(bill.pending_amount), 250)
  const status = await handler(request({ action: 'status', paymentId: checkout.paymentId }))
  assert.equal((await status.json()).status, 'approved')
  const loadStarted = performance.now()
  const burst = await Promise.all(
    Array.from({ length: 30 }, () => handler(request({ action: 'status', paymentId: checkout.paymentId }))),
  )
  assert.equal(
    burst.filter((response) => response.status === 200).length,
    19,
    'One prior request leaves 19 requests in the window',
  )
  assert.equal(
    burst.filter((response) => response.status === 429).length,
    11,
    'Excess concurrent requests must be rate limited',
  )
  console.log(
    `Local load check passed: 30 concurrent status requests in ${Math.round(performance.now() - loadStarted)} ms; 19 accepted, 11 rate limited.`,
  )
  console.log(
    'Payment integration passed: Auth/RLS, real RPCs/Vault, uncertain recovery, signed duplicates, frozen credentials, partial refund and bill reconciliation.',
  )
} finally {
  if (restaurantId) {
    // These are exclusively this suite's fixtures; release commitments before cascade cleanup.
    unwrap(await admin.from('payments').update({ status: 'cancelled' }).eq('restaurant_id', restaurantId))
    unwrap(await admin.from('restaurants').delete().eq('id', restaurantId))
  }
  for (const id of users) unwrap(await admin.auth.admin.deleteUser(id))
}
