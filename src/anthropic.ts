/**
 * Claude's computer toolset, `computer_toolset_20260801`, on a sandbox's desktop.
 *
 * ```ts
 * const toolset = computerToolset(sandbox.desktop)
 * const response = await anthropic.messages.create({ ..., tools: [toolset.tool] })
 * messages.push({ role: 'assistant', content: response.content })
 * messages.push({ role: 'user', content: await toolset.run(response.content) })
 * ```
 *
 * The types here are structural, so `@anthropic-ai/sdk` stays optional: an
 * SDK `Message['content']` goes into `run`, and what comes out is assignable
 * to `ToolResultBlockParam[]`.
 */

import { ApiError } from './wire.ts'
import type { ComputerDesktop, MouseButton, ScrollDirection } from './desktop.ts'
import { MAX_SIDE, parseSize, resizeWithCanvas, scaleFor, sleep, toBase64, type ResizePng } from './image.ts'

/** The toolset's family name. Every call carries it, and every result must echo it. */
export const TOOLSET_NAME = 'computer'

/** What a later call in a batch answers once an earlier one has failed. */
export const NOT_EXECUTED = 'Not executed: an earlier computer action in this turn failed.'

/** Any block of an assistant message. Only computer `tool_use` blocks are read. */
export interface ContentBlockLike {
  type: string
  id?: string
  name?: string
  input?: unknown
  toolset_name?: string | null
}

export type ComputerToolResultContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
    >

/** One `tool_result` block, ready for the next user message. */
export interface ComputerToolResult {
  type: 'tool_result'
  tool_use_id: string
  toolset_name: typeof TOOLSET_NAME
  content: ComputerToolResultContent
  is_error?: boolean
}

/** A screenshot as the model received it: base64 PNG, in the model's pixels. */
export interface StepScreenshot {
  data: string
  width: number
  height: number
}

/** One executed call, for a step log beside the live screen. */
export interface ComputerStep {
  name: string
  input: Record<string, unknown>
  /** For `screenshot` and `zoom`. */
  screenshot?: StepScreenshot
  /** Set when the call failed. */
  error?: string
}

export interface ComputerToolsetOptions {
  /** Called after each call runs, in order, failures included. Calls not executed are not reported. */
  onAction?: (step: ComputerStep) => void | Promise<void>
  /** Shrinks screenshots of a desktop larger than 2000 px a side. `OffscreenCanvas` when left out. */
  resize?: ResizePng
}

/** The 17 members of `computer_toolset_20260801`. */
export const MEMBERS = [
  'screenshot',
  'zoom',
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
  'left_click_drag',
  'mouse_move',
  'left_mouse_down',
  'left_mouse_up',
  'cursor_position',
  'scroll',
  'type',
  'key',
  'hold_key',
  'wait',
] as const

export type ComputerMember = (typeof MEMBERS)[number]

const CLICKS: Record<string, { button: MouseButton; count: 1 | 2 | 3 }> = {
  left_click: { button: 'left', count: 1 },
  right_click: { button: 'right', count: 1 },
  middle_click: { button: 'middle', count: 1 },
  double_click: { button: 'left', count: 2 },
  triple_click: { button: 'left', count: 3 },
}

/** Claude's modifier names, as the desktop takes them. */
const MODIFIERS: Record<string, string> = {
  shift: 'shift',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  super: 'super',
  meta: 'super',
  cmd: 'super',
  command: 'super',
  win: 'super',
  windows: 'super',
}

class StepError extends Error {}

/**
 * Runs Claude's computer calls on a desktop. Keep one per conversation: it
 * remembers the screen's size between turns.
 */
