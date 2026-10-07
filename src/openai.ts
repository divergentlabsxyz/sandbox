/**
 * OpenAI's computer tool, from the Responses API, on a sandbox's desktop.
 *
 * ```ts
 * const response = await openai.responses.create({ ..., tools: [computerTool] })
 * for (const item of response.output) {
 *   if (item.type === 'computer_call') next.push(await computerCallOutput(sandbox.desktop, item))
 * }
 * ```
 *
 * The action list follows OpenAI's computer tool as of October 2026: click,
 * double_click, drag, keypress, move, screenshot, scroll, type and wait, sent
 * one at a time on `action` or as a batch on `actions`. Re-check it against
 * OpenAI's current docs when changing this file. The types here are
 * structural, so `openai` stays optional.
 */

import type { ComputerDesktop, MouseButton } from './desktop.ts'
import { sleep, toBase64 } from './image.ts'

/** The `tools` entry. */
export const computerTool = { type: 'computer' as const }

export type ComputerAction =
  | { type: 'click'; button: 'left' | 'right' | 'wheel' | 'back' | 'forward'; x: number; y: number; keys?: string[] | null }
  | { type: 'double_click'; x: number; y: number; keys?: string[] | null }
  | { type: 'drag'; path: Array<{ x: number; y: number }>; keys?: string[] | null }
  | { type: 'keypress'; keys: string[] }
  | { type: 'move'; x: number; y: number; keys?: string[] | null }
  | { type: 'screenshot' }
  | { type: 'scroll'; x: number; y: number; scroll_x: number; scroll_y: number; keys?: string[] | null }
  | { type: 'type'; text: string }
  | { type: 'wait' }

/** A `computer_call` output item, as far as this reads it. */
export interface ComputerCallLike {
  type: 'computer_call'
  call_id: string
  action?: { type: string } | null
  actions?: ReadonlyArray<{ type: string }> | null
  pending_safety_checks?: ReadonlyArray<{ id: string; code?: string | null; message?: string | null }>
}

/** The `computer_call_output` input item that answers a call. */
export interface ComputerCallOutput {
  type: 'computer_call_output'
  call_id: string
  output: { type: 'computer_screenshot'; image_url: string }
  acknowledged_safety_checks?: Array<{ id: string; code?: string | null; message?: string | null }>
}

export interface ComputerCallOptions {
  /**
   * Safety checks a person has approved. A call with pending checks is not
   * run unless every one is acknowledged here.
   */
  acknowledgedSafetyChecks?: ReadonlyArray<{ id: string; code?: string | null; message?: string | null }>
  /** Called after each action runs, in order. */
  onAction?: (action: ComputerAction) => void | Promise<void>
  /** How long `wait` waits, in milliseconds. 1000 when left out. */
  waitMs?: number
}

/**
 * OpenAI's key names, upper case, to xdotool keysyms. A name not here is
 * passed on as it is, so a keysym such as `Page_Up` works too.
 */
const KEYSYMS: Record<string, string> = {
  CTRL: 'ctrl',
  CONTROL: 'ctrl',
  SHIFT: 'shift',
  ALT: 'alt',
  OPTION: 'alt',
  CMD: 'super',
  COMMAND: 'super',
  META: 'super',
  SUPER: 'super',
  WIN: 'super',
  WINDOWS: 'super',
  ENTER: 'Return',
  RETURN: 'Return',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  SPACE: 'space',
  BACKSPACE: 'BackSpace',
  DELETE: 'Delete',
  DEL: 'Delete',
  INSERT: 'Insert',
  HOME: 'Home',
  END: 'End',
  PAGEUP: 'Page_Up',
  PAGE_UP: 'Page_Up',
  PAGEDOWN: 'Page_Down',
  PAGE_DOWN: 'Page_Down',
  ARROWLEFT: 'Left',
  ARROWRIGHT: 'Right',
  ARROWUP: 'Up',
  ARROWDOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  UP: 'Up',
  DOWN: 'Down',
  CAPSLOCK: 'Caps_Lock',
  '/': 'slash',
  '\\': 'backslash',
  '-': 'minus',
  '=': 'equal',
  '+': 'plus',
  '.': 'period',
  ',': 'comma',
  ';': 'semicolon',
  "'": 'apostrophe',
  '`': 'grave',
  '[': 'bracketleft',
  ']': 'bracketright',
  ' ': 'space',
}

/** One OpenAI key name as an xdotool keysym: `CTRL` → `ctrl`, `ENTER` → `Return`, `A` → `a`. */
export function keysym(name: string) {
  const known = KEYSYMS[name.toUpperCase()] ?? KEYSYMS[name]
  if (known) return known
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(name)) return name.toUpperCase()
  // A capital letter would be read as shift and the letter.
  if (name.length === 1) return name.toLowerCase()
  return name
}

