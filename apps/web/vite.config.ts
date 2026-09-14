import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/** dev-only middleware: serve the Datasworn files (static copy covers builds) */
function serveStarforged(): Plugin {
  return {
    name: 'serve-starforged',
    apply: 'serve',
    configureServer(server) {
      const serve =
        (file: string) =>
        (_req: unknown, res: { setHeader(k: string, v: string): void; end(): void }): void => {
          res.setHeader('Content-Type', 'application/json');
          createReadStream(fileURLToPath(new URL(`../../data/${file}`, import.meta.url))).pipe(res);
        };
      server.middlewares.use('/data/starforged.json', serve('starforged.json'));
      server.middlewares.use('/data/starforged.zh.json', serve('starforged.zh.json'));
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    serveStarforged(),
    viteStaticCopy({
      targets: [
        // the plugin keeps the src's last dir segment ('data') and joins it onto
        // dest, so dest:'' lands the file at dist/data/starforged[.zh].json
        { src: '../../data/starforged.json', dest: '' },
        { src: '../../data/starforged.zh.json', dest: '' },
      ],
    }),
  ],
  // Pin the origin (localStorage is per-origin, including port): if 5173 is
  // taken, fail loudly instead of silently hopping to 5174 with empty settings.
  server: {
    port: 5173,
    strictPort: true,
  },
});
