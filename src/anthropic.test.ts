import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NOT_EXECUTED, computerToolset, type ComputerStep } from './anthropic.ts'
import { fakeDesktop } from './fake.test-support.ts'

function use(id: string, name: string, input: Record<string, unknown> = {}) {
  return { type: 'tool_use', id, name, input, toolset_name: 'computer' }
}

test('every result echoes toolset_name, one per computer call, in order', async () => {
  const { desktop, calls } = fakeDesktop()
  const toolset = computerToolset(desktop)
  const results = await toolset.run([
    { type: 'text', text: 'Opening the page.' } as never,
    use('a', 'left_click', { coordinate: [10, 20] }),
    { type: 'tool_use', id: 'other', name: 'search', input: {} },
    use('b', 'type', { text: 'hello' }),
    use('c', 'screenshot'),
  ])
  assert.deepEqual(results.map((r) => r.tool_use_id), ['a', 'b', 'c'])
  assert.ok(results.every((r) => r.toolset_name === 'computer' && r.type === 'tool_result'))
  assert.equal(results[0]!.content, 'OK')
  const image = results[2]!.content as Array<{ type: string; source: { media_type: string; data: string } }>
  assert.equal(image[0]!.type, 'image')
  assert.equal(image[0]!.source.media_type, 'image/png')
  assert.equal(image[0]!.source.data, 'iVBORw==')
  assert.deepEqual(
    calls.filter(([name]) => name !== 'status').map(([name]) => name),
    ['click', 'type', 'screenshot'],
  )
  assert.deepEqual(toolset.tool, { type: 'computer_toolset_20260801' })
})

test('the first failure stops the batch, and every later call says it was not executed', async () => {
  const { desktop, calls } = fakeDesktop({ fail: 'type' })
  const steps: ComputerStep[] = []
  const results = await computerToolset(desktop, { onAction: (s) => void steps.push(s) }).run([
    use('a', 'mouse_move', { coordinate: [1, 2] }),
    use('b', 'type', { text: 'x' }),
    use('c', 'key', { text: 'Return' }),
    use('d', 'screenshot'),
  ])
  assert.equal(results[0]!.is_error, undefined)
  assert.equal(results[1]!.is_error, true)
  assert.equal(results[1]!.content, 'type was refused.')
  for (const r of results.slice(2)) {
    assert.equal(r.is_error, true)
    assert.equal(r.content, NOT_EXECUTED)
    assert.equal(r.toolset_name, 'computer')
  }
  assert.equal(NOT_EXECUTED, 'Not executed: an earlier computer action in this turn failed.')
  assert.ok(!calls.some(([name]) => name === 'key' || name === 'screenshot'))
  assert.deepEqual(steps.map((s) => [s.name, s.error]), [['mouse_move', undefined], ['type', 'type was refused.']])
})

test('an unknown member or a malformed input fails as an error result', async () => {
  const { desktop } = fakeDesktop()
  const results = await computerToolset(desktop).run([use('a', 'teleport'), use('b', 'screenshot')])
  assert.equal(results[0]!.is_error, true)
  assert.match(results[0]!.content as string, /teleport is not a member of computer_toolset_20260801/)
  assert.equal(results[1]!.content, NOT_EXECUTED)

  const bad = await computerToolset(desktop).run([use('a', 'left_click', { coordinate: [1] })])
  assert.equal(bad[0]!.content, 'left_click takes coordinate as [x, y].')
})

test('cursor_position answers X=…, Y=…', async () => {
  const { desktop } = fakeDesktop({ cursor: { x: 512, y: 384 } })
  const [result] = await computerToolset(desktop).run([use('a', 'cursor_position')])
  assert.equal(result!.content, 'X=512, Y=384')
})

test('zoom is a screenshot of the region', async () => {
  const { desktop, calls } = fakeDesktop()
  const [result] = await computerToolset(desktop).run([use('a', 'zoom', { region: [0, 0, 640, 400] })])
  assert.deepEqual(calls.find(([name]) => name === 'screenshot'), ['screenshot', { region: [0, 0, 640, 400] }])
  assert.equal((result!.content as Array<{ type: string }>)[0]!.type, 'image')
})

test('wait sleeps here and asks the desktop nothing', async () => {
  const { desktop, calls } = fakeDesktop()
  const [result] = await computerToolset(desktop).run([use('a', 'wait', { duration: 0.01 })])
  assert.equal(result!.content, 'OK')
  assert.deepEqual(calls, [])

  const [tooLong] = await computerToolset(desktop).run([use('a', 'wait', { duration: 301 })])
  assert.equal(tooLong!.is_error, true)
})

test('clicks carry their button, count and held keys', async () => {
  const { desktop, calls } = fakeDesktop()
  await computerToolset(desktop).run([
    use('a', 'triple_click', { coordinate: [5, 6], text: 'Shift+Control' }),
    use('b', 'right_click'),
    use('c', 'left_click_drag', { start_coordinate: [1, 2], coordinate: [3, 4] }),
    use('d', 'scroll', { scroll_direction: 'down', scroll_amount: 5, coordinate: [7, 8] }),
    use('e', 'key', { text: 'ctrl+l', repeat: 2 }),
    use('f', 'hold_key', { text: 'shift', duration: 1 }),
  ])
  const asked = calls.filter(([name]) => name !== 'status')
  assert.deepEqual(asked, [
    ['click', { x: 5, y: 6, button: 'left', count: 3, modifiers: 'shift+ctrl' }],
    ['click', { button: 'right', count: 1, modifiers: undefined }],
    ['drag', { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, modifiers: undefined }],
    ['scroll', { direction: 'down', amount: 5, x: 7, y: 8, modifiers: undefined }],
    ['key', ['ctrl+l'], { repeat: 2 }],
    ['hold', ['shift'], 1],
  ])
})

test('a screenshot of a desktop nobody started starts it once', async () => {
  const { desktop, calls } = fakeDesktop({ running: false })
  const [result] = await computerToolset(desktop).run([use('a', 'screenshot')])
  assert.equal(result!.is_error, undefined)
  assert.deepEqual(calls.map(([name]) => name), ['screenshot', 'start', 'screenshot'])
})

test('a screen over 2000 px a side is shrunk, and positions are mapped back', async () => {
  const { desktop, calls } = fakeDesktop({ size: [4000, 2000] })
  const sizes: Array<[number, number]> = []
  const toolset = computerToolset(desktop, {
    resize: async (png, w, h) => {
      sizes.push([w, h])
      return png
    },
  })
  const steps: ComputerStep[] = []
  await computerToolset(desktop, { resize: async (png) => png, onAction: (s) => void steps.push(s) }).run([use('s', 'screenshot')])
  assert.deepEqual([steps[0]!.screenshot!.width, steps[0]!.screenshot!.height], [2000, 1000])

  await toolset.run([use('a', 'screenshot'), use('b', 'left_click', { coordinate: [100, 50] }), use('c', 'cursor_position')])
  assert.deepEqual(sizes, [[2000, 1000]])
  assert.deepEqual(calls.find(([name]) => name === 'click'), ['click', { x: 200, y: 100, button: 'left', count: 1, modifiers: undefined }])
})
