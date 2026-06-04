import { google } from 'googleapis'
import 'dotenv/config'

function getOAuthClient() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return client
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getOAuthClient() })
}

export function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : null
}

export async function getSheetTabs(spreadsheetId) {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  })
  return res.data.sheets.map(s => ({
    name: s.properties.title,
    sheetId: s.properties.sheetId,
  }))
}

export async function getSheetRows(spreadsheetId, tabName, maxRows = null) {
  const sheets = getSheetsClient()
  const range = maxRows
    ? `'${tabName}'!A1:ZZ${maxRows}`
    : `'${tabName}'!A:ZZ`
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  })
  return res.data.values || []
}

export async function createOutputSheet(title, headers, rows) {
  const sheets = getSheetsClient()

  // Create the spreadsheet
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{ properties: { title: 'Websites' } }],
    },
  })
  const newId = created.data.spreadsheetId
  const sheetId = created.data.sheets[0].properties.sheetId

  // Write all data in one call
  await sheets.spreadsheets.values.update({
    spreadsheetId: newId,
    range: 'Websites!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers, ...rows] },
  })

  // Format header row: bold + freeze
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: newId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  })

  return `https://docs.google.com/spreadsheets/d/${newId}/edit`
}
