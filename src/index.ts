import { SandboxClient } from './wire.ts'
import type {
  Sandbox as SandboxData,
  SandboxExec,
  SandboxSize,
  SandboxStatus,
  SandboxToken,
  SandboxTokenAbility,
} from './wire.ts'
import { Desktop } from './desktop.ts'
import { DEFAULT_BASE_URL, screenUrl } from './urls.ts'

export { ApiError } from './wire.ts'
export type {
  AccessibilityAction,
  DesktopInput,
  DesktopModifiers,
  DesktopScreenshot,
  DesktopStatus,
  Sandbox as SandboxData,
  SandboxExec,
  SandboxSize,
  SandboxStatus,
  SandboxToken,
  SandboxTokenAbility,
} from './wire.ts'
export { Desktop } from './desktop.ts'
export type { ComputerDesktop, MouseButton, Point, Region, ScrollDirection } from './desktop.ts'

export { DEFAULT_BASE_URL, screenUrl } from './urls.ts'

export interface DivergentOptions {
  /** An org API key, `dv_live_…`, with `sandboxes:write`. Keep it on your server. */
  apiKey: string
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export interface CreateSandboxOptions {
  size?: SandboxSize
  name?: string
  /** At most 16 keys of `[a-z0-9_.-]`, each value at most 256 characters. */
  metadata?: Record<string, string>
  /** How long it may sit idle before it stops. 0 is never. */
  idleTimeoutSeconds?: number
  /** A retried create with the same key answers with the sandbox the first one made. */
  idempotencyKey?: string
}

/**
 * The Divergent API with an org key, for your server.
 *
 * A sandbox made here names no secrets, so a token can be minted for it: a
 * model reading untrusted pages, or a person who takes control, can read
 * anything in the guest.
 */
export class Divergent {
  readonly sandboxes: Sandboxes
  /** The typed client underneath, for the sandbox routes this package does not wrap. */
  readonly client: SandboxClient

  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch }: DivergentOptions) {
    if (!apiKey) throw new Error('Divergent needs an apiKey. Create one in the dashboard under Settings, API keys.')
    this.client = new SandboxClient({ baseUrl, token: apiKey, fetch })
    this.sandboxes = new Sandboxes(this.client)
  }

  /**
   * A client for one sandbox's desktop and screen, from a sandbox token. Safe
   * to hold in a browser: the token reaches no other route.
   *
   * Takes what `sandbox.createToken` answers, or the token and the sandbox's id.
   */
  static fromToken(
    grant: string | Pick<SandboxToken, 'token' | 'sandbox'>,
    options: { sandbox?: string; baseUrl?: string; fetch?: typeof globalThis.fetch } = {},
  ) {
    const token = typeof grant === 'string' ? grant : grant.token
    const sandbox = typeof grant === 'string' ? options.sandbox : grant.sandbox
    if (!sandbox) throw new Error('fromToken needs the sandbox id. Pass { token, sandbox } as createToken answered it.')
    return new SandboxTokenClient(token, sandbox, options.baseUrl ?? DEFAULT_BASE_URL, options.fetch)
  }
}

/** One sandbox's desktop and screen, reached with a sandbox token. */
export class SandboxTokenClient {
  readonly desktop: Desktop
  /** The screen's WebSocket URL, token included. `mountScreen` connects to it. */
  readonly screenUrl: string

  constructor(
    readonly token: string,
    /** The sandbox's id. */
    readonly sandbox: string,
    readonly baseUrl: string = DEFAULT_BASE_URL,
    fetch?: typeof globalThis.fetch,
  ) {
    const client = new SandboxClient({ baseUrl, token, fetch })
    this.desktop = new Desktop(client, sandbox)
    this.screenUrl = screenUrl(baseUrl, sandbox, token)
  }
}

export class Sandboxes {
  constructor(private readonly client: SandboxClient) {}

