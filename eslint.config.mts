import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Tests run under Node, not in Obsidian: builtin imports are expected,
		// and node:test registers suites without awaiting them.
		files: ["**/*.test.ts"],
		languageOptions: {
			globals: { ...globals.node },
		},
		rules: {
			"import/no-nodejs-modules": "off",
			"@typescript-eslint/no-floating-promises": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		".test-build",
		"esbuild.config.mjs",
		"esbuild.test.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
