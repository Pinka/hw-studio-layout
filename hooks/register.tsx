import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Camera, LayoutTarget } from '../types'

import { fitOf, folderName, frameOf, layout, MAX_ZOOM, svgOf, textOf, type Graph } from './layout'

const PANE = 'hw-studio-layout'
const TITLE = 'System layout'
const target = atom({ plugin: 'hw-studio-layout', key: 'target' } as const, null as LayoutTarget | null)
const camera = atom({ plugin: 'hw-studio-layout', key: 'camera' } as const, null as Camera | null)

const ZOOM_STEP = 1.25
/** A cell's height over its width on the desktop: turns the pane's rows and columns into the map's shape. */
const CELL_ASPECT = 2.4

/** How much of the drawing (as fractions of its width and height) the window shows at zoom 1. */
type Span = { w: number; h: number }

/** Moves the camera on the design in view; a camera left from another design starts over from the whole drawing. */
async function moveCamera($: EngineInterface, move: (now: Camera) => Camera) {
  const dir = (await read($, target))?.dir
  if (!dir) return
  await update($, camera, now => {
    const start: Camera = now && now.dir === dir ? now : { dir, zoom: 1, cx: 0.5, cy: 0.5 }
    const next = move(start)
    const zoom = Math.min(MAX_ZOOM, Math.max(1, next.zoom))
    // The centre stays on the drawing, so some of it is always in view.
    const clamp = (value: number) => Math.min(1, Math.max(0, value))
    return { dir, zoom, cx: clamp(next.cx), cy: clamp(next.cy) }
  })
}

/** Zooms by `factor`; with a point (fractions of the window), that point stays under the pointer as real editors do. */
function zoomBy($: EngineInterface, span: Span, factor: number, at?: { fx: number; fy: number }) {
  return moveCamera($, now => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, now.zoom * factor))
    if (!at) return { ...now, zoom }
    // The drawing point under (fx, fy) before and after must match.
    const px = now.cx + ((at.fx - 0.5) * span.w) / now.zoom
    const py = now.cy + ((at.fy - 0.5) * span.h) / now.zoom
    return { dir: now.dir, zoom, cx: px - ((at.fx - 0.5) * span.w) / zoom, cy: py - ((at.fy - 0.5) * span.h) / zoom }
  })
}

/** Pans by a fraction of the window, from `from` (the camera when a drag began) or from where it is now. */
function panBy($: EngineInterface, span: Span, dx: number, dy: number, from?: Camera) {
  return moveCamera($, now => {
    const start = from && from.dir === now.dir ? from : now
    return { ...now, cx: start.cx + (dx * span.w) / now.zoom, cy: start.cy + (dy * span.h) / now.zoom }
  })
}

async function exists($: EngineInterface, file: string) {
  try {
    await $.fs.read(file)
    return true
  } catch {
    return false
  }
}

/** The project to show: the session's folder when it is one, else the studio's most recent. */
async function currentDir($: EngineInterface): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  if (await exists($, `${cwd}/hw.json`)) return cwd
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return undefined
  try {
    const recents = JSON.parse(await $.fs.read(`${home}/.hw-studio/recents.json`)) as { projects?: { path: string }[] }
    return recents.projects?.[0]?.path
  } catch {
    return undefined
  }
}

async function show($: EngineInterface, dir: string | undefined) {
  if (dir) await update($, target, now => ({ dir, rev: (now?.rev ?? 0) + 1 }))
  await $.ui.open({ id: PANE, title: TITLE })
}

async function openInBrowser($: EngineInterface, url: string) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  await $.process.run(isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', url] : ['open', url])
}

