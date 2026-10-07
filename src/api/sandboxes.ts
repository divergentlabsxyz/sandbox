import type {
  AccessibilityAction,
  DesktopInput,
  DesktopInputAnswer,
  DesktopScreenshot,
  DesktopStatus,
  Sandbox,
  SandboxExec,
  SandboxSize,
  SandboxToken,
  SandboxTokenAbility,
} from './sandbox-types.ts'
import { Transport } from './transport.ts'

/**
 * A sandbox, its desktop and its files: the routes `@divergentlabs/sandbox`
 * drives, and the slice of the client it publishes. Like `sandbox-types.ts`,
 * it imports nothing beyond the two files beside it, so the three can be
 * copied out whole. `client.ts` extends it with the rest of the API.
 */
export class SandboxClient extends Transport {
  // ---- sandboxes

  /**
   * The org's sandboxes, newest first; destroyed ones only with `all`. With
   * `metadata`, only those carrying every key with that value.
   */
  async sandboxes(query: { all?: boolean; status?: string; metadata?: Record<string, string> } = {}) {
    const { metadata, ...rest } = query
    const flat: Record<string, unknown> = { ...rest }
    for (const [key, value] of Object.entries(metadata ?? {})) flat[`metadata[${key}]`] = value
    return (await this.request<{ data: Sandbox[] }>('GET', '/sandboxes', { query: flat })).data
  }

  async sandbox(idOrName: string) {
    return (await this.request<{ data: Sandbox }>('GET', `/sandboxes/${encodeURIComponent(idOrName)}`)).data
  }

  /**
   * Makes a sandbox and starts it. `idempotencyKey` makes a retried create
   * answer with the sandbox the first one made rather than a second one.
   */
  async createSandbox(
    body: {
      name?: string
      size?: SandboxSize
      secrets?: string[]
      /** Where `secrets` are read from; `default` unless given. */
      environment?: string
      idle_timeout_seconds?: number
      /** Stops once its agents have finished and nothing has used it for two minutes. */
      stop_when_agents_finish?: boolean
      /** At most 16 keys of `[a-z0-9_.-]`, each value at most 256 characters. */
      metadata?: Record<string, string>
    } = {},
    idempotencyKey?: string,
  ) {
    return (
      await this.request<{ data: Sandbox }>('POST', '/sandboxes', {
        body,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
    ).data
  }

  /**
   * Changes how long it may sit idle before it stops (0 is never), whether
   * it stops once its agents have finished, and its metadata, which is
   * replaced whole.
   */
  async updateSandbox(
    idOrName: string,
    body: { idle_timeout_seconds?: number; stop_when_agents_finish?: boolean; metadata?: Record<string, string> },
  ) {
    return (
      await this.request<{ data: Sandbox }>('PATCH', `/sandboxes/${encodeURIComponent(idOrName)}`, { body })
    ).data
  }

  async stopSandbox(idOrName: string) {
    return (await this.request<{ data: Sandbox }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/stop`)).data
  }

  async resumeSandbox(idOrName: string) {
    return (await this.request<{ data: Sandbox }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/resume`)).data
  }

  async forkSandbox(idOrName: string, body: { name?: string } = {}) {
    return (
      await this.request<{ data: Sandbox }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/fork`, { body })
    ).data
  }

  async destroySandbox(idOrName: string) {
    return (await this.request<{ data: Sandbox }>('DELETE', `/sandboxes/${encodeURIComponent(idOrName)}`)).data
  }

  /** Runs one command and answers when it has finished, with its own exit code. */
  async exec(
    idOrName: string,
    body: { command: string; cwd?: string; env?: Record<string, string>; timeout_seconds?: number },
  ) {
    return (
      await this.request<{ data: SandboxExec }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/exec`, { body })
    ).data
  }

  /**
   * A token for this sandbox's desktop routes and screen, and no other route.
   * `expires_in` is 60 to 3600 seconds, 900 when left out. `origins` are the
   * browser origins it is good from; without them a browser is refused.
   * Refused as `sandbox_has_secrets` for a sandbox that names secrets.
   */
  async createSandboxToken(
    idOrName: string,
    body: { abilities: SandboxTokenAbility[]; expires_in?: number; origins?: string[] },
  ) {
    return (
      await this.request<{ data: SandboxToken }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/tokens`, {
        body,
      })
    ).data
  }

  // ---- a sandbox's desktop

  async desktopStatus(idOrName: string) {
    return (
      await this.request<{ data: DesktopStatus }>('GET', `/sandboxes/${encodeURIComponent(idOrName)}/desktop`)
    ).data
  }

  /**
   * Starts or stops the desktop. `start` answers once the browser is ready,
   * within about a minute; `resolution` is `WxH`.
   */
  async desktop(idOrName: string, body: { action: 'start' | 'stop'; resolution?: string }) {
    return (
      await this.request<{ data: DesktopStatus }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/desktop`, {
        body,
      })
    ).data
  }

  /**
   * Sends one input. Refused as `no_desktop` when the desktop is not running,
   * and as `desktop_outdated` for an action the sandbox's image predates.
   */
  async desktopInput<T extends DesktopInput>(idOrName: string, body: T) {
    return (
      await this.request<{ data: DesktopInputAnswer<T['action']> }>(
        'POST',
        `/sandboxes/${encodeURIComponent(idOrName)}/desktop/input`,
        { body },
      )
    ).data
  }

  /**
   * The screen as a PNG. With `region` (`[x0, y0, x1, y1]`, screen pixels),
   * that crop scaled up to the screen's size, keeping its aspect ratio.
   */
  async desktopScreenshot(
    idOrName: string,
    query: { region?: readonly [number, number, number, number] } = {},
  ): Promise<DesktopScreenshot> {
    const response = await this.bytes(`/sandboxes/${encodeURIComponent(idOrName)}/desktop/screenshot`, {
      region: query.region?.join(','),
    })
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      width: Number(response.headers.get('x-image-width') ?? 0),
      height: Number(response.headers.get('x-image-height') ?? 0),
    }
  }

  /** The accessibility tree, as `sbx-desktop` prints it. `app` narrows it to one application. */
  async accessibilityTree(
    idOrName: string,
    query: { app?: string; depth?: number; include_hidden?: boolean } = {},
  ) {
    return (
      await this.request<{ data: unknown }>('GET', `/sandboxes/${encodeURIComponent(idOrName)}/desktop/accessibility`, {
        query: { ...query, include_hidden: query.include_hidden ? true : undefined },
      })
    ).data
  }

  /** Acts on one node of the tree, by the `ref` the tree gave it. */
  async accessibilityAction(idOrName: string, body: AccessibilityAction) {
    return (
      await this.request<{ data: unknown }>('POST', `/sandboxes/${encodeURIComponent(idOrName)}/desktop/accessibility`, {
        body,
      })
    ).data
  }

  // ---- a sandbox's files

  async putSandboxFile(idOrName: string, path: string, bytes: Uint8Array<ArrayBuffer>) {
    const response = await this.transfer('PUT', `sandboxes/${encodeURIComponent(idOrName)}`, path, bytes)
    return (await response.json()) as { data: { path: string; size_bytes: number } }
  }

  async getSandboxFile(idOrName: string, path: string): Promise<Uint8Array<ArrayBuffer>> {
    const response = await this.transfer('GET', `sandboxes/${encodeURIComponent(idOrName)}`, path)
    return new Uint8Array(await response.arrayBuffer())
  }
}
