# SVG-Edit

This directory is a placeholder for the [SVG-Edit](https://github.com/SVG-Edit/svgedit)
standalone web application, used by slowdash-canvas to provide in-browser SVG editing.

## Installation

Run the download script to fetch the latest release:

```bash
bash download.sh
```

Or manually:

1. Download a release ZIP from https://github.com/SVG-Edit/svgedit/releases
2. Extract it so that `lib/svgedit/editor/index.html` exists.

## Usage

Once installed, the "Edit SVG" button in slowdash-canvas opens SVG-Edit in a
popup window pre-loaded with the selected SVG file via the `url=` parameter.
After editing, use SVG-Edit's **Save** action to write the file back through
the slowdash `/api/config/file/` endpoint.

## Skipping installation

Without SVG-Edit installed the editor still works fully — users can upload
SVG files from disk. The inline SVG property editor (fill, stroke, text) is
always available regardless of this optional dependency.
