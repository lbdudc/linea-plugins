import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    watchExclude: ['**/tmp/**'],
    setupFiles: ['./src/test/support/netProbe.setup.js'],
    hookTimeout: 30000,
  },
})
