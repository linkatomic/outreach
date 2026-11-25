import handler from '../../api/admin-tools.js'
import { adaptVercelHandler } from '../_lib/vercelAdapter.js'

export const onRequest = adaptVercelHandler(handler)
