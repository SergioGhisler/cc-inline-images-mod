import { expect, test } from 'claude-code/testing'

import { cellsFor, fitIn, imagesIn, pasteMarkers, pngSize } from './pictures'

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('a Read of an image yields its bytes', async () => {
  const output = { type: 'image', file: { base64: PNG_1x1, type: 'image/png', originalSize: 70 } }
  expect(imagesIn(output)).toEqual([{ base64: PNG_1x1, mediaType: 'image/png' }])
})

test('an MCP result yields each image block, in order', async () => {
  const output = [
    { type: 'text', text: 'a screenshot' },
    { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' },
    { type: 'image', source: { type: 'base64', data: 'BBBB', media_type: 'image/webp' } },
  ]
  expect(imagesIn(output)).toEqual([
    { base64: 'AAAA', mediaType: 'image/jpeg' },
    { base64: 'BBBB', mediaType: 'image/webp' },
  ])
})

test('a text result yields nothing', async () => {
  expect(imagesIn({ type: 'text', file: { filePath: '/a.png', content: 'x' } })).toEqual([])
})

test('a PNG header gives its size', async () => {
  expect(pngSize(PNG_1x1)).toEqual({ width: 1, height: 1 })
  expect(pngSize('/9j/4AAQSkZJRgABAQ')).toBe(undefined)
})

test('a picture keeps its shape within the limits', async () => {
  expect(cellsFor({ width: 1200, height: 600 }, 120)).toEqual({ columns: 56, rows: 14 })
  expect(cellsFor({ width: 600, height: 1200 }, 120)).toEqual({ columns: 16, rows: 16 })
  expect(cellsFor({ width: 1200, height: 600 }, 30)).toEqual({ columns: 30, rows: 8 })
})

test('an enlarged picture fills the room it is given, keeping its shape', async () => {
  expect(fitIn({ width: 1200, height: 600 }, { columns: 100, rows: 40 })).toEqual({ columns: 100, rows: 25 })
  expect(fitIn({ width: 600, height: 1200 }, { columns: 100, rows: 40 })).toEqual({ columns: 40, rows: 40 })
})

test('paste markers are read once each', async () => {
  expect(pasteMarkers('see [Image #2] and [Image #10], again [Image #2]')).toEqual([2, 10])
})
