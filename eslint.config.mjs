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
       * An error, with the files that already carry the debt listed below.
       *
       * It cannot be a warning: the Lint step runs with `--max-warnings=10`,
       * a deliberate ceiling meant to be lowered as warnings are fixed, and
       * 120 new ones would have had to raise it — which is the drift this rule
       * exists to stop. An exemption list is the same ratchet the ceiling is,
       * only per-file: everything not named below is held to the rule now, and
       * the list shrinks to nothing when the conversion pass lands.
       */
      'theme/no-raw-palette': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/error-boundaries': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    /**
     * What is left of the raw palette, and why it is not a sweep.
     *
     * Each of these three is a CATEGORICAL set — asset categories, contact
     * kinds, email providers — where the hue is the only thing telling one
     * value from another. The theme has no categorical scale to map them onto:
     * `--chart-1` to `--chart-5` are five greys, and the stage and status
     * colours already mean stages and statuses. Converting these needs a
     * palette designed for the job, which is a design decision rather than a
     * cleanup, and all three already carry correct light and dark variants —
     * they are the least broken raw palette in the tree, not the most.
     *
     * The other 20 files that were here are converted. Nothing may be added to
     * this list; delete an entry when its set gets real tokens, and when it is
     * empty delete the block.
     */
    files: [
      'app/admin/drafting/*/design/sections/AssetsSection.tsx',
      'app/admin/contacts/ContactsClient.tsx',
      'app/admin/settings/EmailSettingsSection.tsx',
    ],
    rules: { 'theme/no-raw-palette': 'off' },
  },
]

export default config
