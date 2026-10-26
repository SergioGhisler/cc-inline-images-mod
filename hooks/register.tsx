import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

import { cellsFor, type Encoded, imagesIn, type Picture, pasteMarkers, pngSize } from './pictures'

const MAX_PIXELS = 1024
const MAX_PNG_BYTES = 2 * 1024 * 1024
const RESULT_INDENT = 5
const PROMPT_INDENT = 2

const pictures = new Map<string, Picture | null>()
const loading = new Set<string>()
let pasteFolder: string | undefined

export const register: Register = on => {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isErrored || e.props.isExpanded) return row
    const shown = load($, keyed(e.props.tool_use_id, imagesIn(e.props.output)))
    return gallery($.ui.resolve(e), row, shown, RESULT_INDENT, e.viewport?.columns)
  })

  // An expanded row draws its output inline, with no ToolResult beneath it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || !e.props.isExpanded || e.props.isRunning || e.props.isErrored) return row
    const shown = load($, keyed(e.props.tool_use_id, imagesIn(e.props.output)))
    return gallery($.ui.resolve(e), row, shown, RESULT_INDENT, e.viewport?.columns)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isExpanded) return row
    const sources = e.props.calls.flatMap((call, i) => keyed(call.tool_use_id ?? `${e.requestId}:${i}`, imagesIn(call.output)))
    return gallery($.ui.resolve(e), row, load($, sources), RESULT_INDENT, e.viewport?.columns)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    const markers = pasteMarkers(e.props.text)
    if (e.surface !== 'terminal' || markers.length === 0) return row
    const folder = await pasteFolderOf($)
    if (!folder) return row
    const shown = markers.flatMap(n => {
      const path = `${folder}/${n}.png`
      if (!pictures.has(path) && !loading.has(path)) void loadPaste($, path)
      return pictures.get(path) ?? []
    })
    return gallery($.ui.resolve(e), row, shown, PROMPT_INDENT, e.viewport?.columns)
  })
}

function keyed(id: string, images: Encoded[]): Array<{ key: string; image: Encoded }> {
  return images.map((image, i) => ({ key: `${id}:${i}`, image }))
}

function load($: EngineInterface, sources: Array<{ key: string; image: Encoded }>): Picture[] {
  for (const { key, image } of sources) {
    if (pictures.has(key) || loading.has(key)) continue
    loading.add(key)
    void pictureOf($, image)
      .then(picture => settle($, key, picture))
      .catch(error => settle($, key, null, error))
  }
  return sources.flatMap(({ key }) => pictures.get(key) ?? [])
}

function settle($: EngineInterface, key: string, picture: Picture | null, error?: unknown): void {
  loading.delete(key)
  pictures.set(key, picture)
  if (error !== undefined) $.ui.log(`inline-images: ${String(error)}`, { to: 'debug' })
  if (picture) $.ui.invalidate('ui.render')
}

async function loadPaste($: EngineInterface, path: string): Promise<void> {
  if (!(await $.fs.exists(path))) return
  loading.add(path)
  try {
    const { base64 } = await $.fs.read(path, { as: 'bytes' })
    settle($, path, await pictureOf($, { base64, mediaType: 'image/png' }))
  } catch (error) {
    settle($, path, null, error)
  }
}

async function pictureOf($: EngineInterface, image: Encoded): Promise<Picture | null> {
  if (image.mediaType === 'image/png') {
    const size = pngSize(image.base64)
    const isSmall = size && Math.max(size.width, size.height) <= MAX_PIXELS
    if (isSmall && (image.base64.length * 3) / 4 <= MAX_PNG_BYTES) return { png: image.base64, ...size }
  }
  const resize = `base64 -d | magick '-[0]' -auto-orient -resize '${MAX_PIXELS}x${MAX_PIXELS}>' -strip png:- | base64 -w0`
  const { exitCode, stdout, stderr } = await $.process.run(['/bin/sh', '-c', resize], { stdin: image.base64, timeoutMs: 20_000 })
  const png = stdout.trim()
  const size = exitCode === 0 ? pngSize(png) : undefined
  if (!size) throw new Error(`could not convert a ${image.mediaType} image: ${stderr.trim()}`)
  return { png, ...size }
}

async function pasteFolderOf($: EngineInterface): Promise<string | undefined> {
  if (pasteFolder) return pasteFolder
  const tmp = (await $.env.get('CLAUDE_CODE_TMPDIR')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  const uid = (await $.process.run(['id', '-u'])).stdout.trim()
  const session = await $.session.id()
  const base = `${tmp.replace(/\/+$/, '')}/claude-${uid}`
  for (const entry of await $.fs.list(base).catch(() => [])) {
    const candidate = `${base}/${entry.name}/${session}/images`
    if (entry.kind === 'dir' && (await $.fs.exists(candidate))) {
      pasteFolder = candidate
      return candidate
    }
  }
  return undefined
}

function gallery(
  els: ElementTable<'terminal'>,
  row: RenderElement,
  shown: Picture[],
  indent: number,
  viewportColumns = 80,
): RenderElement {
  if (shown.length === 0) return row
  const { Box, Image } = els
  return (
    <Box flexDirection="column">
      {row}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} paddingLeft={indent}>
        {shown.map((picture, i) => (
          <Image key={`image-${i}`} source={{ png: picture.png }} alt="[image]" {...cellsFor(picture, viewportColumns - indent - 2)} />
        ))}
      </Box>
    </Box>
  )
}
