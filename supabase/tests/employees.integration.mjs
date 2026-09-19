// Full Auth + Edge + PostgREST integration. Only runs against local Supabase.
// Start the seeded stack and `pnpm dev:functions`; export `supabase status -o env`.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../apps/admin/package.json',import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const url = process.env.SUPABASE_URL ?? process.env.API_URL ?? 'http://127.0.0.1:54321'
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname),'Local stack only')
assert.ok(anon && service,'Export ANON_KEY and SERVICE_ROLE_KEY from pnpm supabase status -o env')
const options = { auth: { persistSession: false,autoRefreshToken: false,detectSessionInUrl: false } }
const admin = createClient(url,anon,options)
const otherAdmin = createClient(url,anon,options)
const cleanup = createClient(url,service,options)
const ids = []
let branchId
const run = randomUUID().replaceAll('-','').slice(0,16)
const unwrap = ({ data,error }) => { if (error) throw error; return data }
async function change(client,body) {
  const session = unwrap(await client.auth.getSession()).session
  const response = await fetch(`${url}/functions/v1/employee-accounts`, {
    method: 'POST',headers: { Authorization: `Bearer ${session.access_token}`,apikey: anon,'Content-Type':'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (response.status === 201) ids.push(data.userId)
  return { status: response.status,data }
}
try {
  unwrap(await admin.auth.signInWithPassword({ email:'admin@esquina.demo',password:'demo1234' }))
  unwrap(await otherAdmin.auth.signInWithPassword({ email:'admin@nonna.demo',password:'demo1234' }))
  const membership = unwrap(await admin.from('restaurant_members').select('restaurant_id').eq('user_id',unwrap(await admin.auth.getUser()).user.id).single())
  const otherMembership = unwrap(await otherAdmin.from('restaurant_members').select('restaurant_id').eq('user_id',unwrap(await otherAdmin.auth.getUser()).user.id).single())
  const branches = unwrap(await admin.from('branches').select('id').eq('restaurant_id',membership.restaurant_id))
  const otherBranches = unwrap(await otherAdmin.from('branches').select('id').eq('restaurant_id',otherMembership.restaurant_id))
  const base = { action:'create',restaurantId:membership.restaurant_id,username:`test.${run}`,password:'employee-test-1234',fullName:'Same visible name',roles:['waiter'],branchIds:[branches[0].id],active:true }
  const created = await change(admin,base)
  assert.equal(created.status,201,JSON.stringify(created.data))
  const employeeId = created.data.userId
  const collision = await change(otherAdmin,{ ...base,restaurantId:otherMembership.restaurant_id,branchIds:[otherBranches[0].id],username:base.username.toUpperCase() })
  assert.equal(collision.status,409)
  assert.equal((await change(admin,{ ...base,username:`peer.${run}` })).status,201)
  // Simultaneous requests must produce exactly one account globally.
  const races = await Promise.all([change(admin,{ ...base,username:`race.${run}` }),change(admin,{ ...base,username:`RACE.${run}` })])
  assert.deepEqual(races.map(r=>r.status).sort(),[201,409])

  const employee = createClient(url,anon,options) // No admin session/storage.
  unwrap(await employee.auth.signInWithPassword({ email:`${base.username}@employees.example.com`,password:base.password }))
  let contexts = unwrap(await employee.rpc('get_pos_contexts'))
  assert.equal(contexts.length,1)
  assert.equal(contexts[0].restaurant_id,membership.restaurant_id)
  assert.ok(contexts[0].permissions.includes('orders.deliver'))
  assert.ok(!contexts[0].permissions.includes('sessions.close'))
  assert.equal((await change(employee,{ ...base,username:`forged.${run}` })).status,403)
  assert.ok((await employee.rpc('list_employee_accounts',{ p_restaurant:membership.restaurant_id })).error)
  assert.deepEqual(unwrap(await employee.from('orders').select('id').eq('restaurant_id',otherMembership.restaurant_id)),[])
  const branch = unwrap(await admin.from('branches').insert({ restaurant_id:membership.restaurant_id,name:`Integration ${run}` }).select('id').single())
  branchId=branch.id
  const update = { action:'update',restaurantId:membership.restaurant_id,userId:employeeId,fullName:base.fullName,roles:base.roles,branchIds:[branches[0].id,branchId],active:true }
  assert.equal((await change(admin,update)).status,200)
  contexts = unwrap(await employee.rpc('get_pos_contexts'))
  assert.equal(contexts.length,2)
  assert.ok(contexts.every(c=>c.restaurant_id===membership.restaurant_id))
  assert.equal((await change(admin,{ action:'reset-password',restaurantId:membership.restaurant_id,userId:employeeId,password:'changed-password-1234' })).status,200)
  const fresh = createClient(url,anon,options)
  assert.ok((await fresh.auth.signInWithPassword({ email:`${base.username}@employees.example.com`,password:base.password })).error)
  unwrap(await fresh.auth.signInWithPassword({ email:`${base.username}@employees.example.com`,password:'changed-password-1234' }))
  assert.equal((await change(admin,{ ...update,active:false })).status,200)
  assert.deepEqual(unwrap(await fresh.rpc('get_pos_contexts')),[])
  assert.deepEqual(unwrap(await fresh.from('orders').select('id')),[])
  assert.ok((unwrap(await admin.from('pos_audit_log').select('actor_user_id').eq('restaurant_id',membership.restaurant_id).eq('action','account.password_reset'))).every(a=>a.actor_user_id))
  console.log('PASS employee Auth/Edge integration: creation, global collision/race, separate login, roles, branch contexts, reset, revocation')
} finally {
  for (const id of ids) unwrap(await cleanup.auth.admin.deleteUser(id))
  if (branchId) unwrap(await cleanup.from('branches').delete().eq('id',branchId))
  await admin.auth.signOut(); await otherAdmin.auth.signOut()
}
