import { ApiError } from './wire.ts'
import type { DesktopStatus } from './wire.ts'
import type { ComputerDesktop, Point } from './desktop.ts'

/** A desktop that records what it was asked and answers from a script. */
export function fakeDesktop(options: { size?: [number, number]; running?: boolean; fail?: string; cursor?: Point } = {}) {
  const [width, height] = options.size ?? [1280, 800]
  let running = options.running ?? true
  const calls: Array<[string, ...unknown[]]> = []
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  const status = (): DesktopStatus =>
    running
      ? { running: true, size: `${width}x${height}`, display: ':1', vnc_port: 5900, devtools: 'http://127.0.0.1:9222', browser: 'chromium' }
      : { running: false }

  function record(name: string, ...args: unknown[]) {
    calls.push([name, ...args])
    if (options.fail === name) throw new ApiError(409, { code: 'refused', message: `${name} was refused.` })
  }

  const desktop: ComputerDesktop = {
    async start(o) {
      record('start', o)
      running = true
      return status()
    },
    async status() {
      record('status')
      return status()
    },
    async screenshot(o = {}) {
      record('screenshot', o)
      if (!running) throw new ApiError(409, { code: 'no_desktop', message: 'No desktop is running.' })
      return { bytes: png as Uint8Array<ArrayBuffer>, width, height }
    },
    async click(o) { record('click', o) },
    async move(p) { record('move', p) },
    async mouseDown() { record('mouseDown') },
    async mouseUp() { record('mouseUp') },
    async drag(o) { record('drag', o) },
    async scroll(o) { record('scroll', o) },
    async type(t) { record('type', t) },
    async key(k, o) { record('key', k, o) },
    async hold(k, s) { record('hold', k, s) },
    async cursor() {
      record('cursor')
      return options.cursor ?? { x: 512, y: 384 }
    },
  }
  return { desktop, calls }
}
