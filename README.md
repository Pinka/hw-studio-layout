# hw-studio-layout

A Claude Code mod for [hw-studio](https://github.com/Pinka/hw-studio): when the `hw-studio` skill runs, a **System layout** pane opens beside the chat and draws the current design's block system (`system.json`), with a link to open the same design in the hw-studio web app.

- Board input pins on the left, board output pins on the right, blocks in columns by how far they sit from the inputs, each with its type and first params. Wires carry their port names; the clock is a note, not a wire.
- **Drag** on the map to pan, **wheel** to zoom towards the pointer, or use the − / + / Fit / arrow buttons.
- It follows the design the hw-studio tools last worked on, and redraws after each of their calls.
- **Open in hw-studio** opens the design in the studio's System view (`/studio?variant=system&dir=<folder>`).
- In a terminal the layout is drawn as text.

Reopen the pane any time with `/hw-layout`.

## Install

At the prompt of a terminal session:

```
/plugin install hw-studio-layout --marketplace Pinka/hw-studio-layout
```

Answer `y` to add the marketplace, then pick a scope (user is the first).

From a shell:

```
claude plugin install hw-studio-layout --marketplace Pinka/hw-studio-layout
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Pinka/hw-studio-layout`, then Add plugin.

## Setting

**Studio URL** (default `http://localhost:3000`): where the hw-studio web app runs (`npm run dev`). Change it in the plugin's config if your studio runs on another port.
