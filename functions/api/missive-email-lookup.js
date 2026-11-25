import handler from '../../api/missive-email-lookup.js'
import { adaptVercelHandler } from '../_lib/vercelAdapter.js'

export const onRequest = adaptVercelHandler(handler)
