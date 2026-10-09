import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// The sign data the page is built with (src/data/*.json) is the offline fallback: the page normally reads the signs from the
// server (/api/data, see src/data/store.js). `npm run export` writes the database back into these files.

// The `note` fields of the data files are for people reading the JSON (the sign editor shows the orient notes; the server
// hands notes only to signed-in users): the production bundle leaves them out.
const stripNotes = () => ({
  name: 'strip-json-notes',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]src[\\/]data[\\/][^\\/]+\.json$/.test(id.split('?')[0])) return null;
    return JSON.stringify(JSON.parse(code), (k, v) => (k === 'note' && typeof v === 'string' ? undefined : v));
  },
});

export default {
  plugins: [stripNotes()],
  // shown in the app's info dialog (src/ui/about.js)
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_YEAR__: JSON.stringify(new Date().getFullYear()) },
  server: {
    // the API server (npm run dev -w server); the Host header stays the page's own, so the server's origin check passes
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 3001}`, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 3001}`, changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 900, // three.js alone is ~835 kB
    rolldownOptions: {
      output: {
        // three.js in its own chunk, so it stays cached when only the app code changes
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
};
