import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'mini-framer-motion': fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Spring math is pure, so the default is plain Node. React tests opt into jsdom per file.
    environment: 'node',
  },
})
