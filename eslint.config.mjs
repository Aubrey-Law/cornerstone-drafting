import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import theme from './eslint-rules/theme.mjs'

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      '.claude/**',
      '.next/**',
      'AGENTS.md',
      'my-heirloom-plan-main/**',
      'node_modules/**',
      'tsconfig.tsbuildinfo',
      'word-addin/**', 'apps/**',
    ],
  },
  {
    plugins: { theme },
    rules: {
      /**
       * Errors, because both are at zero and staying there is the whole point:
       * 658 arbitrary font sizes and 375 surface-opacity classes were removed to
       * get here, and a single new one starts the ladder over.
       */
      'theme/no-arbitrary-font-size': 'error',
      'theme/no-surface-opacity': 'error',
      /**
       * A warning, not an error, and deliberately so: 225 of these are still in
       * the tree. Converting them is its own pass, with its own diff to review —
       * this stops the count growing in the meantime, and becomes an error when
       * that pass lands.
       */
      'theme/no-raw-palette': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/error-boundaries': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]

export default config
