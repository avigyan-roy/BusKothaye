import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { loadWebConfig, productionConfigProblems } from './src/config/site.js';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // A *deployment* build refuses to produce a bundle that points at localhost or
  // ships without a map key — that bundle passes review and is broken for every
  // visitor. `npm run build:deploy` (vite mode "production") is the guarded one,
  // and it is what amplify.yml and CI run with the real values set.
  //
  // `npm run build` uses mode "preview" and skips this check. It is otherwise an
  // identical production build; it just does not assume it is about to be
  // deployed, so `npm run check` works on a laptop with no cloud settings.
  if (command === 'build' && mode === 'production') {
    const problems = productionConfigProblems(loadWebConfig(env));
    if (problems.length > 0) {
      throw new Error(
        `Refusing to build the web app for deployment:\n  - ${problems.join('\n  - ')}\n\n` +
          'If you are deploying: set these in the Amplify build environment — see ' +
          'infra/RUNBOOK.md step 5.\n' +
          'If you are building locally: use `npm run build` (or `npm run check`), ' +
          'which does not require deployment settings.',
      );
    }
  }

  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, host: true },
    preview: { port: 4173, strictPort: true },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          // MapLibre is large and only the map screens need it, so it gets its own
          // chunk: the stop list and arrival panel become usable sooner.
          manualChunks: { maplibre: ['maplibre-gl'] },
        },
      },
    },
  };
});
