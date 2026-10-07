import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Divergent, screenUrl } from './index.ts'

const sandbox = {
  id: 'sb_1',
  name: 'calm-otter',
  status: 'running',
  metadata: { user: '42' },
  secrets: [],
}

function recorder(answer: (url: URL, init: RequestInit) => Response) {
  const requests: Array<{ method: string; url: URL; headers: Record<string, string>; body: unknown }> = []
  const fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input))
    requests.push({
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    })
    return answer(url, init)
  }) as typeof globalThis.fetch
  return { fetch, requests }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('create sends no secrets, whatever it is given', async () => {
  const { fetch, requests } = recorder(() => json(201, { data: sandbox }))
  const divergent = new Divergent({ apiKey: 'dv_live_x', baseUrl: 'https://api.test', fetch })
  const made = await divergent.sandboxes.create({
    size: 'small',
    metadata: { user: '42' },
    idleTimeoutSeconds: 600,
    idempotencyKey: 'k1',
    // A caller that reaches past the types still sends none.
    ...({ secrets: ['OPENAI_API_KEY'] } as object),
  })
  const [request] = requests
  assert.equal(request!.method, 'POST')
  assert.equal(request!.url.pathname, '/api/sandboxes')
  assert.equal(request!.headers['Idempotency-Key'], 'k1')
  assert.equal(request!.headers.Authorization, 'Bearer dv_live_x')
  assert.ok(!('secrets' in (request!.body as object)))
  assert.deepEqual(request!.body, { size: 'small', metadata: { user: '42' }, idle_timeout_seconds: 600 })
  assert.equal(made.id, 'sb_1')
  assert.deepEqual(made.metadata, { user: '42' })
})

test('list filters by metadata, one pair per parameter', async () => {
  const { fetch, requests } = recorder(() => json(200, { data: [sandbox] }))
  const divergent = new Divergent({ apiKey: 'dv_live_x', baseUrl: 'https://api.test', fetch })
  const rows = await divergent.sandboxes.list({ metadata: { user: '42', team: 'a' } })
  assert.equal(rows.length, 1)
  assert.equal(requests[0]!.url.searchParams.get('metadata[user]'), '42')
  assert.equal(requests[0]!.url.searchParams.get('metadata[team]'), 'a')
})

test('a token reaches the desktop routes of its sandbox, with the token as the bearer', async () => {
  const png = new Uint8Array([1, 2, 3])
  const { fetch, requests } = recorder((url) =>
    url.pathname.endsWith('/screenshot')
      ? new Response(png, { status: 200, headers: { 'x-image-width': '1280', 'x-image-height': '800' } })
      : json(200, { data: { done: 'click' } }),
  )
  const client = Divergent.fromToken({ token: 'dvs_abc', sandbox: 'sb_1' }, { baseUrl: 'https://api.test', fetch })
  await client.desktop.click({ x: 1, y: 2, count: 2 })
  const shot = await client.desktop.screenshot({ region: [0, 0, 640, 400] })

  assert.equal(requests[0]!.url.pathname, '/api/sandboxes/sb_1/desktop/input')
  assert.deepEqual(requests[0]!.body, { action: 'click', x: 1, y: 2, count: 2 })
  assert.equal(requests[0]!.headers.Authorization, 'Bearer dvs_abc')
  assert.equal(requests[1]!.url.searchParams.get('region'), '0,0,640,400')
  assert.deepEqual([...shot.bytes], [1, 2, 3])
  assert.deepEqual([shot.width, shot.height], [1280, 800])
  assert.equal(client.screenUrl, 'wss://api.test/api/sandboxes/sb_1/screen?token=dvs_abc')
})

test('a refusal on the screenshot route is an ApiError with its code', async () => {
  const { fetch } = recorder(() => json(409, { error: { code: 'no_desktop', message: 'No desktop is running.' } }))
  const client = Divergent.fromToken({ token: 'dvs_abc', sandbox: 'sb_1' }, { baseUrl: 'https://api.test', fetch })
  await assert.rejects(client.desktop.screenshot(), (error: { code?: string; status?: number }) => {
    return error.code === 'no_desktop' && error.status === 409
  })
})

test('createToken sends the wire names', async () => {
  const { fetch, requests } = recorder((url) =>
    url.pathname.endsWith('/tokens')
      ? json(201, { data: { token: 'dvs_x', sandbox: 'sb_1', abilities: ['view'], origins: [], expires_at: '2026-10-07T00:00:00Z' } })
      : json(200, { data: sandbox }),
  )
  const divergent = new Divergent({ apiKey: 'dv_live_x', baseUrl: 'https://api.test', fetch })
  const made = await divergent.sandboxes.get('sb_1')
  const grant = await made.createToken({ abilities: ['view'], expiresIn: 300, origins: ['https://app.example.com'] })
  assert.deepEqual(requests[1]!.body, { abilities: ['view'], expires_in: 300, origins: ['https://app.example.com'] })
  assert.equal(grant.sandbox, 'sb_1')
})

test('the screen URL follows the API scheme', () => {
  assert.equal(screenUrl('http://localhost:4000/', 'sb_1', 'dvs_x'), 'ws://localhost:4000/api/sandboxes/sb_1/screen?token=dvs_x')
})
