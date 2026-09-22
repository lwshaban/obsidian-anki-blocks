/**
 * Bundles *.test.ts into .test-build/ so `node --test` can run them.
 *
 * Source uses extensionless imports (esbuild resolves them); Node's ESM loader
 * does not, so the tests go through the same bundler as the plugin itself.
 */
import esbuild from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.test-build';

function findTests(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...findTests(path));
		else if (entry.name.endsWith('.test.ts')) found.push(path);
	}
	return found;
}

rmSync(OUT, { recursive: true, force: true });

const entryPoints = findTests('src');
if (entryPoints.length === 0) {
	console.error('No *.test.ts files found.');
	process.exit(1);
}

await esbuild.build({
	entryPoints,
	outdir: OUT,
	outbase: 'src',
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	sourcemap: 'inline',
	external: ['obsidian', 'node:*'],
	logLevel: 'warning',
});
