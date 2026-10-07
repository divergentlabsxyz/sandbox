import assert from 'node:assert/strict'
import { test } from 'node:test'
import { combo, computerCallOutput, keysym } from './openai.ts'
import { fakeDesktop } from './fake.test-support.ts'

test("OpenAI's key names become xdotool keysyms", () => {
  const pairs: Array<[string, string]> = [
    ['CTRL', 'ctrl'],
    ['CONTROL', 'ctrl'],
    ['SHIFT', 'shift'],
    ['ALT', 'alt'],
    ['CMD', 'super'],
    ['META', 'super'],
    ['ENTER', 'Return'],
    ['RETURN', 'Return'],
    ['ESC', 'Escape'],
    ['ESCAPE', 'Escape'],
    ['TAB', 'Tab'],
    ['SPACE', 'space'],
    ['BACKSPACE', 'BackSpace'],
    ['DELETE', 'Delete'],
    ['ARROWLEFT', 'Left'],
    ['ARROWRIGHT', 'Right'],
    ['ARROWUP', 'Up'],
    ['ARROWDOWN', 'Down'],
    ['PAGEUP', 'Page_Up'],
    ['PAGEDOWN', 'Page_Down'],
    ['HOME', 'Home'],
    ['END', 'End'],
    ['F5', 'F5'],
    ['f12', 'F12'],
    ['A', 'a'],
    ['/', 'slash'],
    ['-', 'minus'],
    ['Page_Up', 'Page_Up'],
  ]
  for (const [name, sym] of pairs) assert.equal(keysym(name), sym, name)
  assert.equal(combo(['CTRL', 'SHIFT', 'T']), 'ctrl+shift+t')
  assert.equal(combo(['ctrl', 'l']), 'ctrl+l')
})

test('a computer_call runs its actions in order and answers with a screenshot', async () => {
  const { desktop, calls } = fakeDesktop()
  const output = await computerCallOutput(desktop, {
    type: 'computer_call',
    call_id: 'call_1',
    actions: [
      { type: 'click', button: 'wheel', x: 10.4, y: 20, keys: ['SHIFT'] },
      { type: 'keypress', keys: ['CTRL', 'L'] },
      { type: 'type', text: 'example.com' },
      { type: 'scroll', x: 5, y: 6, scroll_x: 0, scroll_y: -250 },
      { type: 'drag', path: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] },
    ] as never,
  })
  assert.deepEqual(calls, [
    ['click', { x: 10, y: 20, button: 'middle', modifiers: 'shift' }],
    ['key', 'ctrl+l', undefined],
    ['type', 'example.com'],
    ['scroll', { direction: 'up', amount: 3, x: 5, y: 6, modifiers: undefined }],
    ['move', { x: 1, y: 1 }],
    ['mouseDown'],
    ['move', { x: 2, y: 2 }],
    ['move', { x: 3, y: 3 }],
    ['mouseUp'],
    ['screenshot', {}],
  ])
  assert.deepEqual(output, {
    type: 'computer_call_output',
    call_id: 'call_1',
    output: { type: 'computer_screenshot', image_url: 'data:image/png;base64,iVBORw==' },
  })
})

test('a call with safety checks nobody acknowledged is not run', async () => {
  const { desktop, calls } = fakeDesktop()
  const call = {
    type: 'computer_call' as const,
    call_id: 'call_2',
    action: { type: 'type', text: 'x' },
    pending_safety_checks: [{ id: 'sc_1', code: 'malicious_instructions' }],
  }
  await assert.rejects(computerCallOutput(desktop, call), /malicious_instructions/)
  assert.deepEqual(calls, [])
  const output = await computerCallOutput(desktop, call, { acknowledgedSafetyChecks: [{ id: 'sc_1' }] })
  assert.deepEqual(output.acknowledged_safety_checks, [{ id: 'sc_1', code: 'malicious_instructions' }])
})
