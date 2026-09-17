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
     * The 120 remaining raw palette classes, by file. Converting them is its
     * own pass with its own diff — mapping `bg-amber-50 text-amber-700` onto
     * the theme's amber tokens is a judgement per site, not a codemod, and
     * several of these render inside the client interview's frozen scope where
     * the hardcoded palette may be deliberate.
     *
     * Nothing may be added to this list. Delete entries as files are converted;
     * when it is empty, delete the block.
     */
    files: [
      'app/admin/calendar/CalendarClient.tsx',
      'app/admin/calendar/DayAgenda.tsx',
      'app/admin/calendar/EventPrepDrawer.tsx',
      'app/admin/calendar/QuickBookPopover.tsx',
      'app/admin/contacts/ContactsClient.tsx',
      'app/admin/contacts/merge/MergeReviewClient.tsx',
      // `*`, not the literal `[matterId]`: eslint's globs read `[...]` as a
      // character class, so the real directory name never matches.
      'app/admin/drafting/*/design/sections/AssetsSection.tsx',
      'app/admin/settings/EmailSettingsSection.tsx',
      'app/admin/settings/estate-tax/EstateTaxSchedulesClient.tsx',
      'app/intake/(shell)/RequestUnlockButton.tsx',
      'app/intake/(shell)/page.tsx',
      'app/intake/start/PublicIntakeStartForm.tsx',
      'components/assets/AssetPortfolioSummary.tsx',
      'components/design-sheet/DesignSheetConflictDialog.tsx',
      'components/intake/FiduciaryContactPicker.tsx',
      'components/intake/IntakeChildrenStep.tsx',
      'components/intake/IntakeFamilySteps.tsx',
      'components/intake/IntakePersonalStep.tsx',
      'components/intake/IntakeReferralStep.tsx',
      'components/intake/IntakeWizard.tsx',
      'components/intake/collegePrep/CollegePrepSteps.tsx',
      'components/sharedFields/IntakeField.tsx',
      'packages/citations/src/react/PdfCitationViewer.tsx',
    ],
    rules: { 'theme/no-raw-palette': 'off' },
  },
]

export default config
