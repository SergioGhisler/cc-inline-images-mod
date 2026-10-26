export type Encoded = { base64: string; mediaType: string }
export type Picture = { png: string; width: number; height: number }
export type Cells = { columns: number; rows: number }

const MAX_COLUMNS = 56
const MAX_ROWS = 16
const MIN_COLUMNS = 8
const PIXELS_PER_COLUMN = 12
// A terminal cell is about twice as tall as it is wide.
const CELL_ASPECT = 0.5

export function imagesIn(value: unknown, depth = 0): Encoded[] {
  if (depth > 8 || value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(item => imagesIn(item, depth + 1))
  const record = value as Record<string, unknown>
  if (record.type === 'image') {
    const found = encodedOf(record)
    if (found) return [found]
  }
  return Object.values(record).flatMap(item => imagesIn(item, depth + 1))
}

function encodedOf(block: Record<string, unknown>): Encoded | undefined {
  const source = asRecord(block.source)
  const file = asRecord(block.file)
  const base64 = firstString(source?.data, block.data, file?.base64)
  const mediaType = firstString(source?.media_type, block.mimeType, block.media_type, file?.type)
  return base64 && mediaType?.startsWith('image/') ? { base64, mediaType } : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0)
}

export function pngSize(base64: string): { width: number; height: number } | undefined {
  let head: string
  try {
    head = atob(base64.slice(0, 32))
  } catch {
    return undefined
  }
  if (head.length < 24 || !head.startsWith('\x89PNG')) return undefined
  const word = (at: number) => ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0
  const width = word(16)
  const height = word(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

export function cellsFor(picture: { width: number; height: number }, viewportColumns: number): Cells {
  const limit = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, viewportColumns))
  const rowsPerColumn = (picture.height / picture.width) * CELL_ASPECT
  let columns = Math.max(MIN_COLUMNS, Math.min(limit, Math.round(picture.width / PIXELS_PER_COLUMN)))
  let rows = Math.max(1, Math.round(columns * rowsPerColumn))
  if (rows > MAX_ROWS) {
    rows = MAX_ROWS
    columns = Math.max(1, Math.round(rows / rowsPerColumn))
  }
  return { columns: Math.min(columns, 255), rows: Math.min(rows, 255) }
}

export function pasteMarkers(text: string): number[] {
  return [...new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map(match => Number(match[1])))]
}
