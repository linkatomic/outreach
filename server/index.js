import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { sheetParserRouter } from './routes/sheetParser.js'

const app = express()

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4173'] }))
app.use(express.json())

app.use('/api/sheet-parser', sheetParserRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`API server running on http://localhost:${PORT}`))
