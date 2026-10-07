/**
 * The wire shapes a sandbox and its desktop answer with: the slice of
 * `types.ts` that `@divergentlabs/sandbox` publishes. It imports nothing, so
 * it can be copied out whole; `types.ts` re-exports it.
 */

export type SandboxSize = 'small' | 'standard' | 'large' | 'xl'

export type SandboxStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'resuming'
  | 'destroyed'
  | 'failed'

/**
 * A Linux machine an agent keeps using, on our own hosts. Not a run: it has
 * no exit, no result and no GPU, and it is billed from its own price table.
 */
export interface Sandbox {
  id: string
  name: string
  size: SandboxSize
  cpu: number
  memory_gib: number
  disk_gib: number
  cents_per_hour: number
  template: string
  status: SandboxStatus
  /** Why a stopped sandbox stopped: `requested`, `idle`, `limit_reached` or `agents_finished`. */
  stopped_reason: 'requested' | 'idle' | 'limit_reached' | 'agents_finished' | null
  error: string | null
  /** 0 means it runs until stopped. */
  idle_timeout_seconds: number
  /** Stops once its agents have finished and nothing has used it for two minutes. */
  stop_when_agents_finish: boolean
  /** The names of the secrets in its environment. Never their values. */
  secrets: string[]
  /** The environment `secrets` are read from. */
  environment: string
  /**
   * Labels the org set, such as which of its own users a sandbox serves. At
   * most 16 keys of `[a-z0-9_.-]`, each value at most 256 characters. `{}`
   * when none are set; a fork keeps its parent's.
   */
  metadata: Record<string, string>
  /** What a stopped sandbox keeps, and is charged for by the GiB-month. */
  snapshot_bytes: number | null
  cost_cents: number
  forked_from_id: string | null
  last_active_at: string | null
  started_at: string | null
  stopped_at: string | null
  destroyed_at: string | null
  inserted_at: string
}

/**
 * `GET` or `POST /sandboxes/:id/desktop`: whether the desktop runs, and where.
 * `size` is the screen as `WxH`, the pixel space every input takes.
 */
export type DesktopStatus =
  | { running: false }
  | {
      running: true
      size: string
      display: string
      vnc_port: number
      /** Chromium's DevTools, on the guest's loopback. Reach it with `div sandbox forward`. */
      devtools: string
      browser: string
    }

/** Keys held during a click, drag or scroll: any of shift, ctrl, alt and super, joined by `+`. */
export type DesktopModifiers = string

/**
 * `POST /sandboxes/:id/desktop/input`: one input, discriminated on `action`.
 * Positions are screen pixels, the same pixels a screenshot has.
 */
export type DesktopInput =
  | {
      action: 'click'
      /** Both or neither. Neither clicks where the pointer is. */
      x?: number
      y?: number
      button?: 'left' | 'middle' | 'right'
      count?: 1 | 2 | 3
      modifiers?: DesktopModifiers
    }
  | { action: 'move'; x: number; y: number }
  | { action: 'down' }
  | { action: 'up' }
  | { action: 'drag'; x: number; y: number; to_x: number; to_y: number; modifiers?: DesktopModifiers }
  | {
      action: 'scroll'
      direction: 'up' | 'down' | 'left' | 'right'
      /** 1 to 100 notches. 3 when left out. */
      amount?: number
      x?: number
      y?: number
      modifiers?: DesktopModifiers
    }
  | { action: 'type'; text: string }
  /** xdotool combos: `ctrl+l`, `Return`. `repeat` is 1 to 100. */
  | { action: 'key'; keys: string[]; repeat?: number }
  /** Holds the keys down for `seconds`, 0 to 300. */
  | { action: 'hold'; keys: string[]; seconds: number }
  | { action: 'cursor' }
  | { action: 'open'; urls: string[] }

/** What an input answers: the action done, or for `cursor`, where the pointer is. */
export type DesktopInputAnswer<A extends DesktopInput['action'] = DesktopInput['action']> = A extends 'cursor'
  ? { x: number; y: number }
  : { done: A }

/** `GET /sandboxes/:id/desktop/screenshot`: a PNG and its size in pixels. */
export interface DesktopScreenshot {
  bytes: Uint8Array<ArrayBuffer>
  width: number
  height: number
}

/** `POST /sandboxes/:id/desktop/accessibility`: what to do to a node of the tree. */
export interface AccessibilityAction {
  /** A node's `ref` from the tree, such as `n12`. */
  ref: string
  /** `press`, `focus`, `set-text`, `read`, or an action the node names itself. */
  action: 'press' | 'focus' | 'set-text' | 'read' | (string & {})
  /** The text for `set-text`. */
  text?: string
}

/** `view` watches the screen; `control` also sends input. `control` includes `view`. */
export type SandboxTokenAbility = 'view' | 'control'

/**
 * `POST /sandboxes/:id/tokens`: a token for one sandbox's desktop and screen,
 * and nothing else. Shown once.
 */
export interface SandboxToken {
  /** `dvs_…`. */
  token: string
  /** The sandbox's id. */
  sandbox: string
  abilities: SandboxTokenAbility[]
  /** The browser origins it is good from. Empty: it is refused from any browser. */
  origins: string[]
  expires_at: string
}

/** `POST /sandboxes/:id/exec`: the command's own exit code and output. */
export interface SandboxExec {
  exit_code: number
  stdout: string
  stderr: string
  /** A stream passed a megabyte and was cut. */
  truncated: boolean
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    fields?: Record<string, string[]>
    [key: string]: unknown
  }
}
