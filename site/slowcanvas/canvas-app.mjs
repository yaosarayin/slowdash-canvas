// canvas-app.mjs — main orchestration for the SlowDash Canvas Editor
// Author: Yao Yin
// Created: 2026-04-29
//
// Entry point called from slowcanvas.html.
// Responsibilities:
//   • Read URL parameters (config, mode).
//   • Build the header (Frame) and the three-column layout.
//   • Own the load/save lifecycle.
//   • Own the data-refresh loop.
//   • Wire editor, dialogs, and properties panel together.
//
// URL parameters:
//   config=slowcanvas-NAME.json   load this layout on startup
//   mode=edit                     start in edit mode (default in view mode)

import { JG as $ } from '../slowjs/jagaimo/jagaimo.mjs';
import { Frame } from '../slowjs/frame.mjs';
import { CanvasAPI } from './canvas-api.mjs';
import { CanvasEditor } from './canvas-editor.mjs';
import { ITEM_REGISTRY, makeDefaultConfig, getPropertyFields } from './canvas-items.mjs';
import {
    openUploadSVGDialog,
    openAddItemDialog,
    openOpenCanvasDialog,
    openSaveCanvasDialog,
    openSVGEditorDialog,
    buildPropertiesPanel,
    buildSVGElementPanel,
} from './canvas-dialogs.mjs';


// ── CanvasApp ─────────────────────────────────────────────────────────────── //

export class CanvasApp {
    constructor() {
        this.editor       = null;
        this.frame        = null;
        this.propsPanel   = null;
        this.svgElPanel   = null;
        this.projectConfig = null;
        this.layoutName   = null;   // current layout name (sans prefix/ext)
        this.layoutTitle  = null;
        this.editing      = false;
        this._refreshTimer = null;
        this._dataRefreshSec = 10;
    }

    async run() {
        // Parse URL
        const params      = new URLSearchParams(window.location.search);
        const configFile  = params.get('config');     // e.g. 'slowcanvas-Foo.json'
        const modeParam   = params.get('mode');

        // Fetch project metadata
        try {
            this.projectConfig = await CanvasAPI.getProjectConfig();
        } catch (e) {
            document.body.innerHTML = `<h3>Cannot connect to SlowDash backend: ${e.message}</h3>`;
            return;
        }

        // The HTML already loads slowdash-light.css by default (purple header).
        // Only swap the theme link if the project explicitly uses a different theme.
        const style = this.projectConfig.style || {};
        const theme  = style.theme || 'light';
        if (theme !== 'light') {
            const themeLink = document.getElementById('sd-theme-css');
            if (themeLink) themeLink.href = 'slowjs/slowdash-' + theme + '.css';
        }

        // Build layout
        this._buildLayout();

        // Header
        const projTitle = this.projectConfig.project?.title
            || this.projectConfig.project?.name
            || 'SlowDash';
        this.frame = new Frame($('#sc-header'), {
            title: projTitle + ' — Canvas',
            style,
            initialStatus: 'Canvas Editor',
        });
        this._buildHeaderControls();

        // Wire editor events
        document.getElementById('sc-editor').addEventListener('sc-item-select', (e) => {
            const config = this.editor.items.find(i => i.id === e.detail.id);
            if (config) {
                this.svgElPanel && this.svgElPanel.clear();
                this.propsPanel.show(config, (path, value) => {
                    this.editor.updateItemProp(config.id, path, value);
                    // Refresh the panel so colour pickers etc. reflect the update
                    const updated = this.editor.items.find(i => i.id === config.id);
                    if (updated) this.propsPanel.show(updated, arguments.callee);
                });
            }
        });

        document.getElementById('sc-editor').addEventListener('sc-item-deselect', () => {
            this.propsPanel.clear();
        });

        document.getElementById('sc-editor').addEventListener('sc-svg-element-select', (e) => {
            if (this.svgElPanel) this.svgElPanel.show(e.detail.element);
        });

        document.getElementById('sc-editor').addEventListener('sc-control-click', async (e) => {
            const { action, params: cmdParams } = e.detail;
            if (!action) return;
            try {
                await CanvasAPI.sendCommand(action, cmdParams);
                this.frame.setStatus(`Command sent: ${action}`);
            } catch (err) {
                this.frame.setStatus(`Command failed: ${err.message}`);
            }
        });

        // Load layout if specified in URL
        if (configFile) {
            await this._loadLayout(configFile);
        } else {
            this._newCanvas();
        }

        // Determine mode
        const startInEdit = (modeParam === 'edit') || (!configFile);
        this.setEditing(startInEdit);

        // Data refresh
        this._startDataRefresh();
    }


