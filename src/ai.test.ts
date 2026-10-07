import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computerTools } from './ai.ts'
import { fakeDesktop } from './fake.test-support.ts'

const options = { toolCallId: 't1', messages: [] } as never

test('the screenshot tool hands the model an image', async () => {
  const { desktop } = fakeDesktop()
  const tools = computerTools(desktop)
  const output = await tools.screenshot.execute!({} as never, options)
  const model = await tools.screenshot.toModelOutput!({ toolCallId: 't1', input: {}, output } as never)
  assert.equal(model.type, 'content')
  const file = (model as { value: Array<{ type: string; mediaType?: string; data?: { data: string } }> }).value[1]!
  assert.equal(file.type, 'file')
  assert.equal(file.mediaType, 'image/png')
  assert.equal(file.data!.data, 'iVBORw==')
})

test('the drag tool sends both ends', async () => {
  const { desktop, calls } = fakeDesktop()
  await computerTools(desktop).drag.execute!({ x: 1, y: 2, to_x: 3, to_y: 4 }, options)
  assert.deepEqual(calls, [['drag', { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, modifiers: undefined }]])
})
