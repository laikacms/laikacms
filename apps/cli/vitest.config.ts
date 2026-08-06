import { mergeConfig } from 'vitest/config';

import base from '../../vitest.config.base.js';

export default mergeConfig(base, {
  test: {
    include: ['src/**/*.test.ts'],
  },
});