export function computerToolset(desktop: ComputerDesktop, options: ComputerToolsetOptions = {}) {
  const resize = options.resize ?? resizeWithCanvas
  // Screen pixels per model pixel. Unknown until a screenshot or a status says.
  let scale: number | null = null

  async function knownScale() {
    if (scale === null) {
      const status = await desktop.status()
      const size = status.running ? parseSize(status.size) : null
      scale = size ? scaleFor(size.width, size.height) : 1
    }
    return scale
  }

  async function toScreen(value: unknown, field: string, member: string) {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      throw new StepError(`${member} takes ${field} as [x, y].`)
    }
    const s = await knownScale()
    return { x: Math.round(value[0] * s), y: Math.round(value[1] * s) }
  }

  async function capture(region?: readonly [number, number, number, number]): Promise<StepScreenshot> {
    let shot
    try {
      shot = await desktop.screenshot({ region })
    } catch (error) {
      // The model's first look at a desktop nobody started yet.
      if (!(error instanceof ApiError && error.code === 'no_desktop')) throw error
      await desktop.start()
      shot = await desktop.screenshot({ region })
    }
    // A zoom is scaled up to the screen's size, so it says the screen's size too.
    // A whole screen sets the scale; a zoom fits its own image and leaves it be.
    const fit = scaleFor(shot.width, shot.height)
    if (!region) scale = fit
    if (fit === 1) return { data: toBase64(shot.bytes), width: shot.width, height: shot.height }
    const width = Math.round(shot.width / fit)
    const height = Math.round(shot.height / fit)
    return { data: toBase64(await resize(shot.bytes, width, height)), width, height }
  }

  function modifiers(value: unknown, member: string) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw new StepError(`${member} takes text as the keys to hold, such as "shift".`)
    const keys = value
      .toLowerCase()
      .split(/[+\s]+/)
      .filter(Boolean)
      .map((key) => {
        const known = MODIFIERS[key]
        if (!known) throw new StepError(`${member} cannot hold ${key}. Hold any of shift, ctrl, alt and super.`)
        return known
      })
    return keys.join('+')
  }

  function text(value: unknown, member: string) {
    if (typeof value !== 'string' || value === '') throw new StepError(`${member} takes text.`)
    return value
  }

  function seconds(value: unknown, member: string) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 300) {
      throw new StepError(`${member} takes a duration of 0 to 300 seconds.`)
    }
    return value
  }

  /** One call. Answers the result's content; throws to fail it. */
  async function execute(name: string, input: Record<string, unknown>, step: ComputerStep) {
    const click = CLICKS[name]
    if (click) {
      const at = input.coordinate === undefined ? {} : await toScreen(input.coordinate, 'coordinate', name)
      await desktop.click({ ...at, ...click, modifiers: modifiers(input.text, name) })
      return 'OK'
    }

    switch (name) {
      case 'screenshot': {
        step.screenshot = await capture()
        return image(step.screenshot)
      }
      case 'zoom': {
        const region = input.region
        if (
          !Array.isArray(region) ||
          region.length !== 4 ||
          !region.every((n) => typeof n === 'number' && Number.isFinite(n))
        ) {
          throw new StepError('zoom takes region as [x0, y0, x1, y1].')
        }
        const s = await knownScale()
        const [x0, y0, x1, y1] = region.map((n: number) => Math.round(n * s))
        step.screenshot = await capture([x0!, y0!, x1!, y1!])
        return image(step.screenshot)
      }
      case 'left_click_drag': {
        const from = await toScreen(input.start_coordinate, 'start_coordinate', name)
        const to = await toScreen(input.coordinate, 'coordinate', name)
        await desktop.drag({ from, to, modifiers: modifiers(input.text, name) })
        return 'OK'
      }
      case 'mouse_move':
        await desktop.move(await toScreen(input.coordinate, 'coordinate', name))
        return 'OK'
      case 'left_mouse_down':
        await desktop.mouseDown()
        return 'OK'
      case 'left_mouse_up':
        await desktop.mouseUp()
        return 'OK'
      case 'cursor_position': {
        const at = await desktop.cursor()
        const s = await knownScale()
        return `X=${Math.round(at.x / s)}, Y=${Math.round(at.y / s)}`
      }
      case 'scroll': {
        const direction = input.scroll_direction
        if (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right') {
          throw new StepError('scroll takes scroll_direction as up, down, left or right.')
        }
        const amount = input.scroll_amount
        if (amount !== undefined && (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100)) {
          throw new StepError('scroll takes scroll_amount as a whole number from 1 to 100.')
        }
        const at = input.coordinate === undefined ? {} : await toScreen(input.coordinate, 'coordinate', name)
        await desktop.scroll({
          direction: direction as ScrollDirection,
          amount: amount as number | undefined,
          ...at,
          modifiers: modifiers(input.text, name),
        })
        return 'OK'
      }
      case 'type':
        await desktop.type(text(input.text, name))
        return 'OK'
      case 'key': {
        const repeat = input.repeat
        if (repeat !== undefined && (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1 || repeat > 100)) {
          throw new StepError('key takes repeat as a whole number from 1 to 100.')
        }
        await desktop.key(text(input.text, name).trim().split(/\s+/), { repeat: repeat as number | undefined })
        return 'OK'
      }
      case 'hold_key':
        await desktop.hold(text(input.text, name).trim().split(/\s+/), seconds(input.duration, name))
        return 'OK'
      case 'wait':
        await sleep(seconds(input.duration, name) * 1000)
        return 'OK'
      default:
        throw new StepError(`${name} is not a member of computer_toolset_20260801.`)
    }
  }

  return {
    /** The `tools` entry. It takes no name and no display size. */
    tool: { type: 'computer_toolset_20260801' as const },

    /**
     * Runs every computer `tool_use` in an assistant message's content, in
     * order, and answers one `tool_result` per call. After the first failure
     * the rest are answered as not executed.
     */
    async run(content: ReadonlyArray<ContentBlockLike>): Promise<ComputerToolResult[]> {
      const results: ComputerToolResult[] = []
      let failed = false

      for (const block of content) {
        if (block.type !== 'tool_use' || block.toolset_name !== TOOLSET_NAME || !block.id) continue
        const name = block.name ?? ''

        if (failed) {
          results.push(failure(block.id, NOT_EXECUTED))
          continue
        }

        const input = (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>
        const step: ComputerStep = { name, input }
        try {
          const answer = await execute(name, input, step)
          results.push({ type: 'tool_result', tool_use_id: block.id, toolset_name: TOOLSET_NAME, content: answer })
        } catch (error) {
          failed = true
          step.error = message(error)
          results.push(failure(block.id, step.error))
        }
        await options.onAction?.(step)
      }

      return results
    },
  }
}

function image(shot: StepScreenshot): ComputerToolResultContent {
  return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot.data } }]
}

function failure(id: string, text: string): ComputerToolResult {
  return { type: 'tool_result', tool_use_id: id, toolset_name: TOOLSET_NAME, content: text, is_error: true }
}

function message(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'The computer action failed.'
}

export { MAX_SIDE }
export type { ResizePng }
