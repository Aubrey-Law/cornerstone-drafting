The root build command previously stopped short of a Next.js production build, and unit tests could inherit application credentials. This change makes the build real, adds it to CI, and separates synthetic unit/build configuration from explicitly selected loopback integration databases.

This is release step 1 of the approved firm-app remediation. It preserves the main-only deployment policy. The generated theme CSS is reproducible output from the existing build step.

The initial GitHub build exhausted Node 22's approximately 2 GiB default heap during Next's TypeScript step. The isolated build launcher now supplies a fixed 4 GiB heap to its workers without inheriting arbitrary parent Node options. Regression tests verify both the child runtime budget and continued credential/environment-file isolation.

Validation: the combined remediation series passes 5,032 root tests, the production build, typecheck, and lint (10 existing warnings). This branch's independent CI must pass before merge. Earlier slice verification and the final corpus/workbench evidence are recorded in the remediation evidence report on the performance branch.

Rollout: merge this prerequisite first; no database migration is needed. Rollback must preserve the credential isolation and production-build gate.
