import type { ApiErrorBody } from './sandbox-types.ts'

/**
 * An error the API returned deliberately, with the code it chose.
 *
 * Callers branch on `code`, never on the message — the message is for people
 * and may be reworded; the code is the contract.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string[]>
  readonly body: ApiErrorBody['error']

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message ?? 'request failed')
    this.name = 'ApiError'
    this.status = status
    this.code = body.code ?? 'unknown'
    this.fields = body.fields
    this.body = body
  }

  /** True when the org has run out of credit rather than done something wrong. */
  get isPaymentRequired() {
    return this.status === 402
  }

  get isUnauthorized() {
    return this.status === 401
  }
}

export interface ClientOptions {
  baseUrl: string
  /**
   * A session token or a `dv_live_` API key, which work on every route, or a
   * `dvs_` sandbox token, which works on one sandbox's desktop routes alone.
   */
  token?: string
  fetch?: typeof globalThis.fetch
}

/**
 * The HTTP underneath every client: the credential, the JSON and bytes
 * routes, and turning a refusal into an `ApiError`.
 */
export class Transport {
  readonly baseUrl: string
  protected readonly token?: string
  protected readonly doFetch: typeof globalThis.fetch

  constructor({ baseUrl, token, fetch: fetchImpl }: ClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
    this.doFetch = fetchImpl ?? globalThis.fetch
  }

  /**
   * A path on a volume or in a sandbox is a path: each segment escaped, the
   * slashes left alone. `owner` is `volumes/<name>` or `sandboxes/<name>`,
   * already escaped.
   */
  protected async transfer(
    method: 'GET' | 'PUT' | 'DELETE',
    owner: string,
    path: string,
    body?: Uint8Array<ArrayBuffer>,
  ) {
    const escaped = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    const url = `${this.baseUrl}/api/${owner}/files/${escaped}`

    // The API pipeline negotiates on `json`, and an error on a bytes route is
    // still JSON; naming both is what keeps a 406 from standing in for a 404.
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream, application/json',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (body) headers['Content-Type'] = 'application/octet-stream'

    const response = await this.doFetch(url, { method, headers, body })

    if (!response.ok) {
      // An error is still JSON, even on a route that answers in bytes.
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = text ? JSON.parse(text) : {}
      } catch {
        parsed = {}
      }

      throw new ApiError(
        response.status,
        (parsed as ApiErrorBody).error ?? {
          code: 'unknown',
          message: `${response.status} ${response.statusText}`,
        },
      )
    }

    return response
  }

  /** A GET that answers in bytes on success and in JSON on refusal. */
  protected async bytes(path: string, query: Record<string, unknown> = {}) {
    const url = new URL(`${this.baseUrl}/api${path}`)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = { Accept: 'image/png, application/octet-stream, application/json' }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    const response = await this.doFetch(url, { method: 'GET', headers })
    if (!response.ok) {
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = text ? JSON.parse(text) : {}
      } catch {
        parsed = {}
      }
      throw new ApiError(
        response.status,
        (parsed as ApiErrorBody).error ?? { code: 'unknown', message: `${response.status} ${response.statusText}` },
      )
    }
    return response
  }

  protected async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${path}`)

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    const response = await this.doFetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (response.status === 204) return undefined as T

    // An error page from a proxy or a crashed server is not JSON; surfacing
    // the status beats a parse error that says nothing about what happened.
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      throw new ApiError(response.status, {
        code: 'malformed_response',
        message: `${response.status} ${response.statusText} from ${url.pathname}`,
      })
    }

    if (!response.ok) {
      const body = (parsed as ApiErrorBody).error ?? {
        code: 'unknown',
        message: `${response.status} ${response.statusText}`,
      }
      throw new ApiError(response.status, body)
    }

    return parsed as T
  }
}
