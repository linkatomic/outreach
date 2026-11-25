import handler from '../../api/ahrefs.js'
import { adaptVercelHandler } from '../_lib/vercelAdapter.js'

export const onRequest = adaptVercelHandler(handler)
