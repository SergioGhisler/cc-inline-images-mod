import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

import { type Cells, cellsFor, type Encoded, fitIn, imagesIn, type Picture, pasteMarkers, pngSize } from './pictures'

const MAX_PIXELS = 1024
const LARGE_PIXELS = [2048, 1536, MAX_PIXELS]
const MAX_PNG_BYTES = 2 * 1024 * 1024
const RESULT_INDENT = 5
const PROMPT_INDENT = 2
const PROMPT_ROWS = 6
const CHAT_ROWS = ['AssistantMessage', 'ToolProgress', 'CommandOutput', 'TurnDuration', 'InfoNotice'] as const

type Shown = { key: string; picture: Picture }

const pictures = new Map<string, Picture | null>()
const loading = new Set<string>()
const originals = new Map<string, () => Promise<Encoded>>()
const large = new Map<string, Picture>()
let enlarged: string | undefined
let pasteFolder: string | undefined

export const register: Register = on => {
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') return row
    if (!enlarged && (e.props.isErrored || e.props.isExpanded)) return row
    const shown = load($, keyed(e.props.tool_use_id, imagesIn(e.props.output)))
    return gallery($, $.ui.resolve(e), row, shown, RESULT_INDENT, e.viewport)
  })

  // An expanded row draws its output inline, with no ToolResult beneath it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') return row
    if (!e.props.isExpanded || e.props.isRunning || e.props.isErrored) return besides($.ui.resolve(e), row)
    const shown = load($, keyed(e.props.tool_use_id, imagesIn(e.props.output)))
    return gallery($, $.ui.resolve(e), row, shown, RESULT_INDENT, e.viewport)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') return row
    if (!enlarged && e.props.isExpanded) return row
    const sources = e.props.calls.flatMap((call, i) => keyed(call.tool_use_id ?? `${e.requestId}:${i}`, imagesIn(call.output)))
    return gallery($, $.ui.resolve(e), row, load($, sources), RESULT_INDENT, e.viewport)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') return row
    const markers = pasteMarkers(e.props.text)
    const folder = markers.length > 0 ? await pasteFolderOf($) : undefined
    if (!folder) return besides($.ui.resolve(e), row)
    const shown = markers.flatMap(n => {
      const path = `${folder}/${n}.png`
      if (!pictures.has(path) && !loading.has(path)) void loadPaste($, path)
      const picture = pictures.get(path)
      return picture ? [{ key: path, picture }] : []
    })
    return gallery($, $.ui.resolve(e), row, shown, PROMPT_INDENT, e.viewport)
  })

  on('ui.render', { component: CHAT_ROWS }, async ($, e, next) => {
    const row = await next(e)
    return e.surface === 'terminal' ? besides($.ui.resolve(e), row) : row
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !enlarged) return next(e)
    const { Button } = $.ui.resolve(e)
    const key = enlarged
    return <Button key="close" label="✕ Close" onPress={() => void toggle($, key)} />
  })

  on('prompt.submit', async ($, e, next) => {
    if (enlarged) {
      enlarged = undefined
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })
}

function besides(els: ElementTable<'terminal'>, row: RenderElement): RenderElement {
  const { Box } = els
  return enlarged ? <Box display="none" /> : row
}

function keyed(id: string, images: Encoded[]): Array<{ key: string; image: Encoded }> {
  return images.map((image, i) => ({ key: `${id}:${i}`, image }))
}

function load($: EngineInterface, sources: Array<{ key: string; image: Encoded }>): Shown[] {
  for (const { key, image } of sources) {
    if (!originals.has(key)) originals.set(key, async () => image)
    if (pictures.has(key) || loading.has(key)) continue
    loading.add(key)
    void pictureOf($, image)
      .then(picture => settle($, key, picture))
      .catch(error => settle($, key, null, error))
  }
  return sources.flatMap(({ key }) => {
    const picture = pictures.get(key)
    return picture ? [{ key, picture }] : []
  })
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
  const read = async (): Promise<Encoded> => ({ base64: (await $.fs.read(path, { as: 'bytes' })).base64, mediaType: 'image/png' })
  originals.set(path, read)
  try {
    settle($, path, await pictureOf($, await read()))
  } catch (error) {
    settle($, path, null, error)
  }
}

