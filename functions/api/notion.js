import handler from '../../api/notion.js'
import { adaptVercelHandler } from '../_lib/vercelAdapter.js'

export const onRequest = adaptVercelHandler(handler)
