import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

// One config, two jobs:
//   `vite` / `vite build --mode playground` -> the playground app in ./playground
//   `vite build`                           -> the library in ./dist (library mode)
export default defineConfig(({ command, mode }) => {
  const resolve = { alias: { 'mini-framer-motion': src('index.ts') } }

  if (command === 'serve' || mode === 'playground') {
    return {
      root: 'playground',
      plugins: [react()],
      resolve,
      build: { outDir: '../dist-playground', emptyOutDir: true },
    }
  }

  return {
    plugins: [react()],
    resolve,
    build: {
      lib: {
        entry: src('index.ts'),
        name: 'MiniFramerMotion',
        fileName: 'mini-framer-motion',
        formats: ['es', 'cjs'],
      },
      emptyOutDir: false, // keep dist/types emitted by tsc
      sourcemap: true,
      rollupOptions: {
        external: ['react', 'react-dom', 'react/jsx-runtime'],
      },
    },
  }
})