  /** Makes a sandbox and answers once it runs. It names no secrets. */
  async create(options: CreateSandboxOptions = {}) {
    const data = await this.client.createSandbox(
      {
        name: options.name,
        size: options.size,
        metadata: options.metadata,
        idle_timeout_seconds: options.idleTimeoutSeconds,
      },
      options.idempotencyKey,
    )
    return new Sandbox(this.client, data)
  }

  /** By id or name. */
  async get(idOrName: string) {
    return new Sandbox(this.client, await this.client.sandbox(idOrName))
  }

  /** Newest first. Destroyed ones only with `all`; with `metadata`, only those carrying every pair. */
  async list(options: { metadata?: Record<string, string>; all?: boolean } = {}) {
    const rows = await this.client.sandboxes({ metadata: options.metadata, all: options.all || undefined })
    return rows.map((data) => new Sandbox(this.client, data))
  }
}

/**
 * A sandbox, as the API last described it. `stop`, `resume`, `destroy` and
 * `refresh` update `data`; nothing else does.
 */
export class Sandbox {
  readonly desktop: Desktop
  readonly files: {
    read(path: string): Promise<Uint8Array<ArrayBuffer>>
    write(path: string, contents: string | Uint8Array<ArrayBuffer>): Promise<{ path: string; size_bytes: number }>
  }

  constructor(
    private readonly client: SandboxClient,
    public data: SandboxData,
  ) {
    this.desktop = new Desktop(client, data.id)
    this.files = {
      read: (path) => client.getSandboxFile(data.id, path),
      write: async (path, contents) => {
        const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents
        return (await client.putSandboxFile(data.id, path, bytes as Uint8Array<ArrayBuffer>)).data
      },
    }
  }

  get id() {
    return this.data.id
  }

  get name() {
    return this.data.name
  }

  get status(): SandboxStatus {
    return this.data.status
  }

  get metadata() {
    return this.data.metadata
  }

  /** Runs one command as root and answers when it has finished, with its own exit code. */
  exec(command: string, options: { cwd?: string; env?: Record<string, string>; timeoutSeconds?: number } = {}): Promise<SandboxExec> {
    return this.client.exec(this.id, {
      command,
      cwd: options.cwd,
      env: options.env,
      timeout_seconds: options.timeoutSeconds,
    })
  }

  /**
   * A token for this sandbox's desktop and screen, and no other route. Hand
   * it to a browser; keep the org key on your server. `expiresIn` is 60 to
   * 3600 seconds, 900 when left out. `origins` lists the pages that may use
   * it; a browser is refused without them.
   */
  createToken(options: { abilities: SandboxTokenAbility[]; expiresIn?: number; origins?: string[] }) {
    return this.client.createSandboxToken(this.id, {
      abilities: options.abilities,
      expires_in: options.expiresIn,
      origins: options.origins,
    })
  }

  async refresh() {
    this.data = await this.client.sandbox(this.id)
    return this
  }

  /**
   * Changes what may change after create. `metadata` replaces every label;
   * `{}` removes them all.
   */
  async update(changes: { metadata?: Record<string, string>; idleTimeoutSeconds?: number }) {
    this.data = await this.client.updateSandbox(this.id, {
      ...(changes.metadata !== undefined && { metadata: changes.metadata }),
      ...(changes.idleTimeoutSeconds !== undefined && { idle_timeout_seconds: changes.idleTimeoutSeconds }),
    })
    return this
  }

  /** Stops it and keeps its disk. `resume` starts it again where it stopped. */
  async stop() {
    this.data = await this.client.stopSandbox(this.id)
    return this
  }

  async resume() {
    this.data = await this.client.resumeSandbox(this.id)
    return this
  }

  /** A new sandbox from this one's disk, with the same metadata. */
  async fork(options: { name?: string } = {}) {
    return new Sandbox(this.client, await this.client.forkSandbox(this.id, options))
  }

  async destroy() {
    this.data = await this.client.destroySandbox(this.id)
    return this
  }
}
