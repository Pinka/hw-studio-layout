/* The system graph laid out in columns, drawn as SVG (desktop) or lines (terminal). */

export type Endpoint = { block: string; port: string }
export type Net = { from: Endpoint; to: Endpoint[] }
export type Block = { id: string; type: string; params?: Record<string, unknown>; position?: { x: number; y: number } }
export type Graph = { board?: string; blocks: Block[]; nets: Net[] }

/** One box of the drawing: a block, or a board pin at either edge. */
export type Node = { id: string; title: string; sub: string; lines: string[]; tip: string; kind: 'block' | 'in' | 'out'; col: number; y: number; h: number }
/** The part of the drawing in view, in drawing units; the whole drawing when absent. */
export type Frame = { x: number; y: number; w: number; h: number }
export type Edge = { from: string; fromPort: string; to: string; toPort: string }
export type Layout = { nodes: Node[]; edges: Edge[]; clocks: string[]; width: number; height: number }

const NODE_W = 170
const PIN_W = 110
const COL_GAP = 70
const ROW_GAP = 22
const PAD = 16

// The clock reaches nearly every block: drawn as a note, not as wires.
const isClock = (net: Net) => net.from.block === 'board' && /clk/i.test(net.from.port)

export function layout(graph: Graph): Layout {
  const blocks = new Map(graph.blocks.map(block => [block.id, block]))
  const edges: Edge[] = []
  const clocks: string[] = []
  for (const net of graph.nets) {
    if (isClock(net)) {
      clocks.push(`${net.from.port} → ${net.to.length} block${net.to.length === 1 ? '' : 's'}`)
      continue
    }
    for (const to of net.to) {
      edges.push({
        from: net.from.block === 'board' ? `in:${net.from.port}` : net.from.block,
        fromPort: net.from.port,
        to: to.block === 'board' ? `out:${to.port}` : to.block,
        toPort: to.port,
      })
    }
  }

  // Wires between the same two boxes (colour.r/g/b → rgb_led) draw as one, its ports listed.
  const merged = new Map<string, Edge>()
  for (const edge of edges) {
    const key = `${edge.from}>${edge.to}`
    const seen = merged.get(key)
    if (!seen) merged.set(key, { ...edge })
    else {
      if (!seen.fromPort.split(',').includes(edge.fromPort)) seen.fromPort += `,${edge.fromPort}`
      if (!seen.toPort.split(',').includes(edge.toPort)) seen.toPort += `,${edge.toPort}`
    }
  }
  edges.splice(0, edges.length, ...merged.values())

  // Column of a block: the longest chain of data wires leading to it (a loop stops growing after n rounds).
  const depth = new Map(graph.blocks.map(block => [block.id, 0]))
  for (let round = 0; round < graph.blocks.length; round++) {
    let changed = false
    for (const edge of edges) {
      if (!blocks.has(edge.from) || !blocks.has(edge.to)) continue
      const next = depth.get(edge.from)! + 1
      if (next > depth.get(edge.to)!) {
        depth.set(edge.to, next)
        changed = true
      }
    }
    if (!changed) break
  }
  const hasInputs = edges.some(edge => edge.from.startsWith('in:'))
  const first = hasInputs ? 1 : 0
  const lastBlockCol = first + Math.max(0, ...depth.values())

  // A board output sits one column past whatever drives it, so its wire never runs behind other blocks.
  const colOf = (id: string) => (id.startsWith('in:') ? 0 : first + (depth.get(id) ?? lastBlockCol - first))
  const nodes: Node[] = []
  const pins = new Set<string>()
  for (const edge of edges) {
    for (const id of [edge.from, edge.to]) {
      if ((id.startsWith('in:') || id.startsWith('out:')) && !pins.has(id)) {
        pins.add(id)
        const isIn = id.startsWith('in:')
        const col = isIn ? 0 : 1 + Math.max(...edges.filter(one => one.to === id).map(one => colOf(one.from)))
        const title = id.slice(id.indexOf(':') + 1)
        nodes.push({ id, title, sub: 'board', lines: [], tip: `board.${title} (${isIn ? 'input' : 'output'} pin)`, kind: isIn ? 'in' : 'out', col, y: 0, h: 34 })
      }
    }
  }
  for (const block of graph.blocks) {
    const params = Object.entries(block.params ?? {}).map(([name, value]) => `${name} = ${value}`)
    const tip = [`${block.id} (${block.type})`, ...params].join('\n')
    nodes.push({ id: block.id, title: block.id, sub: block.type, lines: params.slice(0, 3), tip, kind: 'block', col: first + depth.get(block.id)!, y: 0, h: 42 + Math.min(3, params.length) * 14 })
  }

  // Within a column: the System view canvas's order first, then a few sweeps that move each box
  // towards the boxes it is wired to (mean row of its neighbours), which untangles most crossings.
  const at = (node: Node) => blocks.get(node.id)?.position ?? { x: 0, y: 0 }
  const columns = new Map<number, Node[]>()
  for (const node of nodes) columns.set(node.col, [...(columns.get(node.col) ?? []), node])
  const order = [...columns.keys()].sort((a, b) => a - b)
  const row = new Map<string, number>()
  const place = () => {
    for (const column of columns.values()) column.forEach((node, i) => row.set(node.id, i))
  }
  for (const column of columns.values()) column.sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x || a.title.localeCompare(b.title))
  place()
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0
    for (const col of forward ? order.slice(1) : order.slice(0, -1).reverse()) {
      const column = columns.get(col)!
      const mean = (node: Node) => {
        const near = edges.flatMap(edge => (forward ? (edge.to === node.id ? [edge.from] : []) : edge.from === node.id ? [edge.to] : []))
        return near.length ? near.reduce((sum, id) => sum + row.get(id)!, 0) / near.length : row.get(node.id)!
      }
      const keys = new Map(column.map(node => [node.id, mean(node)]))
      column.sort((a, b) => keys.get(a.id)! - keys.get(b.id)! || row.get(a.id)! - row.get(b.id)!)
      column.forEach((node, i) => row.set(node.id, i))
    }
  }
  let height = 0
  for (const column of columns.values()) {
    let y = PAD + 18
    for (const node of column) {
      node.y = y
      y += node.h + ROW_GAP
    }
    height = Math.max(height, y)
  }
  const right = Math.max(...nodes.map(node => colX(node.col, hasInputs) + (node.kind === 'block' ? NODE_W : PIN_W)))
  return { nodes, edges, clocks, width: PAD * 2 + right, height: height + PAD }
}

