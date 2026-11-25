import handler from '../../api/crisp-export.js'
import { adaptVercelHandler } from '../_lib/vercelAdapter.js'

export const onRequest = adaptVercelHandler(handler)
