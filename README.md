# @divergentlabs/sandbox

Divergent sandboxes and their desktop from TypeScript: a client, computer-use adapters for Claude, OpenAI and the AI SDK, and a live screen to embed in a page.

## Entry points

| Import | Runs on | Gives |
| --- | --- | --- |
| `@divergentlabs/sandbox` | server | `Divergent`, `Sandbox`, `Desktop`, `Divergent.fromToken` |
| `@divergentlabs/sandbox/anthropic` | server | `computerToolset` for `computer_toolset_20260801` |
| `@divergentlabs/sandbox/openai` | server | `computerTool`, `computerCallOutput` for the Responses API's computer tool |
| `@divergentlabs/sandbox/ai` | server | `computerTools` for the AI SDK |
| `@divergentlabs/sandbox/screen` | browser | `mountScreen` |
| `@divergentlabs/sandbox/react` | browser | `<SandboxScreen>` |

Optional peer dependencies: `@anthropic-ai/sdk`, `openai`, `ai`, `@novnc/novnc` (for `screen` and `react`) and `react`. Install the ones for the entry points you import.

## Client

```ts
import { Divergent } from '@divergentlabs/sandbox'

const divergent = new Divergent({ apiKey: process.env.DIVERGENT_API_KEY! })
const sandbox = await divergent.sandboxes.create({ metadata: { user: '42' } })
await sandbox.desktop.start()
```

`new Divergent({ apiKey, baseUrl?, fetch? })` takes an org API key with `sandboxes:write`. `baseUrl` is `https://api.divergentlabs.xyz` when left out.

| Call | Does |
| --- | --- |
| `sandboxes.create({ size, name, metadata, idleTimeoutSeconds, idempotencyKey })` | Makes a sandbox and answers once it runs. |
| `sandboxes.get(idOrName)` | One sandbox. |
| `sandboxes.list({ metadata, all })` | Newest first. With `metadata`, only sandboxes carrying every pair. |
| `sandbox.exec(command, { cwd, env, timeoutSeconds })` | Runs a command as root; answers `{ exit_code, stdout, stderr, truncated }`. |
| `sandbox.files.read(path)` / `files.write(path, contents)` | Reads or writes one file. |
| `sandbox.stop()` / `resume()` / `fork({ name })` / `destroy()` | As named. `fork` answers the new sandbox. |
| `sandbox.createToken({ abilities, expiresIn, origins })` | A sandbox token. See below. |

`create` takes no secrets. A sandbox handed to a token must hold none, since a model reading pages, or a person who takes control, can read anything in it.

Metadata is at most 16 keys of `[a-z0-9_.-]`, 1 to 40 characters, each value at most 256 characters.

## Desktop

`sandbox.desktop`, or `Divergent.fromToken(...).desktop`. Positions are screen pixels, the pixels a screenshot has. The screen is 1280x800 unless started at another resolution.

| Call | Token ability |
| --- | --- |
| `status()` | `view` |
| `screenshot({ region })` → `{ bytes, width, height }` | `view` |
| `start({ resolution })`, `stop()` | `control` |
| `click({ x, y, button, count, modifiers })` | `control` |
| `move({ x, y })`, `mouseDown()`, `mouseUp()` | `control` |
| `drag({ from, to, modifiers })` | `control` |
| `scroll({ direction, amount, x, y, modifiers })` | `control` |
| `type(text)`, `key(keys, { repeat })`, `hold(keys, seconds)` | `control` |
| `cursor()` → `{ x, y }` | `control` |
| `open(urls)` | `control` |
| `accessibility.tree({ app, depth, includeHidden })`, `accessibility.act({ ref, action, text })` | `control` |

`region` is `[x0, y0, x1, y1]`; the answer is that rectangle scaled to the screen's size. `modifiers` is any of `shift`, `ctrl`, `alt` and `super`, joined by `+`. `keys` are xdotool combos such as `ctrl+l` or `Return`.

Every call rejects with `ApiError`. Branch on `code`:

| `code` | Status | Next |
| --- | --- | --- |
| `no_desktop` | 409 | Call `desktop.start()`. |
| `desktop_outdated` | 409 | The sandbox predates the action. Make a new sandbox. |
| `not_running` | 409 | The sandbox is stopped. Call `sandbox.resume()`. |
| `invalid_request` | 422 | Fix the argument the message names. |
| `not_found` | 404 | Check the sandbox id. |

