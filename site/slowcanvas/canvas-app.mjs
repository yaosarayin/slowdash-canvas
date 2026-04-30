// canvas-app.mjs — SlowDash Canvas Editor entry point
// Author: Yao Yin
//
// Layout:
//   ┌──────────────── header (Frame, purple) ──────────────────┐
//   │                                                            │
//   │  preview iframe   │ tool │   visual editor  │  properties │
//   │  ─────────────    │ bar  │                  │             │
//   │  JSON file panel  │      │                  │             │
//   │  (toggleable)     │      │                  │             │
//   └──────────────────┴──────┴──────────────────┴──────────────┘
//
// Files are saved as `slowdash-NAME.json` so slowdash.html (`panel-canvas`)
// renders them unchanged. The JSON shown in the bottom-left panel is the
// authoritative source — both the visual editor and the live preview iframe
// stay in sync with whatever it contains.

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
    openImageDialog,
    buildPropertiesPanel,
    buildCanvasInspector,
} from './canvas-dialogs.mjs';

const AUTOSAVE_DELAY_MS = 800;
const JSON_SYNC_DELAY_MS = 350;
const HISTORY_MAX = 80;

// Friendly emoji prefixes for the toolbar buttons. Picked to be both clear
// and a little playful — the user asked for "cute and relevant" emojis.
const ITEM_EMOJI = {
    text:     '🔤',
    box:      '🟦',
    circle:   '⭕',
    button:   '🔘',
    image:    '🖼️',
    valve:    '🎚️',
    solenoid: '🌀',
    grid:     '🧮',
};


export class CanvasApp {
    constructor() {
        this.editor          = null;
        this.frame           = null;
        this.propsPanel      = null;
        this.canvasInspector = null;
        this.projectConfig   = null;
        this.layoutName      = null;
        this.layoutTitle     = null;
        this.editing         = false;

        this._previewIframe  = null;
        this._jsonPanel      = null;
        this._jsonEditor     = null;          // Ace editor instance
        this._jsonVisible    = false;
        this._refreshTimer   = null;
        this._autosaveTimer  = null;
        this._jsonSyncTimer  = null;

        // History: array of stringified layouts. _historyIdx points at the
        // *current* state; undo decrements, redo increments.
        this._history    = [];
        this._historyIdx = -1;

        // Re-entrancy guards. We update three views (visual editor, JSON,
        // preview) from one source of truth, but they each also fire change
        // events — without these flags we'd loop forever.
        this._syncing   = false;
        this._restoring = false;
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

        const theme = this.projectConfig?.style?.theme || 'light';
        try { await this._loadTheme(theme); }
        catch (e) { console.warn('Theme CSS failed to load; falling back to defaults.', e); }

        this._buildLayout();

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
        this._wireGlobalKeys();

        if (configFile) {
            await this._loadLayout(configFile);
        } else {
            this._newCanvas();
        }

        const startInEdit = (modeParam === 'edit') || !configFile || (modeParam !== 'view');
        this.setEditing(startInEdit);

        // Seed history with the initial state so the very first edit can be undone.
        this._pushHistory(true);

        this._startDataRefresh();
    }


    // ── Theme load (mirrors Platform._load_theme) ────────────────────────── //

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

