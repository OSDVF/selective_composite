import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(
    {
      template: {
        compilerOptions: {
          isCustomElement(tag: string) {
            return ['center'].includes(tag)
          },
        }
      },
    })],
  resolve: {
    alias: process.env.NODE_ENV === 'production' ? {
      'webgl-lint':  './src/empty.js'
    } : undefined
  }
})
