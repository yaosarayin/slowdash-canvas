// canvas-app.mjs — SlowDash Canvas Editor entry point
// Author: Yao Yin
//
// Split-panel layout:
//   ┌──────────── header (purple, slowdash Frame) ───────────┐
//   │  edit ▸ │ live preview (slowdash.html iframe)  │ tools │
//   │  view ▸ │                                       │ +    │
//   │         │                                       │ props│
//   └─────────┴───────────────────────────────────────┴──────┘
//
// Files are saved as `slowdash-NAME.json` so the same JSON is rendered by
// the existing slowdash.html viewer (auto-wraps view_box+items as a canvas
// panel — see slowdash.mjs:58–76).
//
// URL parameters:
//   config=slowdash-NAME.json   load this layout on startup
//   mode=edit|view              start mode (defaults: edit if no config given)

import { JG as $ } from '../slowjs/jagaimo/jagaimo.mjs';
import { Frame }  from '../slowjs/frame.mjs';
import { CanvasAPI }    from './canvas-api.mjs';
import { CanvasEditor } from './canvas-editor.mjs';
import {
    makeDefaultConfig, getPropertyFields, getItemTypes, getItemLabel,
} from './canvas-items.mjs';
import {
    openOpenCanvasDialog,
    openSaveCanvasDialog,
    openCanvasSizeDialog,
    buildPropertiesPanel,
    buildCanvasInspector,
} from './canvas-dialogs.mjs';

const AUTOSAVE_DELAY_MS = 800;


export class CanvasApp {
    constructor() {
        this.editor          = null;
        this.frame           = null;
        this.propsPanel      = null;
        this.canvasInspector = null;
        this.projectConfig   = null;
        this.layoutName      = null;       // name without prefix/ext
        this.layoutTitle     = null;
        this.editing         = false;
        this._previewIframe  = null;
        this._refreshTimer   = null;
        this._autosaveTimer  = null;
    }

    async run() {
        const params     = new URLSearchParams(window.location.search);
        const configFile = params.get('config');
        const modeParam  = params.get('mode');

        try {
            this.projectConfig = await CanvasAPI.getProjectConfig();
        } catch (e) {
            document.body.innerHTML = `<h3>Cannot connect to SlowDash backend: ${e.message}</h3>`;
            return;
        }

        // Load the theme CSS *before* building the header so its CSS variables
        // (--sd-header-bg etc.) are available the moment .sd-header renders.
        const theme = this.projectConfig?.style?.theme || 'light';
        try { await this._loadTheme(theme); }
        catch (e) { console.warn('Theme CSS failed to load; falling back to defaults.', e); }

        this._buildLayout();

        // Header — same Frame helper used by slowplot.html / slowdash.html
        const projTitle = this.projectConfig?.project?.title
                       || this.projectConfig?.project?.name
                       || 'SlowDash';
        this.frame = new Frame($('#sc-header'), {
            title: projTitle + ' — Canvas Editor',
            style: this.projectConfig?.style || {},
            initialStatus: 'Canvas Editor',
        });
        this._buildHeaderControls();

        this._wireEditorEvents();

        if (configFile) {
            await this._loadLayout(configFile);
        } else {
            this._newCanvas();
        }

        const startInEdit = (modeParam === 'edit') || !configFile || (modeParam !== 'view');
        this.setEditing(startInEdit);

        this._startDataRefresh();
    }


    // ── Theme load (mirrors Platform._load_theme in slowdash) ────────────── //

    _loadTheme(theme) {
        return new Promise((resolve, reject) => {
            const link = document.getElementById('sd-theme-css');
            if (!link) return resolve();
            link.addEventListener('load',  () => resolve(), { once: true });
            link.addEventListener('error', (e) => reject(e), { once: true });
            link.setAttribute('href', 'slowjs/slowdash-' + theme + '.css');
        });
    }


    // ── Mode toggle ──────────────────────────────────────────────────────── //

    setEditing(editing) {
        this.editing = editing;
        this.editor.setEditing(editing);

        const editBtn = document.getElementById('sc-edit-btn');
        if (editBtn) {
            editBtn.textContent = editing ? 'View' : 'Edit';
            editBtn.title       = editing ? 'Switch to view mode' : 'Switch to edit mode';
        }

        // In edit mode: show toolbar, props column, and live preview pane.
        // In view mode: collapse the editing UI and let the iframe (or fallback)
        // take the whole content area.
        document.getElementById('sc-toolbar').style.display    = editing ? 'flex' : 'none';
        document.getElementById('sc-props-col').style.display  = editing ? 'flex' : 'none';
        document.getElementById('sc-editor-col').style.display = editing ? 'flex' : 'none';
        document.getElementById('sc-preview-col').style.flex   = editing ? '0 0 38%' : '1 1 100%';
    }


