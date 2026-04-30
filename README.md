# slowdash-canvas

A visual canvas editor for [SlowDash](https://github.com/slowcontrol/slowdash) that lets you place
SVG diagrams on screen and overlay interactive elements — live data displays, plot navigation
buttons, and script control buttons — without writing any code.

## Features

| Feature | Description |
|---|---|
| **SVG background** | Upload any SVG (floor plan, schematic, etc.) and position it on the canvas. |
| **Inline SVG editor** | Click SVG elements to change fill, stroke, and text directly in the browser. Full SVG-Edit integration available (see [lib/svgedit](lib/svgedit/README.md)). |
| **Plot buttons** | Clickable buttons that open a SlowPlot layout in a new tab. |
| **Data displays** | Live readouts of SlowDash data channels with configurable format strings and active/inactive colour coding. |
| **Control buttons** | Buttons that send commands to SlowDash user-module scripts. |
| **Pan / zoom** | Mouse-wheel zoom, middle-mouse pan across the canvas. |
| **Save / open** | Layouts saved as `slowcanvas-NAME.json` in the project config directory; loaded via URL `?config=`. |

## Quick start

```bash
# 1. Clone into the slowdash repo as a submodule
cd /path/to/slowdash
git submodule add <this-repo-url> slowdash-canvas

# 2. Install (creates symlinks into app/site/)
bash slowdash-canvas/install.sh

# 3. Restart slowdash, then open:
#    http://localhost:18881/slowcanvas.html
```

The editor opens in **Edit** mode when no layout is specified.  Use the toolbar on the left to:

- **Upload SVG** — pick a local SVG file; it is stored in your project config directory.
- **Edit SVG** — open the background SVG in SVG-Edit (requires [installation](lib/svgedit/README.md)).
- **Add Plot Button** — add a button that navigates to a SlowPlot URL.
- **Add Data Display** — add a live readout bound to a data channel.
- **⚙ Add Control Button** — add a button that runs a SlowDash script action.

Click any item to select it; the **Properties** panel on the right lets you edit its label, size,
colour, and type-specific settings.  Click **💾** in the header to save.

## Home-page catalog integration

To make canvas layouts appear on the SlowDash home page alongside SlowPlot and SlowDash entries,
add `slowcanvas` to the catalog type list and load `sd_canvas.py` as a user module:

```yaml
# SlowdashProject.yaml
system:
  user_module:
    file: path/to/slowdash-canvas/server/sd_canvas.py
```

If you have a custom `slowdash-Home.json` layout, add `slowcanvas` to the `catalog_type` string:

```json
{ "type": "catalog", "catalog_type": "slowdash,slowplot,slowcruise,slowcanvas,userhtml" }
```

## Canvas layout format

Layouts are plain JSON stored in `<project>/config/slowcanvas-NAME.json`:

```json
{
  "meta": { "name": "MySetup", "title": "My Experiment" },
  "canvas": {
    "viewBox": { "x": 0, "y": 0, "width": 1200, "height": 800 },
    "background": { "file": "svg-FloorPlan.svg", "x": 0, "y": 0, "width": 1200, "height": 800 },
    "dataRefresh": 10
  },
  "items": [
    {
      "id": "item-a1b2c3",
      "type": "plot-button",
      "x": 100, "y": 200, "width": 140, "height": 44,
      "label": "Temperature Plots",
      "href": "slowplot.html?config=slowplot-Temp.json",
      "style": { "fill": "#3498db", "color": "white", "rx": 8 }
    },
    {
      "id": "item-d4e5f6",
      "type": "data-display",
      "x": 300, "y": 200, "width": 180, "height": 70,
      "label": "Temperature",
      "channel": "temperature_sensor",
      "format": "%.2f °C",
      "active-above": 0
    },
    {
      "id": "item-g7h8i9",
      "type": "control-button",
      "x": 500, "y": 200, "width": 140, "height": 44,
      "label": "Reset System",
      "action": "reset_system",
      "params": {},
      "style": { "fill": "#e74c3c", "color": "white", "rx": 8 }
    }
  ]
}
```

## File structure

```
slowdash-canvas/
├── install.sh              # Symlink installer
├── site/
│   ├── slowcanvas.html     # Entry page (linked to app/site/)
│   └── slowcanvas/         # JS + CSS bundle (linked to app/site/slowcanvas/)
│       ├── canvas-api.mjs      API client (wraps /api/config/*, /api/data/*)
│       ├── canvas-items.mjs    Item type renderers (plot-button, data-display, control-button)
│       ├── canvas-editor.mjs   SVG viewport (pan, zoom, drag, selection, handles)
│       ├── canvas-dialogs.mjs  Dialog boxes and properties panel
│       ├── canvas-app.mjs      Main orchestration (header, load/save, data refresh)
│       └── canvas.css          Layout and component styles
├── server/
│   └── sd_canvas.py        Optional user module (adds slowcanvas to the home catalog)
└── lib/
    └── svgedit/            SVG-Edit integration (optional; see lib/svgedit/README.md)
```

## Requirements

- SlowDash ≥ 2024 (uses `jagaimo.mjs`, `frame.mjs`, and the standard `/api/*` routes)
- A modern browser (Chrome 90+, Firefox 90+, Safari 16+)
- No Node.js, no npm, no build step

## License

MIT
