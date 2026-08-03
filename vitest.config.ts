import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Stale worktrees left under .claude/ would cause the same test files
    // to be collected twice, so exclude them
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
