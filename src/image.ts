/** Base64 without Buffer, so the adapters run in a browser and on any server runtime. */
export function toBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Shrinks a PNG to `width` by `height`. Supply one for a runtime without
 * `OffscreenCanvas`, such as Node, if the desktop is larger than a model
 * takes (sharp, for example: `(png, w, h) => sharp(png).resize(w, h).png().toBuffer()`).
 */
export type ResizePng = (png: Uint8Array, width: number, height: number) => Promise<Uint8Array>

/** `OffscreenCanvas` where the runtime has one. */
export async function resizeWithCanvas(png: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const scope = globalThis as unknown as {
    OffscreenCanvas?: new (w: number, h: number) => {
      getContext(kind: '2d'): { drawImage(image: unknown, x: number, y: number, w: number, h: number): void } | null
      convertToBlob(options: { type: string }): Promise<Blob>
    }
    createImageBitmap?: (blob: Blob) => Promise<unknown>
  }
  if (!scope.OffscreenCanvas || !scope.createImageBitmap) {
    throw new Error(
      `The screen is larger than 2000 px a side and this runtime cannot resize a screenshot. ` +
        `Start the desktop at 1920x1080 or smaller, or pass a resize function.`,
    )
  }
  const bitmap = await scope.createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  const canvas = new scope.OffscreenCanvas(width, height)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

/** The longest side a screenshot may have for Claude. */
export const MAX_SIDE = 2000

/**
 * The factor screen pixels are divided by to reach the model's pixels: 1
 * unless the longer side passes `max`.
 */
export function scaleFor(width: number, height: number, max = MAX_SIDE) {
  const longer = Math.max(width, height)
  return longer > max ? longer / max : 1
}

/** `"1280x800"` to its two numbers, or null. */
export function parseSize(size: string | undefined) {
  const match = /^(\d+)x(\d+)$/.exec(size ?? '')
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