async function toggle($: EngineInterface, key: string): Promise<void> {
  enlarged = enlarged === key ? undefined : key
  $.ui.invalidate('ui.render')
  if (!enlarged) return
  await $.ui.scroll({ to: { key: `takeover-${key}` }, block: 'start' })
  await loadLarge($, key)
}

async function loadLarge($: EngineInterface, key: string): Promise<void> {
  const original = originals.get(key)
  if (large.has(key) || !original) return
  try {
    const image = await original()
    for (const pixels of LARGE_PIXELS) {
      const picture = await pictureOf($, image, pixels)
      if ((picture.png.length * 3) / 4 > MAX_PNG_BYTES) continue
      large.set(key, picture)
      if (enlarged === key) $.ui.invalidate('ui.render')
      return
    }
  } catch (error) {
    $.ui.log(`inline-images: ${String(error)}`, { to: 'debug' })
  }
}

async function pictureOf($: EngineInterface, image: Encoded, maxPixels = MAX_PIXELS): Promise<Picture> {
  if (image.mediaType === 'image/png') {
    const size = pngSize(image.base64)
    const fits = size && Math.max(size.width, size.height) <= maxPixels
    if (fits && (image.base64.length * 3) / 4 <= MAX_PNG_BYTES) return { png: image.base64, ...size }
  }
  const resize = `base64 -d | magick '-[0]' -auto-orient -resize '${maxPixels}x${maxPixels}>' -strip png:- | base64 -w0`
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
  $: EngineInterface,
  els: ElementTable<'terminal'>,
  row: RenderElement,
  shown: Shown[],
  indent: number,
  viewport: { columns: number; rows: number } | undefined,
): RenderElement {
  if (shown.length === 0) return row
  const { Box } = els
  const columns = (viewport?.columns ?? 80) - indent - 2
  const open = shown.find(({ key }) => key === enlarged)
  if (enlarged) return open ? takeover(els, open, viewport) : <Box display="none" />
  return (
    <Box flexDirection="column">
      {row}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} paddingLeft={indent}>
        {shown.map(({ key, picture }) => (
          <Box key={`image-${key}`}>{pressable($, els, key, picture.png, cellsFor(picture, columns))}</Box>
        ))}
      </Box>
    </Box>
  )
}

function takeover(
  els: ElementTable<'terminal'>,
  { key, picture }: Shown,
  viewport: { columns: number; rows: number } | undefined,
): RenderElement {
  const { Box, Image } = els
  const columns = viewport?.columns ?? 80
  const rows = Math.max(8, (viewport?.rows ?? 40) - PROMPT_ROWS)
  const drawn = large.get(key) ?? picture
  return (
    <Box key={`takeover-${key}`} width={columns} height={rows} alignItems="center" justifyContent="center">
      <Image key={`large-${key}`} source={{ png: drawn.png }} alt="[image]" {...fitIn(picture, { columns: columns - 4, rows: rows - 2 })} />
    </Box>
  )
}

function pressable($: EngineInterface, els: ElementTable<'terminal'>, key: string, png: string, cells: Cells): RenderElement {
  const { Box, Button, Image } = els
  return (
    <Box key={`press-${key}`} flexDirection="column">
      <Image source={{ png }} alt="[image]" {...cells} />
      <Box height={1}>
        <Box display="none" hover={{ display: 'flex' }}>
          <Button key={`enlarge-${key}`} plain dimColor label="⤢ Enlarge" onPress={() => void toggle($, key)} />
        </Box>
      </Box>
    </Box>
  )
}
