// @ts-check
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // node_modules is ignored by default, but stale worktrees under .claude/ must be excluded explicitly
  globalIgnores(['node_modules/**', '.claude/**', 'dist/**']),
  {
    files: ['src/**/*.ts', 'tsup.config.ts', 'vitest.config.ts', '__tests__/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // Keeping `any` from creeping back in is the main reason ESLint was introduced
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