function colX(col: number, hasInputs: boolean) {
  if (!hasInputs) return col * (NODE_W + COL_GAP)
  return col === 0 ? 0 : PIN_W + COL_GAP + (col - 1) * (NODE_W + COL_GAP)
}

export const MAX_ZOOM = 8

/**
 * The frame that shows the whole drawing in a window `aspect` (height / width) tall: the drawing's
 * width or height, whichever fills the window first, with room around the other.
 */
export function fitOf(view: Layout, aspect: number) {
  const w = Math.max(view.width, view.height / aspect)
  return { w, h: w * aspect }
}

/** The part of the drawing a camera sees, in a window `aspect` (height / width) tall. */
export function frameOf(view: Layout, camera: { zoom: number; cx: number; cy: number }, aspect: number): Frame {
  const fit = fitOf(view, aspect)
  const w = fit.w / camera.zoom
  const h = fit.h / camera.zoom
  return { x: camera.cx * view.width - w / 2, y: camera.cy * view.height - h / 2, w, h }
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The drawing as SVG markup. With a frame, only that part is in view, drawn 1000 wide and the frame's
 * shape tall: that is how the pane zooms and pans. Hovering a box lights it and its wires, and its title
 * lists every param (where the surface lets the pointer reach the drawing).
 */
export function svgOf(view: Layout, frame?: Frame) {
  const hasInputs = view.nodes.some(node => node.kind === 'in')
  const box = new Map(
    view.nodes.map(node => {
      const w = node.kind === 'block' ? NODE_W : PIN_W
      return [node.id, { x: PAD + colX(node.col, hasInputs), y: node.y, w, h: node.h }]
    }),
  )
  const f = frame ?? { x: 0, y: 0, w: view.width, h: view.height }
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.x} ${f.y} ${f.w} ${f.h}" width="${frame ? 1000 : view.width}" height="${frame ? Math.round((1000 * f.h) / f.w) : view.height}" preserveAspectRatio="xMidYMid meet" font-family="ui-monospace, Menlo, Consolas, monospace">`,
    `<style>.node:hover rect{stroke:#7dd3fc;stroke-width:2}.wire:hover path{stroke-opacity:1;stroke-width:3}.wire:hover text{fill:#e6e9ef}</style>`,
    `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="#16181d"/>`,
    `<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#7dd3fc"/></marker></defs>`,
  ]
  if (view.clocks.length) out.push(`<text x="${PAD}" y="${PAD + 4}" font-size="11" fill="#8b93a3">clock: ${esc(view.clocks.join(', '))}</text>`)
  // Several wires leaving or reaching one box spread along its edge, in the order of the boxes at their other end.
  const slot = (id: string, end: 'from' | 'to', edge: Edge) => {
    const other = end === 'from' ? 'to' : 'from'
    const mine = view.edges.filter(one => one[end] === id).sort((p, q) => (box.get(p[other])?.y ?? 0) - (box.get(q[other])?.y ?? 0))
    const b = box.get(id)!
    return b.y + (b.h * (mine.indexOf(edge) + 1)) / (mine.length + 1)
  }
  for (const edge of view.edges) {
    const a = box.get(edge.from)
    const b = box.get(edge.to)
    if (!a || !b) continue
    const x1 = a.x + a.w
    const y1 = slot(edge.from, 'from', edge)
    const x2 = b.x
    const y2 = slot(edge.to, 'to', edge)
    // A wire that runs back (a loop) bends out to the right and comes round.
    const bend = Math.max(40, Math.abs(x2 - x1) / 2)
    const name = (id: string, port: string) => (id.includes(':') ? `board.${port}` : `${id}.${port}`)
    out.push(`<g class="wire"><title>${esc(`${name(edge.from, edge.fromPort)} → ${name(edge.to, edge.toPort)}`)}</title>`)
    // A wide clear stroke under the wire makes it easy to hover.
    out.push(`<path d="M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}" fill="none" stroke="#16181d" stroke-opacity="0.01" stroke-width="10"/>`)
    out.push(`<path d="M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}" fill="none" stroke="#7dd3fc" stroke-opacity="0.75" stroke-width="1.5" marker-end="url(#arrow)"/>`)
    out.push(`<text x="${x1 + 4}" y="${y1 - 4}" font-size="9" fill="#9fb3c8">${esc(edge.fromPort)}</text>`)
    out.push(`<text x="${x2 - 4}" y="${y2 - 4}" font-size="9" fill="#9fb3c8" text-anchor="end">${esc(edge.toPort)}</text>`)
    out.push('</g>')
  }
  for (const node of view.nodes) {
    const { x, y, w, h } = box.get(node.id)!
    out.push(`<g class="node"><title>${esc(node.tip)}</title>`)
    if (node.kind === 'block') {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#232733" stroke="#4b5568"/>`)
      out.push(`<text x="${x + 10}" y="${y + 18}" font-size="12" font-weight="bold" fill="#e6e9ef">${esc(node.title)}</text>`)
      out.push(`<text x="${x + 10}" y="${y + 32}" font-size="10" fill="#8b93a3">${esc(node.sub)}</text>`)
      node.lines.forEach((line, i) => out.push(`<text x="${x + 10}" y="${y + 48 + i * 14}" font-size="10" fill="#c3c9d4">${esc(line)}</text>`))
    } else {
      const fill = node.kind === 'in' ? '#14322a' : '#33261a'
      const stroke = node.kind === 'in' ? '#34d399' : '#fbbf24'
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="17" fill="${fill}" stroke="${stroke}"/>`)
      out.push(`<text x="${x + w / 2}" y="${y + 21}" font-size="11" fill="#e6e9ef" text-anchor="middle">${esc(node.title)}</text>`)
    }
    out.push('</g>')
  }
  out.push('</svg>')
  return out.join('')
}

/** The same graph as lines, for the terminal (no Svg there). */
export function textOf(view: Layout) {
  const lines: string[] = []
  const columns = [...new Set(view.nodes.map(node => node.col))].sort((a, b) => a - b)
  for (const col of columns) {
    const names = view.nodes.filter(node => node.col === col).map(node => (node.kind === 'block' ? `${node.title} (${node.sub}${node.lines.length ? `: ${node.lines.join(', ')}` : ''})` : `[${node.title}]`))
    lines.push(`${col + 1}. ${names.join('  ·  ')}`)
  }
  lines.push('')
  for (const edge of view.edges) lines.push(`${edge.from.replace(/^(in|out):/, 'board.')}${edge.from.includes(':') ? '' : `.${edge.fromPort}`} → ${edge.to.replace(/^(in|out):/, 'board.')}${edge.to.includes(':') ? '' : `.${edge.toPort}`}`)
  if (view.clocks.length) lines.push(`clock: ${view.clocks.join(', ')}`)
  return lines.join('\n')
}

export const folderName = (dir: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? dir