    // ── Layout switch ─────────────────────────────────────────────────────── //

    setEditing(editing) {
        this.editing = editing;
        this.editor.setEditing(editing);

        const editBtn = document.getElementById('sc-edit-btn');
        if (editBtn) {
            editBtn.textContent = editing ? 'View' : 'Edit';
            editBtn.title       = editing ? 'Switch to view mode' : 'Switch to edit mode';
        }

        const toolbar = document.getElementById('sc-toolbar');
        if (toolbar) toolbar.style.display = editing ? 'flex' : 'none';

        const propsCol = document.getElementById('sc-props-col');
        if (propsCol) propsCol.style.display = editing ? 'flex' : 'none';
    }


    // ── Load / Save ───────────────────────────────────────────────────────── //

    _newCanvas() {
        this.layoutName  = null;
        this.layoutTitle = null;
        this.editor.loadLayout({ canvas: {}, items: [] });
        this.frame.setStatus('New canvas — switch to Edit mode to add items');
    }

    async _loadLayout(filenameOrName) {
        try {
            const doc = await CanvasAPI.loadCanvasLayout(filenameOrName);
            this.layoutName  = (doc.meta?.name) || _stripPrefix(filenameOrName);
            this.layoutTitle = doc.meta?.title || this.layoutName;
            this._dataRefreshSec = doc.canvas?.dataRefresh || 10;

            // Load background SVG inline if available
            let svgText = null;
            const bgFile = doc.canvas?.background?.file;
            if (bgFile) {
                try { svgText = await CanvasAPI.loadText(bgFile); } catch {}
            }

            this.editor.loadLayout(doc);

            // Re-apply inline SVG if loaded
            if (svgText && bgFile) {
                this.editor.setBackground(bgFile, svgText, doc.canvas?.background);
            }

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
            name:  name,
            title: title || name,
        };
        try {
            await CanvasAPI.saveCanvasLayout(name, layoutDoc);
            this.layoutName  = name;
            this.layoutTitle = title || name;
            document.title   = `SD Canvas — ${this.layoutTitle}`;
            this.frame.setStatus(`Saved: slowcanvas-${name}.json`);
            // Update URL without reloading
            const url = new URL(window.location.href);
            url.searchParams.set('config', `slowcanvas-${name}.json`);
            url.searchParams.set('mode', 'edit');
            history.replaceState(null, '', url.toString());
        } catch (e) {
            alert(`Save failed: ${e.message}`);
        }
    }


    // ── Data refresh ──────────────────────────────────────────────────────── //

    _startDataRefresh() {
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        const doRefresh = async () => {
            const channels = this.editor.getNeededChannels();
            if (!channels.length) return;
            try {
                const data = await CanvasAPI.getData(channels, this._dataRefreshSec * 2);
                if (data) {
                    this.editor.updateData(data);
                    this.frame.setClockTime(Date.now() / 1000);
                }
            } catch {}
        };
        this._refreshTimer = setInterval(doRefresh, this._dataRefreshSec * 1000);
        doRefresh();
    }


    // ── DOM construction ──────────────────────────────────────────────────── //

    _buildLayout() {
        const body = document.getElementById('sc-body');
        body.innerHTML = '';
        body.className = 'sc-body';

        // Toolbar column (left, only in edit mode)
        const toolbarCol = document.createElement('div');
        toolbarCol.id        = 'sc-toolbar';
        toolbarCol.className = 'sc-toolbar';
        toolbarCol.style.display = 'none';
        this._buildToolbar(toolbarCol);
        body.appendChild(toolbarCol);

        // Editor viewport (centre, stretches)
        const editorDiv = document.createElement('div');
        editorDiv.id        = 'sc-editor';
        editorDiv.className = 'sc-editor-wrap';
        body.appendChild(editorDiv);

        this.editor = new CanvasEditor(editorDiv, {
            snap: 1,
            dataRefresh: 10,
        });

        // Properties column (right, only in edit mode)
        const propsCol = document.createElement('div');
        propsCol.id        = 'sc-props-col';
        propsCol.className = 'sc-props-col';
        propsCol.style.display = 'none';
        body.appendChild(propsCol);

        // Split props col into item panel + svg element panel
        const itemPanelDiv  = document.createElement('div');
        const svgPanelDiv   = document.createElement('div');
        propsCol.appendChild(itemPanelDiv);
        propsCol.appendChild(svgPanelDiv);

        this.propsPanel  = buildPropertiesPanel(itemPanelDiv, { ITEM_REGISTRY, getPropertyFields });
        this.svgElPanel  = buildSVGElementPanel(svgPanelDiv);
    }

