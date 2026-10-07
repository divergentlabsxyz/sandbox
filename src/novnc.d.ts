/**
 * The part of noVNC's `RFB` the screen uses. noVNC ships no types, and the
 * DefinitelyTyped ones trail its releases, so what is used is said here.
 */
declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { shared?: boolean; wsProtocols?: string[] })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    background: string
    disconnect(): void
    focus(options?: FocusOptions): void
  }
}
