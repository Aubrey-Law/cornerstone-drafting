import { integrationEnvironment, replaceEnvironment } from '../support/verificationEnvironment'

replaceEnvironment(integrationEnvironment(process.env))
