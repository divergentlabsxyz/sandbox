/**
 * `<SandboxScreen>`: `mountScreen` as a React component.
 */

import { createElement, useEffect, useRef, type CSSProperties } from 'react'
import { mountScreen, type ScreenHandle, type ScreenMode } from './screen.ts'

export type { ScreenMode } from './screen.ts'

export interface SandboxScreenProps {
  /** A `dvs_` token with `view` or `control`. A new token reconnects. */
  token: string
  /** The sandbox's id, as `createToken` answered it. */
  sandbox: string
  baseUrl?: string
  /** `view` when left out. Changing it keeps the connection. */
  mode?: ScreenMode
  background?: string
  onConnect?: () => void
  onDisconnect?: (detail: { clean: boolean }) => void
  className?: string
  /** The element has no size of its own; give it one, such as `aspectRatio: '16 / 10'`. */
  style?: CSSProperties
}

/**
 * A sandbox's screen, live, scaled to fit its element. One connection per
 * token: a new `token`, `sandbox` or `baseUrl` reconnects; `mode` does not.
 */
export function SandboxScreen({
  token,
  sandbox,
  baseUrl,
  mode = 'view',
  background,
  onConnect,
  onDisconnect,
  className,
  style,
}: SandboxScreenProps) {
  const target = useRef<HTMLDivElement>(null)
  const handle = useRef<ScreenHandle | null>(null)
  // The latest callbacks and mode, read when the connection reports, so
  // changing them does not reconnect.
  const latest = useRef({ mode, onConnect, onDisconnect })
  latest.current = { mode, onConnect, onDisconnect }

  useEffect(() => {
    if (!target.current) return
    // Unmounting closes the connection; that is not news to the page.
    let unmounted = false
    const screen = mountScreen(target.current, {
      token,
      sandbox,
      baseUrl,
      background,
      mode: latest.current.mode,
      onConnect: () => latest.current.onConnect?.(),
      onDisconnect: (detail) => {
        if (!unmounted) latest.current.onDisconnect?.(detail)
      },
    })
    handle.current = screen
    return () => {
      unmounted = true
      handle.current = null
      screen.disconnect()
    }
  }, [token, sandbox, baseUrl, background])

  useEffect(() => {
    handle.current?.setMode(mode)
  }, [mode])

  return createElement('div', { ref: target, className, style })
}