    _buildToolbar(toolbarDiv) {
        const buttons = [
            {
                id: 'tb-upload-svg',
                label: 'Upload SVG',
                title: 'Upload an SVG file to use as the canvas background',
                action: () => this._onUploadSVG(),
            },
            {
                id: 'tb-edit-svg',
                label: 'Edit SVG',
                title: 'Open the background SVG in SVG-Edit',
                action: () => this._onEditSVG(),
            },
            { type: 'separator' },
            ...Object.entries(ITEM_REGISTRY).map(([type, Cls]) => ({
                id: `tb-add-${type}`,
                label: 'Add ' + (Cls.label || type),
                title: 'Add a ' + (Cls.label || type) + ' to the canvas',
                action: () => this._onAddItem(type),
            })),
            { type: 'separator' },
            {
                id: 'tb-delete-item',
                label: 'Delete Item',
                title: 'Delete the selected item',
                action: () => {
                    if (this.editor.selectedId) this.editor.removeItem(this.editor.selectedId);
                },
            },
        ];

        for (const b of buttons) {
            if (b.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'sc-toolbar-sep';
                toolbarDiv.appendChild(sep);
                continue;
            }
            const btn = document.createElement('button');
            btn.id        = b.id;
            btn.className = 'sc-toolbar-btn';
            btn.title     = b.title || b.label;
            btn.textContent = b.label;
            btn.addEventListener('click', b.action);
            toolbarDiv.appendChild(btn);
        }

        // Listen for delete from the properties panel
        document.addEventListener('sc-props-delete', (e) => {
            this.editor.removeItem(e.detail.id);
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

        // Save
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.title       = 'Save canvas layout';
        saveBtn.addEventListener('click', () => {
            openSaveCanvasDialog(this.layoutName, (name, title) => {
                this._saveLayout(name, title);
            });
        });
        this.frame.appendButton($(saveBtn));

        // Open
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Open';
        openBtn.title       = 'Open a saved canvas layout';
        openBtn.addEventListener('click', async () => {
            const files = await CanvasAPI.listFiles('slowcanvas-');
            const mapped = files.map(f => ({ name: f.name }));
            openOpenCanvasDialog(mapped, async (fname) => {
                await this._loadLayout(fname);
                this.setEditing(false);
            });
        });
        this.frame.appendButton($(openBtn));

        // Home
        const homeBtn = document.createElement('button');
        homeBtn.textContent  = 'Home';
        homeBtn.title        = 'Home';
        homeBtn.addEventListener('click', () => window.open('./'));
        homeBtn.style.marginLeft = '1em';
        this.frame.appendButton($(homeBtn));

        // Docs
        const docBtn = document.createElement('button');
        docBtn.textContent = 'Help';
        docBtn.title       = 'Documentation';
        docBtn.addEventListener('click', () => window.open('./slowdocs/index.html'));
        this.frame.appendButton($(docBtn));
    }


    // ── Toolbar actions ───────────────────────────────────────────────────── //

    _onUploadSVG() {
        openUploadSVGDialog(async (filename, svgText) => {
            try {
                await CanvasAPI.uploadSVG(filename, svgText);
                this.editor.setBackground(filename, svgText);
                this.frame.setStatus(`SVG uploaded: ${filename}`);
            } catch (e) {
                alert(`Upload failed: ${e.message}`);
            }
        });
    }

    _onEditSVG() {
        const bgFile = this.editor.background?.file;
        if (!bgFile) {
            alert('No background SVG loaded.\nUpload an SVG first using the "Upload SVG" button.');
            return;
        }
        openSVGEditorDialog(bgFile);
    }

    _onAddItem(type) {
        // Place new item in the centre of the current viewBox
        const vb  = this.editor.viewBox;
        const cx  = vb.x + vb.width  / 2;
        const cy  = vb.y + vb.height / 2;
        const cfg = makeDefaultConfig(type, cx, cy);

        // Shift slightly so multiple items don't stack exactly
        const offset = (this.editor.items.length % 8) * 20;
        cfg.x += offset - 70;
        cfg.y += offset - 22;

        this.editor.addItem(cfg);
        this.frame.setStatus(`Added: ${cfg.type}`);
    }
}


// ── Helpers ──────────────────────────────────────────────────────────────── //

function _stripPrefix(filenameOrName) {
    return filenameOrName
        .replace(/^slowcanvas-/, '')
        .replace(/\.json$/, '');
}

