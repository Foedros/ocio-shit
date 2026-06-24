import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// GitHub Pages serves a project site under /<repo>; set BASE_PATH in CI. Empty locally.
const base = process.env.BASE_PATH ?? '';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Static export for GitHub Pages. fallback => SPA (client routing + offline shell).
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: '404.html',
				precompress: false,
				strict: false
			}),
			paths: { base }
		})
	],
	// The SQLite worker is an ES module worker.
	worker: { format: 'es' },
	// Let the worker bundle sqlite-wasm itself; the dep-optimizer mangles its wasm loader.
	optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }
});
