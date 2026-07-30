// @ts-check
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // node_modulesはデフォルトでignoreされるが、.claude/配下の過去worktreeは明示的に除外が必要
  globalIgnores(['node_modules/**', '.claude/**']),
  {
    files: ['main.ts', 'cli.ts', 'tsup.config.ts', '__tests__/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // any再流入の防止が今回のESLint導入の主目的
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