## Sandbox tokens

```ts
// On your server
const grant = await sandbox.createToken({
  abilities: ['control'],
  expiresIn: 900,
  origins: ['https://app.example.com'],
})
// Hand { token, sandbox } to the browser
```

A token reaches one sandbox's desktop and screen, and no other route. `view` watches the screen and takes screenshots; the server drops a `view` token's input. `control` also sends input and calls every desktop method. `expiresIn` is 60 to 3600 seconds, 900 when left out. A browser is refused unless its origin is in `origins`; `origins` takes the Team or Platform plan.

| `code` | Status | Meaning |
| --- | --- | --- |
| `sandbox_has_secrets` | 409 | The sandbox names secrets. Make one without. |
| `plan_required` | 403 | `origins` on a plan below Team. |
| `origin_refused` | 403 | The page's origin is not in the token's `origins`. |

`Divergent.fromToken({ token, sandbox }, { baseUrl? })` answers `{ desktop, screenUrl }` for that sandbox.

## Claude

```ts
import { computerToolset } from '@divergentlabs/sandbox/anthropic'

const toolset = computerToolset(sandbox.desktop, { onAction: (step) => log(step) })
// tools: [toolset.tool]
messages.push({ role: 'assistant', content: response.content })
messages.push({ role: 'user', content: await toolset.run(response.content) })
```

`run` executes every `tool_use` block with `toolset_name: "computer"`, in order, and answers one `tool_result` per call, each with `toolset_name: "computer"`. After the first failure, every later call in the turn answers `Not executed: an earlier computer action in this turn failed.` with `is_error`. It handles all 17 members. `screenshot` and `zoom` answer a PNG; `cursor_position` answers `X=512, Y=384`; `wait` waits up to 300 seconds without calling the API. A `screenshot` of a desktop that is not running starts it once.

A screen wider or taller than 2000 px is shrunk to fit, and positions are mapped back. That takes `OffscreenCanvas`, or a `resize(png, width, height)` option on a runtime without it.

`onAction({ name, input, screenshot?, error? })` is called after each call runs.

`examples/claude-computer.ts` is a complete loop.

## OpenAI

```ts
import { computerTool, computerCallOutput } from '@divergentlabs/sandbox/openai'

// tools: [computerTool]
for (const item of response.output) {
  if (item.type === 'computer_call') input.push(await computerCallOutput(sandbox.desktop, item))
}
```

`computerCallOutput` runs the call's `actions` (or `action`) in order and answers its `computer_call_output` with a screenshot. A call with pending safety checks runs only once each is passed in `acknowledgedSafetyChecks`. Key names are mapped to xdotool keysyms: `CTRL` to `ctrl`, `ENTER` to `Return`, `ARROWLEFT` to `Left`.

## AI SDK

```ts
import { computerTools } from '@divergentlabs/sandbox/ai'

await generateText({ model, tools: computerTools(sandbox.desktop), prompt })
```

Tools: `screenshot`, `click`, `type`, `key`, `scroll`, `move`, `drag`. `screenshot` reaches the model as an image.

## Screen

```ts
import { mountScreen } from '@divergentlabs/sandbox/screen'

const screen = mountScreen(element, { token, sandbox, mode: 'view' })
screen.setMode('control')
screen.disconnect()
```

```tsx
import { SandboxScreen } from '@divergentlabs/sandbox/react'

<SandboxScreen token={token} sandbox={sandbox} mode="view" style={{ aspectRatio: '16 / 10' }} />
```

The screen scales to fit its element. `mode: 'control'` sends the page's keyboard and mouse, and needs a `control` token. A new `token` reconnects; a new `mode` does not.

`examples/embed/` mounts the screen from a token in the URL's hash.

## License

Apache-2.0. See `LICENSE`.

## Development

This repository mirrors the SDK from Divergent's monorepo, one commit per release. Report a bug or ask for a change in an issue. A pull request is welcome, and is ported into the monorepo by hand, so it ships in the next release rather than by merge.

```sh
npm ci
npm run check   # tsc
npm test        # node:test, no network
npm run build   # tsup: ESM, CJS and .d.ts into dist/
```

Pushing a tag `v<version>` publishes that version to npm with provenance, from `.github/workflows/publish.yml`.
