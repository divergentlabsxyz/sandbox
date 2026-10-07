import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    anthropic: 'src/anthropic.ts',
    openai: 'src/openai.ts',
    ai: 'src/ai.ts',
    screen: 'src/screen.ts',
    react: 'src/react.tsx',
  },
  format: ['esm', 'cjs'],
  // tsup's declaration build sets baseUrl, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  target: 'es2022',
  external: ['react', '@novnc/novnc', 'ai', '@anthropic-ai/sdk', 'openai'],
})