        document.getElementById('sc-toolbar').style.display    = editing ? 'flex' : 'none';
        document.getElementById('sc-props-col').style.display  = editing ? 'flex' : 'none';
        document.getElementById('sc-editor-col').style.display = editing ? 'flex' : 'none';
        document.getElementById('sc-preview-col').style.flex   = editing ? '0 0 38%' : '1 1 100%';
    }


    // ── Load / Save / autosave ───────────────────────────────────────────── //

    _newCanvas() {
        this.layoutName  = null;
        this.layoutTitle = null;
        this.editor.loadLayout({
            view_box: '0 0 1024 768',
            items: [
                { type: 'grid', attr: { dx: 50, dy: 50, stroke: '#dddddd' } },
            ],
        });
        this.canvasInspector?.refresh();

        const url = new URL(window.location.href);
        url.searchParams.delete('config');
        history.replaceState(null, '', url.toString());

        document.title = 'SD Canvas — (untitled)';
        this._syncJsonFromEditor();
        this._updatePreview();
        this.frame.setStatus('New canvas — give it a name and Save to start the live preview');

        // Reset history; the new state becomes the only entry.
        this._history    = [];
        this._historyIdx = -1;
        this._pushHistory(true);
    }

    async _loadLayout(filenameOrName) {
        try {
            const doc = await CanvasAPI.loadCanvasLayout(filenameOrName);
            this.layoutName  = (doc.meta?.name) || _stripPrefix(filenameOrName);
            this.layoutTitle = doc.meta?.title || this.layoutName;

            this.editor.loadLayout(doc);
            this.canvasInspector?.refresh();
            this._syncJsonFromEditor();
            this._updatePreview();

            document.title = `SD Canvas — ${this.layoutTitle}`;
            this.frame.setStatus(`Loaded: ${this.layoutTitle}`);

            this._history    = [];
            this._historyIdx = -1;
            this._pushHistory(true);
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

    _scheduleAutosave() {
        if (!this.layoutName) return;
        clearTimeout(this._autosaveTimer);
        this._autosaveTimer = setTimeout(async () => {
            const ok = await this._saveLayout(this.layoutName, this.layoutTitle);
            if (ok) this.frame.setStatus(`Autosaved: slowdash-${this.layoutName}.json`);
        }, AUTOSAVE_DELAY_MS);
    }

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
            } catch (e) { /* same-origin so we never expect this */ }
        };
    }


    // ── JSON panel ───────────────────────────────────────────────────────── //

    _setupJsonEditor(host) {
        if (!window.ace) {
            host.textContent = 'Ace editor failed to load — JSON view unavailable.';
            return;
        }
        const ed = window.ace.edit(host, {
            mode:            'ace/mode/json',
            theme:           'ace/theme/github',
            useWorker:       false,
            showPrintMargin: false,
            tabSize:         2,
            useSoftTabs:     true,
            wrap:            true,
        });
        ed.session.setUseWrapMode(true);
        ed.setOption('fontSize', '12px');

        // Cmd/Ctrl-S triggers a manual save (autosave still runs on its own).
        ed.commands.addCommand({
            name:    'sc-save',
            bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
            exec:    () => {
                if (this.layoutName) this._saveLayout(this.layoutName, this.layoutTitle);
                else openSaveCanvasDialog(null, (name, title) => this._saveLayout(name, title));
            },
        });

        ed.session.on('change', () => {
            // Ignore programmatic updates triggered by the visual editor.
            if (this._syncing) return;
            this._scheduleEditorSyncFromJson();
        });

        this._jsonEditor = ed;
    }

    /** Push the editor's current layout into the JSON panel. */
    _syncJsonFromEditor() {
        if (!this._jsonEditor) return;
        const doc  = this.editor.getLayout();
        if (this.layoutName) {
            doc.meta = { ...(doc.meta || {}), name: this.layoutName, title: this.layoutTitle || this.layoutName };
        }
        const text = JSON.stringify(doc, null, 2);
        // Avoid feedback loop with the change handler.
        this._syncing = true;
        try {
            const cur = this._jsonEditor.getValue();
            if (cur !== text) {
                const pos = this._jsonEditor.getCursorPosition();
                this._jsonEditor.setValue(text, -1);
                this._jsonEditor.moveCursorToPosition(pos);
            }
        } finally {
            this._syncing = false;
        }
    }

    /** Debounced — apply the JSON pane back to the visual editor. */
    _scheduleEditorSyncFromJson() {
        clearTimeout(this._jsonSyncTimer);
        this._jsonSyncTimer = setTimeout(() => this._applyJsonToEditor(), JSON_SYNC_DELAY_MS);
    }

    _applyJsonToEditor() {
        if (!this._jsonEditor) return;
        const text = this._jsonEditor.getValue();
        let doc;
        try { doc = JSON.parse(text); }
        catch (e) {
            this.frame.setStatus(`JSON error: ${e.message}`);
            return;
        }

        // Apply to the visual editor without echoing back into the JSON pane.
        this._syncing = true;
        try {
            this.editor.loadLayout(doc);
            this.canvasInspector?.refresh();
        } finally {
            this._syncing = false;
        }

        // Treat as a user change: record history and trigger autosave.
        if (!this._restoring) this._pushHistory();
        this._scheduleAutosave();
        this._updatePreview();
        this.frame.setStatus('JSON applied');
    }

    _toggleJsonPanel(forceState) {
        const visible = (forceState === undefined) ? !this._jsonVisible : !!forceState;
        this._jsonVisible = visible;
        this._jsonPanel.style.display = visible ? 'flex' : 'none';
        const btn = document.getElementById('sc-json-toggle');
        if (btn) btn.textContent = visible ? '📝 JSON ▾' : '📝 JSON ▸';

        // Keep contents fresh whenever the panel becomes visible.
        if (visible) {
            this._syncJsonFromEditor();
            // Ace needs a resize after being unhidden.
            this._jsonEditor?.resize(true);
        }
    }


    // ── Undo / redo ──────────────────────────────────────────────────────── //

    _pushHistory(initial = false) {
        if (this._restoring) return;
        const snap = JSON.stringify(this.editor.getLayout());

        if (!initial && this._historyIdx >= 0 && this._history[this._historyIdx] === snap) {
            return;  // no actual change
        }

        // Drop any "redo" suffix when a new edit branches off.
        if (this._historyIdx < this._history.length - 1) {
            this._history.length = this._historyIdx + 1;
        }
        this._history.push(snap);
        if (this._history.length > HISTORY_MAX) this._history.shift();
        this._historyIdx = this._history.length - 1;
    }

    _undo() {
        if (this._historyIdx <= 0) return;
        this._historyIdx -= 1;
        this._restoreFromHistory();
        this.frame.setStatus('Undo');
    }

    _redo() {
        if (this._historyIdx >= this._history.length - 1) return;
        this._historyIdx += 1;
        this._restoreFromHistory();
        this.frame.setStatus('Redo');
    }

    _restoreFromHistory() {
        const snap = this._history[this._historyIdx];
        if (!snap) return;
        const doc = JSON.parse(snap);

        this._restoring = true;
        this._syncing   = true;
        try {
            this.editor.loadLayout(doc);
            this.canvasInspector?.refresh();
        } finally {
            this._syncing   = false;
            this._restoring = false;
        }
        this._syncJsonFromEditor();
        this._scheduleAutosave();
        this._updatePreview();
    }


    // ── Layout DOM ───────────────────────────────────────────────────────── //

    _buildLayout() {
        const body = document.getElementById('sc-body');
        body.innerHTML = '';
        body.className = 'sc-body';

        // Left column: live preview (top) + JSON panel (bottom, toggleable)
        const leftCol = document.createElement('div');
        leftCol.id        = 'sc-preview-col';
        leftCol.className = 'sc-preview-col';

        // Preview header + iframe
        const previewHdr = document.createElement('div');
        previewHdr.className   = 'sc-preview-hdr';
        previewHdr.textContent = 'Live Preview';
        leftCol.appendChild(previewHdr);

        const previewWrap = document.createElement('div');
        previewWrap.className = 'sc-preview-wrap';
        const iframe = document.createElement('iframe');
        iframe.className = 'sc-preview-iframe';
        iframe.title     = 'Slowdash live preview';
        previewWrap.appendChild(iframe);
        leftCol.appendChild(previewWrap);
        this._previewIframe = iframe;

        // JSON panel header (always visible — has the toggle button)
        const jsonHdr = document.createElement('div');
        jsonHdr.className = 'sc-preview-hdr sc-json-hdr';
        const jsonHdrLabel = document.createElement('span');
        jsonHdrLabel.textContent = 'JSON Source';
        const toggleBtn = document.createElement('button');
        toggleBtn.id          = 'sc-json-toggle';
        toggleBtn.className   = 'sc-mini-btn';
        toggleBtn.textContent = '📝 JSON ▸';
        toggleBtn.title       = 'Show or hide the JSON source';
        toggleBtn.addEventListener('click', () => this._toggleJsonPanel());
        jsonHdr.appendChild(jsonHdrLabel);
        jsonHdr.appendChild(toggleBtn);
        leftCol.appendChild(jsonHdr);

        // JSON panel body (Ace editor)
        const jsonPanel = document.createElement('div');
        jsonPanel.className = 'sc-json-panel';
        jsonPanel.style.display = 'none';
        const jsonHost = document.createElement('div');
        jsonHost.className = 'sc-json-host';
        jsonPanel.appendChild(jsonHost);
        leftCol.appendChild(jsonPanel);
        this._jsonPanel = jsonPanel;

        body.appendChild(leftCol);

        // Splitter
        const splitter = document.createElement('div');
        splitter.className = 'sc-splitter';
        body.appendChild(splitter);
        this._wireSplitter(splitter, leftCol);

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.id        = 'sc-toolbar';
        toolbar.className = 'sc-toolbar';
        body.appendChild(toolbar);
        this._buildToolbar(toolbar);

        // Visual editor column
        const editorCol = document.createElement('div');
        editorCol.id        = 'sc-editor-col';
        editorCol.className = 'sc-editor-col';
        const editorHdr = document.createElement('div');
        editorHdr.className   = 'sc-preview-hdr';
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

        const itemPanelDiv   = document.createElement('div');
        const canvasPanelDiv = document.createElement('div');
        propsCol.appendChild(itemPanelDiv);
        propsCol.appendChild(canvasPanelDiv);

        this.propsPanel      = buildPropertiesPanel(itemPanelDiv, { getPropertyFields });
        this.canvasInspector = buildCanvasInspector(canvasPanelDiv, this.editor);

        // Initialize Ace once the host div is in the DOM.
        this._setupJsonEditor(jsonHost);
    }

    _wireSplitter(splitter, previewCol) {
        splitter.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = previewCol.getBoundingClientRect().width;
            const total  = previewCol.parentElement.getBoundingClientRect().width;

            // Veil over the page so the iframe inside the preview pane can't
            // swallow mousemove events when the cursor crosses it.
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
                this._jsonEditor?.resize(true);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }

    _buildToolbar(toolbar) {
        const buttons = [
            {
                id: 'tb-set-size',
                label: '📐 Set Size',
                title: 'Set the canvas page width and height',
                action: () => openCanvasSizeDialog(this.editor.getCanvasBounds(), (b) => {
                    this.editor.setCanvasBounds(b);
                    this.canvasInspector?.refresh();
                }),
            },
            { type: 'separator' },
            ...getItemTypes().map(t => ({
                id: `tb-add-${t}`,
                label: `${ITEM_EMOJI[t] || '•'} Add ${getItemLabel(t)}`,
                title: 'Add a ' + getItemLabel(t) + ' item',
                action: () => (t === 'image') ? this._onAddImage() : this._onAddItem(t),
            })),
            { type: 'separator' },
            {
                id: 'tb-undo',
                label: '↩️ Undo',
                title: 'Undo (Ctrl/Cmd-Z)',
                action: () => this._undo(),
            },
            {
                id: 'tb-redo',
                label: '↪️ Redo',
                title: 'Redo (Ctrl/Cmd-Shift-Z)',
                action: () => this._redo(),
            },
            { type: 'separator' },
            {
                id: 'tb-delete',
                label: '🗑️ Delete',
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

        // Forward delete events from properties panel
        document.addEventListener('sc-props-delete', (e) => {
            this.editor.removeItem(e.detail._id);
        });
    }

    _wireGlobalKeys() {
        document.addEventListener('keydown', (e) => {
            // Don't steal keys from form inputs / Ace.
            const t = document.activeElement?.tagName;
            const inAce = !!document.activeElement?.closest?.('.sc-json-host');
            const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t);

            // Undo / redo work even from within Ace, but Ace already has its
            // own Ctrl-Z handler — we only need a global handler when focus
            // is *not* inside Ace.
            if (!inAce) {
                const meta = e.ctrlKey || e.metaKey;
                if (meta && !e.altKey) {
                    if (e.key === 'z' || e.key === 'Z') {
                        if (e.shiftKey) this._redo(); else this._undo();
                        e.preventDefault();
                        return;
                    }
                    if (e.key === 'y' || e.key === 'Y') {
                        this._redo();
                        e.preventDefault();
                        return;
                    }
                }
            }

            // Backspace / Delete to remove the selected item.
            if (this.editing && this.editor.selectedId
                && !inField && !inAce
                && (e.key === 'Backspace' || e.key === 'Delete')) {
                this.editor.removeItem(this.editor.selectedId);
                e.preventDefault();
            }
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

        // Visual edits (drag, resize, add, delete, prop change) flow through
        // these events. We always update everything else from here.
        const onChange = () => {
            if (this._syncing) return;
            this._pushHistory();
            this._syncJsonFromEditor();
            this._scheduleAutosave();
        };
        editorEl.addEventListener('sc-layout-change',  onChange);
        editorEl.addEventListener('sc-canvas-resize',  onChange);
    }

    _buildHeaderControls() {
        // Edit/View toggle
        const editBtn = document.createElement('button');
        editBtn.id          = 'sc-edit-btn';
        editBtn.textContent = 'Edit';
        editBtn.title       = 'Switch to edit mode';
        editBtn.addEventListener('click', () => this.setEditing(!this.editing));
        this.frame.appendButton($(editBtn));

        // New
        const newBtn = document.createElement('button');
        newBtn.innerHTML = '&#x1f4c4;';
        newBtn.title     = 'New canvas (clear editor)';
        newBtn.addEventListener('click', () => {
            const isPristine =
                this.editor.items.length === 0 ||
                (this.editor.items.length === 1 && this.editor.items[0].type === 'grid');
            if (!isPristine && !confirm('Discard the current canvas and start over?')) return;
            this._newCanvas();
        });
        this.frame.appendButton($(newBtn));

        // Save
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

        // Home
        const homeBtn = document.createElement('button');
        homeBtn.innerHTML = '&#x1f3e0;';
        homeBtn.title     = 'Home';
        homeBtn.addEventListener('click', () => window.open('./'));
        this.frame.appendButton($(homeBtn));
        homeBtn.style.marginLeft = '1em';

        // Help
        const docBtn = document.createElement('button');
        docBtn.innerHTML = '&#x2753;';
        docBtn.title     = 'Documents';
        docBtn.addEventListener('click', () => window.open('./slowdocs/index.html'));
        this.frame.appendButton($(docBtn));
    }


    // ── Data refresh (placeholder for future live data on editor side) ───── //

    _startDataRefresh() {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => { /* no-op */ }, 30000);
    }


    // ── Toolbar actions ──────────────────────────────────────────────────── //

    _onAddItem(type) {
        const c   = this.editor.getCanvasBounds();
        const cx  = c.x + c.width  / 2;
        const cy  = c.y + c.height / 2;
        const cfg = makeDefaultConfig(type, cx, cy);

        const offset = (this.editor.items.length % 8) * 24;
        if (cfg.attr) {
            cfg.attr.x = (parseFloat(cfg.attr.x) || 0) + offset - 80;
            cfg.attr.y = (parseFloat(cfg.attr.y) || 0) + offset - 24;
        }

        this.editor.addItem(cfg);
        this.frame.setStatus(`Added: ${getItemLabel(type)}`);
    }

    _onAddImage() {
        openImageDialog(CanvasAPI, (filename) => {
            const c   = this.editor.getCanvasBounds();
            const cx  = c.x + c.width  / 2;
            const cy  = c.y + c.height / 2;
            const cfg = makeDefaultConfig('image', cx - 100, cy - 75);
            cfg.attr.href = filename;
            this.editor.addItem(cfg);
            this.frame.setStatus(`Added image: ${filename}`);
        });
    }
}


// ── Helpers ──────────────────────────────────────────────────────────── //

function _stripPrefix(filenameOrName) {
    return String(filenameOrName).replace(/^slowdash-/, '').replace(/\.json$/, '');
}