    // ── Load / Save / autosave ───────────────────────────────────────────── //

    _newCanvas() {
        this.layoutName  = null;
        this.layoutTitle = null;
        // New canvases include a grid item by default so the saved JSON
        // renders with a grid in slowdash.html (matches editor's overlay).
        this.editor.loadLayout({
            view_box: '0 0 1024 768',
            items: [
                { type: 'grid', attr: { dx: 50, dy: 50, stroke: '#dddddd' } },
            ],
        });
        this.canvasInspector?.refresh();

        // Drop ?config=… so refreshing won't reload the previous layout.
        const url = new URL(window.location.href);
        url.searchParams.delete('config');
        history.replaceState(null, '', url.toString());

        document.title = 'SD Canvas — (untitled)';
        this._updatePreview();
        this.frame.setStatus('New canvas — give it a name and Save to start the live preview');
    }

    async _loadLayout(filenameOrName) {
        try {
            const doc = await CanvasAPI.loadCanvasLayout(filenameOrName);
            this.layoutName  = (doc.meta?.name) || _stripPrefix(filenameOrName);
            this.layoutTitle = doc.meta?.title || this.layoutName;

            this.editor.loadLayout(doc);
            this.canvasInspector?.refresh();
            this._updatePreview();

            document.title = `SD Canvas — ${this.layoutTitle}`;
            this.frame.setStatus(`Loaded: ${this.layoutTitle}`);
        } catch (e) {
            this.frame.setStatus(`Error loading layout: ${e.message}`);
            console.error(e);
        }
    }

    async _saveLayout(name, title) {
        const layoutDoc = this.editor.getLayout();
        layoutDoc.meta = {
            ...(layoutDoc.meta || {}),
            name,
            title: title || layoutDoc.meta?.title || name,
        };
        try {
            await CanvasAPI.saveCanvasLayout(name, layoutDoc);
            this.layoutName  = name;
            this.layoutTitle = title || name;
            document.title   = `SD Canvas — ${this.layoutTitle}`;
            this.frame.setStatus(`Saved: slowdash-${name}.json`);

            const url = new URL(window.location.href);
            url.searchParams.set('config', `slowdash-${name}.json`);
            url.searchParams.set('mode',   this.editing ? 'edit' : 'view');
            history.replaceState(null, '', url.toString());

            this._updatePreview();
            return true;
        } catch (e) {
            alert(`Save failed: ${e.message}`);
            return false;
        }
    }

    /** Debounced autosave on every layout change. Only runs once a name is set. */
    _scheduleAutosave() {
        if (!this.layoutName) return;
        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = setTimeout(async () => {
            const ok = await this._saveLayout(this.layoutName, this.layoutTitle);
            if (ok) this.frame.setStatus(`Autosaved: slowdash-${this.layoutName}.json`);
        }, AUTOSAVE_DELAY_MS);
    }

    /** Refresh the live preview iframe by reloading the same URL. */
    _updatePreview() {
        if (!this._previewIframe) return;

        if (!this.layoutName) {
            this._previewIframe.srcdoc =
                `<div style="font:14pt sans-serif;color:#888;padding:2em;text-align:center">
                   Live preview appears here.<br><br>
                   Click <b>Save</b> to name this canvas — autosave will keep this view in sync.
                 </div>`;
            return;
        }

        const url = `./slowdash.html?config=slowdash-${encodeURIComponent(this.layoutName)}.json&reload=0&embedded=1`;
        this._previewIframe.removeAttribute('srcdoc');
        this._previewIframe.src = url + '&_t=' + Date.now();

        // Once the iframe loads, hide the duplicated slowdash header.
        // Same-origin so we can reach into the document.
        this._previewIframe.onload = () => {
            try {
                const doc = this._previewIframe.contentDocument;
                if (!doc) return;
                if (!doc.getElementById('sc-hide-header-style')) {
                    const style = doc.createElement('style');
                    style.id = 'sc-hide-header-style';
                    style.textContent =
                        '#sd-header{display:none!important}' +
                        'body{margin:0!important}' +
                        '#sd-layout{margin:0!important;padding:0!important}';
                    doc.head.appendChild(style);
                }
            } catch (e) { /* cross-origin guard, shouldn't trigger here */ }
        };
    }


    // ── Data refresh (only used by editor preview, e.g. data-display items) // ──

