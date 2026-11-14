import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Writes dist/sw.js with the list of files the app needs to open with no signal. */
function offlineShell(): Plugin {
  let outDir = 'dist'
  return {
    name: 'musuk-offline-shell',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])
      const files = walk(outDir)
        .map((path) => path.slice(outDir.length).replaceAll('\\', '/'))
        .filter((path) => path !== '/sw.js' && path !== '/_redirects' && !path.endsWith('.DS_Store') && !path.includes('icon-source'))
        .sort()
      const hash = createHash('sha256')
      for (const path of files) hash.update(path).update(readFileSync(join(outDir, path)))
      const urls = files.map((path) => (path === '/index.html' ? '/' : path))
      const source = readFileSync(resolve(__dirname, 'src/sw.js'), 'utf8')
        .replace('__SHELL_VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__SHELL_FILES__', JSON.stringify(urls))
      writeFileSync(join(outDir, 'sw.js'), source)
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  resolve: {
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
  },
})
