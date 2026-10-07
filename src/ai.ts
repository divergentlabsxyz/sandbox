/**
 * AI SDK tools for a sandbox's desktop.
 *
 * ```ts
 * const result = await generateText({ model, tools: computerTools(sandbox.desktop), prompt })
 * ```
 *
 * Positions are screen pixels, the pixels the screenshot tool returns.
 */

import { jsonSchema, tool, type Tool } from 'ai'
import type { ComputerDesktop } from './desktop.ts'
import { toBase64 } from './image.ts'

const point = {
  x: { type: 'integer', description: 'Pixels from the left edge of the screenshot.' },
  y: { type: 'integer', description: 'Pixels from the top edge of the screenshot.' },
} as const

const modifiers = {
  type: 'string',
  description: 'Keys held during the action: any of shift, ctrl, alt and super, joined by +.',
} as const

/** The screenshot tool's output: a base64 PNG and its size. */
export interface ScreenshotOutput {
  data: string
  mediaType: 'image/png'
  width: number
  height: number
}

type Modifiers = { modifiers?: string }

export interface ComputerTools {
  screenshot: Tool<Record<string, never>, ScreenshotOutput>
  click: Tool<{ x: number; y: number; button?: 'left' | 'middle' | 'right'; count?: 1 | 2 | 3 } & Modifiers, string>
  type: Tool<{ text: string }, string>
  key: Tool<{ keys: string[]; repeat?: number }, string>
  scroll: Tool<{ direction: 'up' | 'down' | 'left' | 'right'; amount?: number; x?: number; y?: number } & Modifiers, string>
  move: Tool<{ x: number; y: number }, string>
  drag: Tool<{ x: number; y: number; to_x: number; to_y: number } & Modifiers, string>
}

/** `screenshot`, `click`, `type`, `key`, `scroll`, `move` and `drag`, for `generateText` or `streamText`. */
export function computerTools(desktop: ComputerDesktop): ComputerTools {
  return {
    screenshot: tool({
      description: 'Takes a screenshot of the desktop. Every position the other tools take is a pixel of it.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async (): Promise<ScreenshotOutput> => {
        const shot = await desktop.screenshot()
        return { data: toBase64(shot.bytes), mediaType: 'image/png', width: shot.width, height: shot.height }
      },
      toModelOutput: ({ output }: { output: ScreenshotOutput }) => ({
        type: 'content' as const,
        value: [
          { type: 'text' as const, text: `Screenshot, ${output.width}x${output.height}.` },
          { type: 'file' as const, mediaType: 'image/png', data: { type: 'data' as const, data: output.data } },
        ],
      }),
    }),

    click: tool({
      description: 'Clicks at a position. count 2 is a double click, 3 a triple click.',
      inputSchema: jsonSchema<{ x: number; y: number; button?: 'left' | 'middle' | 'right'; count?: 1 | 2 | 3; modifiers?: string }>({
        type: 'object',
        properties: {
          ...point,
          button: { type: 'string', enum: ['left', 'middle', 'right'] },
          count: { type: 'integer', enum: [1, 2, 3] },
          modifiers,
        },
        required: ['x', 'y'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        await desktop.click(input)
        return 'OK'
      },
    }),

    type: tool({
      description: 'Types text where the keyboard focus is.',
      inputSchema: jsonSchema<{ text: string }>({
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      }),
      execute: async ({ text }) => {
        await desktop.type(text)
        return 'OK'
      },
    }),

    key: tool({
      description: 'Presses xdotool key combos in turn, such as ["ctrl+l"] or ["Return"].',
      inputSchema: jsonSchema<{ keys: string[]; repeat?: number }>({
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string' }, minItems: 1 },
          repeat: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['keys'],
        additionalProperties: false,
      }),
      execute: async ({ keys, repeat }) => {
        await desktop.key(keys, { repeat })
        return 'OK'
      },
    }),

    scroll: tool({
      description: 'Scrolls by notches of the wheel, at a position or where the pointer is.',
      inputSchema: jsonSchema<{ direction: 'up' | 'down' | 'left' | 'right'; amount?: number; x?: number; y?: number; modifiers?: string }>({
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          amount: { type: 'integer', minimum: 1, maximum: 100, description: 'Notches. 3 when left out.' },
          ...point,
          modifiers,
        },
        required: ['direction'],
        additionalProperties: false,
      }),
      execute: async (input) => {
        await desktop.scroll(input)
        return 'OK'
      },
    }),

    move: tool({
      description: 'Moves the pointer to a position.',
      inputSchema: jsonSchema<{ x: number; y: number }>({
        type: 'object',
        properties: point,
        required: ['x', 'y'],
        additionalProperties: false,
      }),
      execute: async ({ x, y }) => {
        await desktop.move({ x, y })
        return 'OK'
      },
    }),

    drag: tool({
      description: 'Drags with the left button from one position to another.',
      inputSchema: jsonSchema<{ x: number; y: number; to_x: number; to_y: number; modifiers?: string }>({
        type: 'object',
        properties: {
          ...point,
          to_x: { type: 'integer' },
          to_y: { type: 'integer' },
          modifiers,
        },
        required: ['x', 'y', 'to_x', 'to_y'],
        additionalProperties: false,
      }),
      execute: async ({ x, y, to_x, to_y, modifiers }) => {
        await desktop.drag({ from: { x, y }, to: { x: to_x, y: to_y }, modifiers })
        return 'OK'
      },
    }),
  }
}