export const register: Register = (on, options) => {
  const studioUrl = String(options.studioUrl ?? 'http://localhost:3000').replace(/\/+$/, '')
  const linkFor = (dir: string) => `${studioUrl}/studio?variant=system&dir=${encodeURIComponent(dir)}`

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hw-layout', description: 'Show the current hw-studio design’s system layout' })
    return next(e)
  })

  on('command.run', { command: 'hw-layout' }, async $ => {
    // The studio's recents move with every hw-studio tool and the studio itself, so they win over the last one shown.
    const dir = (await currentDir($)) ?? (await read($, target))?.dir
    await show($, dir)
    return { text: dir ? `Showing ${folderName(dir)}.` : 'No hw-studio project found.' }
  })

  // The hw-studio skill: open the pane on the design it is about to work on.
  on('skill.prompt', { skill: 'hw-studio' }, async ($, e, next) => {
    const result = await next(e)
    await show($, (await currentDir($)) ?? (await read($, target))?.dir)
    return result
  })

  // Follow the project the hw-studio tools work on, and redraw after each call (the graph may have changed).
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (typeof e.tool === 'string' && e.tool.startsWith('mcp__hw-studio__')) {
      const dir = (e as { dir?: unknown }).dir
      const now = await read($, target)
      if (typeof dir === 'string' && dir) await update($, target, () => ({ dir, rev: (now?.rev ?? 0) + 1 }))
      else if (now) await update($, target, () => ({ ...now, rev: now.rev + 1 }))
    }
    return result
  }).catch(($, e, next) => next(e)) // a failed redraw never stands in the tool's way

  // Where the map sits in the pane, as last drawn (its first row, its size in cells, how much of the drawing it
  // spans at zoom 1): the wheel's cell becomes a point on the drawing. Undefined while no map is drawn.
  let drawn: { top: number; columns: number; rows: number; span: Span } | undefined
  // The camera when the current drag began: each post says how far the pointer is from where it started.
  let dragFrom: { id: number; camera: Camera | null } | undefined

  // The wheel over the pane zooms the map (towards the pointer); the scroll keys still scroll the pane.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!e.pointer || !drawn) return next(e)
    const fx = Math.min(1, Math.max(0, e.pointer.column / drawn.columns))
    const fy = Math.min(1, Math.max(0, (e.pointer.row - drawn.top) / drawn.rows))
    await zoomBy($, drawn.span, Math.pow(ZOOM_STEP, -e.by), { fx, fy })
    return {}
  }).catch(($, e, next) => next(e)) // a failed zoom leaves the wheel scrolling the pane

  // Dragging on the map (drag.tsx) pans it: the drawing follows the pointer.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = e.data as { id?: unknown; dx?: unknown; dy?: unknown } | null
    if (!drawn || !data || typeof data.id !== 'number' || typeof data.dx !== 'number' || typeof data.dy !== 'number') return {}
    if (dragFrom?.id !== data.id) dragFrom = { id: data.id, camera: await read($, camera) }
    await panBy($, drawn.span, -data.dx, -data.dy, dragFrom.camera ?? undefined)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e) as Record<string, any>
    const { Box, Text, Button, Link } = ui
    const now = await read($, target)
    drawn = undefined
    if (!now) return <Text dimColor>No hw-studio project yet. Run the hw-studio skill, or /hw-layout.</Text>

    const url = linkFor(now.dir)
    const openButton = (
      <Button
        key="open-studio"
        label="Open in browser"
        onPress={() => openInBrowser($, url)}
      />
    )
    const footer = (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" gap={1}>
          {openButton}
          <Link href={url} label="Open in hw-studio" />
        </Box>
        <Text dimColor>{url}</Text>
      </Box>
    )

    let graph: Graph
    try {
      graph = JSON.parse(await $.fs.read(`${now.dir}/system.json`)) as Graph
    } catch {
      const isProject = await exists($, `${now.dir}/hw.json`)
      return (
        <Box flexDirection="column">
          <Text bold>{folderName(now.dir)}</Text>
          <Text dimColor>
            {isProject
              ? 'Written as Verilog (no system.json): the studio shows its design read-only, and Convert to System… turns it into one.'
              : `No hw-studio project in ${now.dir}.`}
          </Text>
          {isProject && footer}
        </Box>
      )
    }

    const view = layout(graph)
    const summary = `${graph.board ?? 'board?'} · ${graph.blocks.length} blocks · ${view.edges.length} wires`
    if (!ui.Svg) {
      return (
        <Box flexDirection="column">
          <Text bold>
            {folderName(now.dir)} <Text dimColor>{summary}</Text>
          </Text>
          <Text>{textOf(view)}</Text>
          {footer}
        </Box>
      )
    }

    // The map fills the pane below the title and controls, above the links (about 5 rows of chrome).
    const columns = Math.max(20, e.viewport?.columns ?? 80)
    const rows = Math.max(8, (e.viewport?.rows ?? 30) - 6)
    const aspect = (rows * CELL_ASPECT) / columns
    const cam = await read($, camera)
    const shot = cam && cam.dir === now.dir ? cam : { dir: now.dir, zoom: 1, cx: 0.5, cy: 0.5 }
    const fit = fitOf(view, aspect)
    const span: Span = { w: fit.w / view.width, h: fit.h / view.height }
    drawn = { top: 2, columns, rows, span }
    const control = (key: string, label: string, press: () => Promise<void>) => <Button key={key} label={label} onPress={press} />
    return (
      <Box flexDirection="column">
        <Text bold>
          {folderName(now.dir)} <Text dimColor>{summary}</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          {control('zoom-out', '−', () => zoomBy($, span, 1 / ZOOM_STEP))}
          {control('zoom-in', '+', () => zoomBy($, span, ZOOM_STEP))}
          {control('fit', 'Fit', () => moveCamera($, () => ({ dir: now.dir, zoom: 1, cx: 0.5, cy: 0.5 })))}
          {control('pan-left', '←', () => panBy($, span, -0.25, 0))}
          {control('pan-up', '↑', () => panBy($, span, 0, -0.25))}
          {control('pan-down', '↓', () => panBy($, span, 0, 0.25))}
          {control('pan-right', '→', () => panBy($, span, 0.25, 0))}
          <Text dimColor>{Math.round(shot.zoom * 100)}% · drag to pan, wheel to zoom</Text>
        </Box>
        {/* The drawing, with a clear layer on top that takes the drags (an Svg itself takes no pointer). */}
        <Box position="relative" height={rows} overflow="hidden">
          <ui.Svg source={svgOf(view, frameOf(view, shot, aspect))} alt={`System layout of ${folderName(now.dir)}:\n${textOf(view)}`} />
          <Box position="absolute" top={0} left={0} width="100%" height="100%">
            <ui.Client key="drag" module="./drag.tsx" width="100%" height="100%" />
          </Box>
        </Box>
        {footer}
      </Box>
    )
  })
}
