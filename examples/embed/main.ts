/**
 * Mounts a sandbox's screen from a token in the URL's hash.
 *
 * Mint the token on your server, for this page's origin:
 *
 *   const { token, sandbox: id } = await sandbox.createToken({
 *     abilities: ['view'],
 *     origins: ['http://localhost:5173'],
 *   })
 *
 * then serve this folder (`npx vite examples/embed` after `pnpm build`) and
 * open http://localhost:5173/#token=<token>&sandbox=<id>. A `view` token
 * shows the screen and drops input; mint `control` to let the person type.
 */

import { mountScreen, type ScreenMode } from '@divergentlabs/sandbox/screen'

const params = new URLSearchParams(location.hash.slice(1))
const token = params.get('token')
const sandbox = params.get('sandbox')
const state = document.getElementById('state')!
const control = document.getElementById('control')!

if (!token || !sandbox) {
  state.textContent = 'No token'
  document.getElementById('usage')!.hidden = false
} else {
  let mode: ScreenMode = 'view'
  const screen = mountScreen(document.getElementById('screen')!, {
    token,
    sandbox,
    baseUrl: params.get('api') ?? undefined,
    mode,
    onConnect: () => {
      state.textContent = 'Live · watching'
      state.className = 'live'
    },
    onDisconnect: () => {
      state.textContent = 'Disconnected'
      state.className = ''
    },
  })

  control.addEventListener('click', () => {
    mode = mode === 'view' ? 'control' : 'view'
    screen.setMode(mode)
    control.setAttribute('aria-pressed', String(mode === 'control'))
    control.textContent = mode === 'control' ? 'Hand back' : 'Take control'
    if (state.className === 'live') {
      state.textContent = mode === 'control' ? 'Live · your keyboard and mouse' : 'Live · watching'
    }
  })
}
