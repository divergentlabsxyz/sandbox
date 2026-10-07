/**
 * Claude works a sandbox's desktop until the task is done, printing each step.
 *
 *   DIVERGENT_API_KEY=dv_live_… ANTHROPIC_API_KEY=sk-ant-… \
 *     node examples/claude-computer.ts "Find the opening hours of the Rijksmuseum"
 *
 * Run `pnpm build` first: the imports below resolve to dist/.
 */

import Anthropic from '@anthropic-ai/sdk'
import { Divergent } from '@divergentlabs/sandbox'
import { computerToolset } from '@divergentlabs/sandbox/anthropic'

const task = process.argv.slice(2).join(' ') || 'Open example.com and tell me what the page says.'

const divergent = new Divergent({
  apiKey: process.env.DIVERGENT_API_KEY ?? '',
  baseUrl: process.env.DIVERGENT_API_URL,
})
// Reads ANTHROPIC_API_KEY.
const anthropic = new Anthropic()

const sandbox = await divergent.sandboxes.create({ metadata: { example: 'claude-computer' } })
console.error(`sandbox ${sandbox.name} (${sandbox.id})`)

try {
  await sandbox.desktop.start()

  let step = 0
  const toolset = computerToolset(sandbox.desktop, {
    onAction: ({ name, input, error }) => {
      step += 1
      const detail = Object.keys(input).length > 0 ? ` ${JSON.stringify(input)}` : ''
      console.error(`${String(step).padStart(3)}  ${name}${detail}${error ? `  failed: ${error}` : ''}`)
    },
  })

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task }]

  for (;;) {
    const response = await anthropic.beta.messages
      .stream({
        model: 'claude-opus-5-5',
        max_tokens: 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        // A declined request is retried on another model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        tools: [toolset.tool],
        messages,
      })
      .finalMessage()

    // The whole content goes back, thinking blocks included, unchanged.
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'refusal') {
      console.error(`declined: ${response.stop_details?.explanation ?? 'no explanation given'}`)
      break
    }
    if (response.stop_reason !== 'tool_use') {
      for (const block of response.content) if (block.type === 'text') console.log(block.text)
      break
    }

    messages.push({ role: 'user', content: await toolset.run(response.content) })
  }
} finally {
  await sandbox.destroy()
}
