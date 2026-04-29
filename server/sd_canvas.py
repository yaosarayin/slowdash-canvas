# sd_canvas.py — slowdash user module for the Canvas Editor
# Author: Yao Yin
# Created: 2026-04-29
#
# Load this as a user module in SlowdashProject.yaml to integrate Canvas Editor
# layouts into the home-page catalog and enable the /api/canvas/* endpoints.
#
#   SlowdashProject.yaml example:
#     system:
#       user_module:
#         file: sd_canvas.py    # path relative to SlowdashProject.yaml
#
# Once loaded, "slowcanvas-NAME.json" files in the project config directory
# appear in /api/config/contentlist with type "slowcanvas", which the home-page
# catalog panel maps to "/slowcanvas.html?config=slowcanvas-NAME.json".

import os, glob, json, logging
import slowlette


# --- Slowdash user-module entry points --------------------------------------- #

app = slowlette.App()   # Picked up automatically by sd_usermodule.py


@app.get('/api/canvas/layouts')
async def list_canvas_layouts(request):
    """Return a list of available canvas layout names (without the prefix/ext)."""
    project_dir = _get_project_dir(request)
    if project_dir is None:
        return []

    config_dir = os.path.join(project_dir, 'config')
    layouts = []
    for path in sorted(glob.glob(os.path.join(config_dir, 'slowcanvas-*.json'))):
        name = os.path.splitext(os.path.basename(path))[0]   # "slowcanvas-Foo"
        _, label = name.split('-', 1)                          # "Foo"
        layouts.append({
            'name': label,
            'file': os.path.basename(path),
            'mtime': int(os.path.getmtime(path)),
        })
    return layouts


@app.get('/api/config/contentlist')
async def extend_contentlist(request):
    """Append slowcanvas entries to the content list so the home catalog shows them."""
    project_dir = _get_project_dir(request)
    if project_dir is None:
        return None   # returning None lets slowlette pass to the next handler

    config_dir = os.path.join(project_dir, 'config')
    entries = []
    for path in sorted(glob.glob(os.path.join(config_dir, 'slowcanvas-*.json'))):
        basename = os.path.basename(path)
        rootname = os.path.splitext(basename)[0]
        _, name = rootname.split('-', 1)
        title = name
        try:
            with open(path) as f:
                doc = json.load(f)
                title = doc.get('meta', {}).get('title', name)
        except Exception:
            pass
        entries.append({
            'type': 'slowcanvas',
            'name': name,
            'title': title,
            'mtime': int(os.path.getmtime(path)),
            'config_file': basename,
            'description': '',
        })

    # Return None so the aggregation merges rather than replaces upstream output.
    # Slowlette aggregation concatenates list results from multiple handlers.
    return entries if entries else None


# ---------------------------------------------------------------------------- #

def _get_project_dir(request):
    """Extract the project directory from the app attached to the request."""
    try:
        return request.app.project_dir
    except AttributeError:
        return None
