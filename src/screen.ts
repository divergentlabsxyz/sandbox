/**
 * A sandbox's screen, live, in an element of your page.
 *
 * Opened with a sandbox token, so the org key never reaches the browser.
 * The token decides what the viewer may do: a `view` token's input is
 * dropped by the server whatever `mode` says, and `control` needs a token
 * with `control`. Switching modes mints nothing; your server decides which
 * token to hand out.
 */

import { DEFAULT_BASE_URL, screenUrl } from './urls.ts'

export type ScreenMode = 'view' | 'control'

export interface MountScreenOptions {
  /** A `dvs_` token with `view` or `control`. */
  token: string
  /** The sandbox's id, as `createToken` answered it. */
  sandbox: string
  baseUrl?: string
  /** `view` when left out. */
  mode?: ScreenMode
  /** The colour around the screen where its aspect ratio leaves room. */
  background?: string
  onConnect?: () => void
  /** Called once, when the connection closes: the token expired, the desktop stopped, or `disconnect` was called. */
  onDisconnect?: (detail: { clean: boolean }) => void
}

export interface ScreenHandle {
  /** Closes the connection. */
  disconnect(): void
  /** `control` sends this page's keyboard and mouse to the desktop; `view` stops. */
  setMode(mode: ScreenMode): void
}

/**
 * Connects to the screen and draws it into `element`, scaled to fit. noVNC
 * loads on the first call, so a page that never shows a screen never
 * downloads it.
 */
export function mountScreen(element: HTMLElement, options: MountScreenOptions): ScreenHandle {
  const url = screenUrl(options.baseUrl ?? DEFAULT_BASE_URL, options.sandbox, options.token)
  let mode: ScreenMode = options.mode ?? 'view'
  let closed = false
  let rfb: import('@novnc/novnc').default | null = null

  function apply() {
    if (!rfb) return
    rfb.viewOnly = mode !== 'control'
    if (mode === 'control') rfb.focus({ preventScroll: true })
  }

  void import('@novnc/novnc').then(({ default: RFB }) => {
    if (closed) return
    const session = new RFB(element, url, { shared: true })
    session.scaleViewport = true
    session.resizeSession = false
    session.focusOnClick = mode === 'control'
    if (options.background) session.background = options.background
    session.addEventListener('connect', () => options.onConnect?.())
    session.addEventListener('disconnect', (event) => {
      closed = true
      rfb = null
      options.onDisconnect?.({ clean: Boolean((event as CustomEvent<{ clean?: boolean }>).detail?.clean) })
    })
    rfb = session
    apply()
  })

  return {
    disconnect() {
      if (closed) return
      closed = true
      if (rfb) rfb.disconnect()
      else options.onDisconnect?.({ clean: true })
    },
    setMode(next) {
      mode = next
      if (rfb) rfb.focusOnClick = next === 'control'
      apply()
    },
  }
}
