import type {
  AccessibilityAction,
  DesktopModifiers,
  DesktopScreenshot,
  DesktopStatus,
  SandboxClient,
} from './wire.ts'

/** A position on the screen, in screen pixels: the pixels a screenshot has. */
export interface Point {
  x: number
  y: number
}

export type MouseButton = 'left' | 'middle' | 'right'
export type ScrollDirection = 'up' | 'down' | 'left' | 'right'
export type Region = readonly [x0: number, y0: number, x1: number, y1: number]

/**
 * What the model adapters drive. `Desktop` is one; anything with these
 * methods is another, which is how the adapters are tested without a sandbox.
 */
export interface ComputerDesktop {
  start(options?: { resolution?: string }): Promise<DesktopStatus>
  status(): Promise<DesktopStatus>
  screenshot(options?: { region?: Region }): Promise<DesktopScreenshot>
  click(options?: { x?: number; y?: number; button?: MouseButton; count?: 1 | 2 | 3; modifiers?: DesktopModifiers }): Promise<void>
  move(point: Point): Promise<void>
  mouseDown(): Promise<void>
  mouseUp(): Promise<void>
  drag(options: { from: Point; to: Point; modifiers?: DesktopModifiers }): Promise<void>
  scroll(options: { direction: ScrollDirection; amount?: number; x?: number; y?: number; modifiers?: DesktopModifiers }): Promise<void>
  type(text: string): Promise<void>
  key(keys: string | string[], options?: { repeat?: number }): Promise<void>
  hold(keys: string | string[], seconds: number): Promise<void>
  cursor(): Promise<Point>
}

/**
 * One sandbox's desktop: Chromium on a Linux screen, 1280x800 unless started
 * at another resolution.
 *
 * Reached with an org API key through `sandbox.desktop`, or with a sandbox
 * token through `Divergent.fromToken`. A `view` token reads `status` and
 * `screenshot`; everything else takes `control`. Every method rejects with
 * `ApiError`: `no_desktop` when the desktop is not running (call `start`),
 * `desktop_outdated` for an action the sandbox's image predates (make a new
 * sandbox), `not_running` when the sandbox is stopped (resume it).
 */
export class Desktop implements ComputerDesktop {
  /** Reads and acts on the accessibility tree: text, far cheaper for a model than a screenshot. */
  readonly accessibility: {
    tree(options?: { app?: string; depth?: number; includeHidden?: boolean }): Promise<unknown>
    act(action: AccessibilityAction): Promise<unknown>
  }

  constructor(
    private readonly client: SandboxClient,
    /** The sandbox's id. */
    readonly sandbox: string,
  ) {
    this.accessibility = {
      tree: (options = {}) =>
        client.accessibilityTree(sandbox, {
          app: options.app,
          depth: options.depth,
          include_hidden: options.includeHidden,
        }),
      act: (action) => client.accessibilityAction(sandbox, action),
    }
  }

  /** Starts the desktop, or answers with the one running. Resolves once the browser is ready. */
  start(options: { resolution?: string } = {}) {
    return this.client.desktop(this.sandbox, { action: 'start', resolution: options.resolution })
  }

  stop() {
    return this.client.desktop(this.sandbox, { action: 'stop' })
  }

  status() {
    return this.client.desktopStatus(this.sandbox)
  }

  /**
   * The screen as a PNG. With `region`, that rectangle of the screen scaled
   * up to the screen's size, keeping its aspect ratio.
   */
  screenshot(options: { region?: Region } = {}) {
    return this.client.desktopScreenshot(this.sandbox, { region: options.region })
  }

  /** Clicks at `x, y`, or where the pointer is when both are left out. `count` 2 is a double click. */
  async click(
    options: { x?: number; y?: number; button?: MouseButton; count?: 1 | 2 | 3; modifiers?: DesktopModifiers } = {},
  ) {
    await this.client.desktopInput(this.sandbox, { action: 'click', ...options })
  }

  async move({ x, y }: Point) {
    await this.client.desktopInput(this.sandbox, { action: 'move', x, y })
  }

  /** Presses the left button where the pointer is, and holds it. */
  async mouseDown() {
    await this.client.desktopInput(this.sandbox, { action: 'down' })
  }

  async mouseUp() {
    await this.client.desktopInput(this.sandbox, { action: 'up' })
  }

  async drag({ from, to, modifiers }: { from: Point; to: Point; modifiers?: DesktopModifiers }) {
    await this.client.desktopInput(this.sandbox, {
      action: 'drag',
      x: from.x,
      y: from.y,
      to_x: to.x,
      to_y: to.y,
      modifiers,
    })
  }

  /** Scrolls `amount` notches (3 when left out), at `x, y` or where the pointer is. */
  async scroll(options: {
    direction: ScrollDirection
    amount?: number
    x?: number
    y?: number
    modifiers?: DesktopModifiers
  }) {
    await this.client.desktopInput(this.sandbox, { action: 'scroll', ...options })
  }

  async type(text: string) {
    await this.client.desktopInput(this.sandbox, { action: 'type', text })
  }

  /** Presses xdotool combos in turn: `"ctrl+l"`, `["ctrl+a", "BackSpace"]`. */
  async key(keys: string | string[], options: { repeat?: number } = {}) {
    await this.client.desktopInput(this.sandbox, { action: 'key', keys: list(keys), repeat: options.repeat })
  }

  /** Holds the keys down for `seconds`, 0 to 300. */
  async hold(keys: string | string[], seconds: number) {
    await this.client.desktopInput(this.sandbox, { action: 'hold', keys: list(keys), seconds })
  }

  /** Where the pointer is. */
  cursor() {
    return this.client.desktopInput(this.sandbox, { action: 'cursor' })
  }

  /** Opens each URL in Chromium. */
  async open(urls: string | string[]) {
    await this.client.desktopInput(this.sandbox, { action: 'open', urls: list(urls) })
  }
}

function list(value: string | string[]) {
  return typeof value === 'string' ? [value] : value
}
