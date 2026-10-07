/** The API every client talks to unless given another `baseUrl`. */
export const DEFAULT_BASE_URL = 'https://api.divergentlabs.xyz'

/** `wss://<api host>/api/sandboxes/:id/screen?token=…` */
export function screenUrl(baseUrl: string, sandbox: string, token: string) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/sandboxes/${encodeURIComponent(sandbox)}/screen`)
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  url.searchParams.set('token', token)
  return url.toString()
}
