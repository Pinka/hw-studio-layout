/** The design the pane shows: its folder, and a count bumped when its graph may have changed. */
export type LayoutTarget = { dir: string; rev: number }

/**
 * Where the pane looks in that design's drawing: `zoom` 1 shows it whole (up to 8), and the
 * view is centred on (`cx`, `cy`), fractions of the drawing's width and height.
 */
export type Camera = { dir: string; zoom: number; cx: number; cy: number }

declare module 'claude-code' {
  interface PluginState {
    'hw-studio-layout': { target: LayoutTarget | null; camera: Camera | null }
  }
}
