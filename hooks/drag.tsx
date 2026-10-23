import type { ClientModule } from 'claude-code'

/** Where the current drag started, and which drag it is (a post may replace an undelivered one). */
type Drag = { id: number; x: number; y: number } | null

/**
 * A clear layer over the drawing: dragging with the left button posts how far the pointer is from where
 * the drag began, as a fraction of the layer, and the hooks module pans the camera by that much.
 */
const DragLayer: ClientModule<null, Drag> = (_props, surface) => {
  surface.onPointer(event => {
    const x = event.fine?.x ?? event.x
    const y = event.fine?.y ?? event.y
    if (event.type === 'down' && event.button === 'left') {
      surface.setState({ id: Date.now(), x, y })
    } else if (event.type === 'move' && surface.state && event.button === 'left') {
      const { id, x: x0, y: y0 } = surface.state
      surface.post({ id, dx: (x - x0) / Math.max(1, surface.columns), dy: (y - y0) / Math.max(1, surface.rows) })
    } else if (event.type === 'up' && surface.state) {
      surface.setState(null)
    }
  })
  const { Box } = surface.elements
  return <Box width="100%" height="100%" />
}

export default DragLayer
