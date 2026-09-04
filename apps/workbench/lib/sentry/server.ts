import * as Sentry from '@sentry/nextjs'
import { sentryOptions, serverDsn } from './scrub'

const dsn = serverDsn()
if (dsn) Sentry.init(sentryOptions(dsn))
