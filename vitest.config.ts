import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // .claude/worktrees/ 配下に過去のworktreeが残っていると、
    // 同じテストファイルを二重に収集してしまうため除外する
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
