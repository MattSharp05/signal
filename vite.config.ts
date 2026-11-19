/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./supabase/functions/_shared/core', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: { chunkSizeWarningLimit: 1400 },
  test: {
    include: ['supabase/functions/_shared/core/**/*.test.ts', 'src/**/*.test.ts'],
  },
})