/** Keys pressed together, as one xdotool combo: `["CTRL", "L"]` → `ctrl+l`. */
export function combo(keys: ReadonlyArray<string>) {
  return keys.map(keysym).join('+')
}

/** Held keys as the desktop's modifiers, or undefined for none. */
function held(keys: ReadonlyArray<string> | null | undefined) {
  return keys && keys.length > 0 ? combo(keys) : undefined
}

/** Pixels of an OpenAI scroll per notch of the wheel. */
const PIXELS_PER_NOTCH = 100

function notches(pixels: number) {
  return Math.min(100, Math.max(1, Math.round(Math.abs(pixels) / PIXELS_PER_NOTCH)))
}

/** Runs one action. */
export async function runComputerAction(desktop: ComputerDesktop, action: ComputerAction, options: { waitMs?: number } = {}) {
  switch (action.type) {
    case 'click': {
      const x = Math.round(action.x)
      const y = Math.round(action.y)
      if (action.button === 'back' || action.button === 'forward') {
        // The desktop's buttons are left, middle and right; Chromium takes these keys for the same thing.
        await desktop.move({ x, y })
        await desktop.key(action.button === 'back' ? 'alt+Left' : 'alt+Right')
        return
      }
      const button: MouseButton = action.button === 'wheel' ? 'middle' : action.button
      await desktop.click({ x, y, button, modifiers: held(action.keys) })
      return
    }
    case 'double_click':
      await desktop.click({ x: Math.round(action.x), y: Math.round(action.y), count: 2, modifiers: held(action.keys) })
      return
    case 'drag': {
      const path = action.path.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      if (path.length < 2) throw new Error('drag needs a path of at least two points.')
      if (path.length === 2 || held(action.keys)) {
        await desktop.drag({ from: path[0]!, to: path[path.length - 1]!, modifiers: held(action.keys) })
        return
      }
      await desktop.move(path[0]!)
      await desktop.mouseDown()
      for (const point of path.slice(1)) await desktop.move(point)
      await desktop.mouseUp()
      return
    }
    case 'keypress':
      await desktop.key(combo(action.keys))
      return
    case 'move':
      await desktop.move({ x: Math.round(action.x), y: Math.round(action.y) })
      return
    case 'screenshot':
      return
    case 'scroll': {
      const at = { x: Math.round(action.x), y: Math.round(action.y), modifiers: held(action.keys) }
      if (action.scroll_y) {
        await desktop.scroll({ direction: action.scroll_y > 0 ? 'down' : 'up', amount: notches(action.scroll_y), ...at })
      }
      if (action.scroll_x) {
        await desktop.scroll({ direction: action.scroll_x > 0 ? 'right' : 'left', amount: notches(action.scroll_x), ...at })
      }
      return
    }
    case 'type':
      await desktop.type(action.text)
      return
    case 'wait':
      await sleep(options.waitMs ?? 1000)
      return
    default:
      throw new Error(`${(action as { type: string }).type} is not a computer action this desktop runs.`)
  }
}

/**
 * Runs a `computer_call`'s actions in order, then answers with its
 * `computer_call_output`: a screenshot of the screen as the actions left it.
 */
export async function computerCallOutput(
  desktop: ComputerDesktop,
  call: ComputerCallLike,
  options: ComputerCallOptions = {},
): Promise<ComputerCallOutput> {
  const pending = call.pending_safety_checks ?? []
  const acknowledged = new Set((options.acknowledgedSafetyChecks ?? []).map((check) => check.id))
  const unacknowledged = pending.filter((check) => !acknowledged.has(check.id))
  if (unacknowledged.length > 0) {
    throw new Error(
      `The call has safety checks nobody acknowledged: ${unacknowledged.map((c) => c.code ?? c.id).join(', ')}. ` +
        `Show them to a person and pass the approved ones as acknowledgedSafetyChecks.`,
    )
  }

  const actions = (call.actions ?? (call.action ? [call.action] : [])) as ReadonlyArray<ComputerAction>
  for (const action of actions) {
    await runComputerAction(desktop, action, options)
    await options.onAction?.(action)
  }

  const shot = await desktop.screenshot()
  const output: ComputerCallOutput = {
    type: 'computer_call_output',
    call_id: call.call_id,
    output: { type: 'computer_screenshot', image_url: `data:image/png;base64,${toBase64(shot.bytes)}` },
  }
  if (pending.length > 0) output.acknowledged_safety_checks = pending.map((check) => ({ ...check }))
  return output
}
