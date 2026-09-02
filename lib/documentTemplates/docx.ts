// Re-export shim. This module moved to @aubrey-law/drafting-engine during
// Phase 1 of the Workbench overhaul; the path is kept so the ~110 call
// sites in this app keep resolving. Import the package directly in new
// code — these shims are deleted as call sites migrate.
export * from '@aubrey-law/drafting-engine/documentTemplates/docx'