    _startDataRefresh() {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => { /* no-op for now */ }, 30000);
    }


    // ── Layout DOM ───────────────────────────────────────────────────────── //

    _buildLayout() {
        const body = document.getElementById('sc-body');
        body.innerHTML = '';
        body.className = 'sc-body';

        // Live preview column (left)
        const previewCol = document.createElement('div');
        previewCol.id        = 'sc-preview-col';
        previewCol.className = 'sc-preview-col';
        const previewHdr = document.createElement('div');
        previewHdr.className = 'sc-preview-hdr';
        previewHdr.textContent = 'Live Preview';
        previewCol.appendChild(previewHdr);
        const iframe = document.createElement('iframe');
        iframe.className   = 'sc-preview-iframe';
        iframe.title       = 'Slowdash live preview';
        previewCol.appendChild(iframe);
        this._previewIframe = iframe;
        body.appendChild(previewCol);

        // Splitter
        const splitter = document.createElement('div');
        splitter.className = 'sc-splitter';
        body.appendChild(splitter);
        this._wireSplitter(splitter, previewCol);

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.id        = 'sc-toolbar';
        toolbar.className = 'sc-toolbar';
        body.appendChild(toolbar);
        this._buildToolbar(toolbar);

        // Editor column
        const editorCol = document.createElement('div');
        editorCol.id        = 'sc-editor-col';
        editorCol.className = 'sc-editor-col';
        const editorHdr = document.createElement('div');
        editorHdr.className = 'sc-preview-hdr';
        editorHdr.textContent = 'Editor';
        editorCol.appendChild(editorHdr);
        const editorWrap = document.createElement('div');
        editorWrap.id        = 'sc-editor';
        editorWrap.className = 'sc-editor-wrap';
        editorCol.appendChild(editorWrap);
        body.appendChild(editorCol);

        this.editor = new CanvasEditor(editorWrap, {
            grid:     20,
            snap:     true,
            showGrid: true,
        });

        // Properties column (right)
        const propsCol = document.createElement('div');
        propsCol.id        = 'sc-props-col';
        propsCol.className = 'sc-props-col';
        body.appendChild(propsCol);

        const itemPanelDiv = document.createElement('div');
        const canvasPanelDiv = document.createElement('div');
        propsCol.appendChild(itemPanelDiv);
        propsCol.appendChild(canvasPanelDiv);

        this.propsPanel      = buildPropertiesPanel(itemPanelDiv, { getPropertyFields });
        this.canvasInspector = buildCanvasInspector(canvasPanelDiv, this.editor);
    }

    _wireSplitter(splitter, previewCol) {
        splitter.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = previewCol.getBoundingClientRect().width;
            const total  = previewCol.parentElement.getBoundingClientRect().width;

            // While dragging, lay an invisible overlay over the page so the
            // iframe inside the preview pane can't swallow mousemove events
            // (that's why the previous version only let you drag rightwards).
            const veil = document.createElement('div');
            veil.style.cssText = 'position:fixed;inset:0;cursor:col-resize;z-index:99999';
            document.body.appendChild(veil);

            const onMove = (ev) => {
                const w = Math.max(160, Math.min(total - 320, startW + (ev.clientX - startX)));
                previewCol.style.flex = `0 0 ${w}px`;
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',   onUp);
                veil.remove();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }

    _buildToolbar(toolbar) {
        const buttons = [
            {
                id: 'tb-add-canvas',
                label: 'Set Size',
                title: 'Set the canvas page width and height',
                action: () => openCanvasSizeDialog(this.editor.getCanvasBounds(), (b) => {
                    this.editor.setCanvasBounds(b);
                    this.canvasInspector?.refresh();
                }),
            },
            { type: 'separator' },
            ...getItemTypes().map(t => ({
                id: `tb-add-${t}`,
                label: 'Add ' + getItemLabel(t),
                title: 'Add a ' + getItemLabel(t) + ' item',
                action: () => this._onAddItem(t),
            })),
            { type: 'separator' },
            {
                id: 'tb-delete',
                label: 'Delete Item',
                title: 'Delete the selected item (or press Backspace)',
                action: () => {
                    if (this.editor.selectedId) this.editor.removeItem(this.editor.selectedId);
                },
            },
        ];

        for (const b of buttons) {
            if (b.type === 'separator') {
                toolbar.appendChild(Object.assign(document.createElement('div'),
                    { className: 'sc-toolbar-sep' }));
                continue;
            }
            const btn = document.createElement('button');
            btn.id          = b.id;
            btn.className   = 'sc-toolbar-btn';
            btn.title       = b.title || b.label;
            btn.textContent = b.label;
            btn.addEventListener('click', b.action);
            toolbar.appendChild(btn);
        }

        // Keyboard shortcut: Backspace/Delete removes selected item while editor focused.
        document.addEventListener('keydown', (e) => {
            if (!this.editing || !this.editor.selectedId) return;
            const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
            if (isInput) return;
            if (e.key === 'Backspace' || e.key === 'Delete') {
                this.editor.removeItem(this.editor.selectedId);
                e.preventDefault();
            }
        });

        // Forward delete events from properties panel
        document.addEventListener('sc-props-delete', (e) => {
            this.editor.removeItem(e.detail._id);
        });
    }

    _wireEditorEvents() {
        const editorEl = document.getElementById('sc-editor');

        editorEl.addEventListener('sc-item-select', (e) => {
            const cfg = this.editor.items.find(i => i._id === e.detail._id);
            if (!cfg) return;
            this.propsPanel.show(cfg, (path, value) => {
                this.editor.updateItemProp(cfg._id, path, value);
                const updated = this.editor.items.find(i => i._id === cfg._id);
                if (updated) this.propsPanel.show(updated, arguments.callee);
            });
        });

        editorEl.addEventListener('sc-item-deselect', () => this.propsPanel.clear());

        editorEl.addEventListener('sc-layout-change', () => {
            this._scheduleAutosave();
        });

        editorEl.addEventListener('sc-canvas-resize', () => {
            this._scheduleAutosave();
        });
    }

    _buildHeaderControls() {
        // Edit/View toggle
        const editBtn = document.createElement('button');
        editBtn.id          = 'sc-edit-btn';
        editBtn.textContent = 'Edit';
        editBtn.title       = 'Switch to edit mode';
        editBtn.addEventListener('click', () => this.setEditing(!this.editing));
        this.frame.appendButton($(editBtn));

        // New (blank document — clears the editor and preview)
        const newBtn = document.createElement('button');
        newBtn.innerHTML = '&#x1f4c4;';
        newBtn.title     = 'New canvas (clear editor)';
        newBtn.addEventListener('click', () => {
            if (this.editor.items.length > 1 || (this.editor.items.length === 1 && this.editor.items[0].type !== 'grid')) {
                if (!confirm('Discard the current canvas and start over?')) return;
            }
            this._newCanvas();
        });
        this.frame.appendButton($(newBtn));

        // Save (floppy disk — matches slowplot.html convention)
        const saveBtn = document.createElement('button');
        saveBtn.innerHTML = '&#x1f4be;';
        saveBtn.title     = 'Save canvas layout';
        saveBtn.addEventListener('click', () => {
            openSaveCanvasDialog(this.layoutName, (name, title) => this._saveLayout(name, title));
        });
        this.frame.appendButton($(saveBtn));

        // Open
        const openBtn = document.createElement('button');
        openBtn.innerHTML = '&#x1f4c2;';
        openBtn.title     = 'Open a saved canvas layout';
        openBtn.addEventListener('click', async () => {
            const files = await CanvasAPI.listFiles('slowdash-');
            openOpenCanvasDialog(files, async (fname) => {
                await this._loadLayout(fname);
            });
        });
        this.frame.appendButton($(openBtn));

        // Home (house — matches slowplot.html)
        const homeBtn = document.createElement('button');
        homeBtn.innerHTML = '&#x1f3e0;';
        homeBtn.title     = 'Home';
        homeBtn.addEventListener('click', () => window.open('./'));
        this.frame.appendButton($(homeBtn));
        homeBtn.style.marginLeft = '1em'; // matches slowplot.html (after appendButton)

        // Help (question mark — matches slowplot.html)
        const docBtn = document.createElement('button');
        docBtn.innerHTML = '&#x2753;';
        docBtn.title     = 'Documents';
        docBtn.addEventListener('click', () => window.open('./slowdocs/index.html'));
        this.frame.appendButton($(docBtn));
    }


    // ── Toolbar actions ──────────────────────────────────────────────────── //

    _onAddItem(type) {
        const c   = this.editor.getCanvasBounds();
        const cx  = c.x + c.width  / 2;
        const cy  = c.y + c.height / 2;
        const cfg = makeDefaultConfig(type, cx, cy);

        // Spread successive additions slightly so they don't stack exactly.
        const offset = (this.editor.items.length % 8) * 24;
        if (cfg.attr) {
            cfg.attr.x = (parseFloat(cfg.attr.x) || 0) + offset - 80;
            cfg.attr.y = (parseFloat(cfg.attr.y) || 0) + offset - 24;
        }

        this.editor.addItem(cfg);
        this.frame.setStatus(`Added: ${getItemLabel(type)}`);
    }
}


// ── Helpers ──────────────────────────────────────────────────────────── //

function _stripPrefix(filenameOrName) {
    return String(filenameOrName).replace(/^slowdash-/, '').replace(/\.json$/, '');
}
