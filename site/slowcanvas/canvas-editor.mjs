// canvas-editor.mjs — interactive SVG viewport for the canvas editor
// Author: Yao Yin
//
// CanvasEditor manages:
//   • An <svg> viewport that holds a visual approximation of all items.
//   • A canvas-bounds rectangle (the "page") that maps to the JSON view_box.
//   • A snap-to-grid overlay configurable in edit mode.
//   • Pan (middle-mouse / space+drag) and zoom (wheel) of the editor view.
//   • Item selection, drag-to-move, corner resize handles.
//   • Round-tripping of slowdash-canvas JSON layouts.
//
// Custom DOM events fired on the container:
//   sc-item-select   { detail: { _id } }
//   sc-item-deselect
//   sc-layout-change   — after any structural change (move/resize/add/delete)
//   sc-canvas-resize   — after the page dimensions changed (drag or numeric edit)

import {
    renderItem, getItemBBox, getItemKey, setItemKey, getItemChannels,
} from './canvas-items.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULT_VIEW = { x: 0, y: 0, width: 1024, height: 768 };
const DEFAULT_GRID = 20;

// Padding around the canvas bounds (relative to canvas size) so users can pan/zoom.
const VIEWPORT_PADDING_FACTOR = 0.05;


export class CanvasEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options   = {
            grid:       options.grid       ?? DEFAULT_GRID,
            snap:       options.snap       ?? true,
            showGrid:   options.showGrid   ?? true,
            ...options,
        };

        this.editing      = false;
        this.items        = [];                   // source-of-truth array of item configs
        this.selectedId   = null;
        this.canvas       = { ...DEFAULT_VIEW };  // canvas page bounds (= JSON view_box)
        this._meta        = {};                   // meta block from loaded layout
        this._defaults    = {};                   // defaults block

        this._viewBox     = null;                 // current SVG viewBox (pan/zoom)

        this._buildDOM();
        this._bindEvents();
        this._fitViewport();
    }


    // ── Public API ───────────────────────────────────────────────────────── //

    setEditing(editing) {
        this.editing = editing;
        this.svgRoot.setAttribute('data-editing', editing ? '1' : '0');
        this.gridLayer.style.display     = (editing && this.options.showGrid) ? '' : 'none';
        this.boundsLayer.style.display   = editing ? '' : 'none';
        this._rerenderAllItems();
        // _renderGrid is gated on `this.editing`, so it must run *after* the
        // mode flag is updated. Without this, loadLayout() (called before the
        // first setEditing()) leaves the grid layer empty.
        this._renderGrid();
        this._renderBounds();
        if (!editing) this.deselect();
    }

    setShowGrid(show) {
        this.options.showGrid = !!show;
        this.gridLayer.style.display = (this.editing && show) ? '' : 'none';
    }

    setGridSize(size) {
        const n = parseInt(size);
        if (!Number.isFinite(n) || n <= 0) return;
        this.options.grid = n;
        this._renderGrid();
    }

    setSnap(snap) { this.options.snap = !!snap; }

    /** Load a slowdash-canvas JSON document. Format: { meta, view_box, items, defaults }. */
    loadLayout(doc) {
        this._meta     = doc.meta     || {};
        this._defaults = doc.defaults || {};

        const vb = _parseViewBox(doc.view_box || doc.viewBox);
        this.canvas = vb ? { ...vb } : { ...DEFAULT_VIEW };

        // Items are normalised — every item gets a unique editor-local _id.
        this.items = (doc.items || []).map(_normaliseItem);

        this._rerenderAllItems();
        this._renderGrid();
        this._renderBounds();
        this._fitViewport();
        // Note: no layout-change event here — only user edits should trigger autosave.
    }

    /** Return the current layout in slowdash-canvas JSON format. */
    getLayout() {
        return {
            meta:     { ...this._meta },
            view_box: `${this.canvas.x} ${this.canvas.y} ${this.canvas.width} ${this.canvas.height}`,
            defaults: { ...this._defaults },
            control:  { reload: -1 },           // canvas pages don't need auto reload
            items:    this.items.map(_serialiseItem),
        };
    }

    addItem(config) {
        if (!config._id) config._id = 'item-' + Math.random().toString(36).slice(2, 9);
        this.items.push(config);
        this._renderItem(config);
        this.selectItem(config._id);
        this._fireLayoutChange();
        return config;
    }

    removeItem(id) {
        this.items = this.items.filter(i => i._id !== id);
        const el = this._itemEl(id);
        if (el) el.remove();
        this._clearHandles();
        if (this.selectedId === id) this.deselect();
        this._fireLayoutChange();
    }

    /** Update a property by dot-path (e.g. 'attr.x', 'metric.channel'). */
    updateItemProp(id, path, value) {
        const cfg = this.items.find(i => i._id === id);
        if (!cfg) return;

        // Coerce numeric inputs back to numbers
        if (typeof value === 'string' && /^attr\.(x|y|width|height|rx|ry|stroke-width|font-size)$/.test(path)) {
            const n = parseFloat(value);
            if (Number.isFinite(n) && /^attr\.(x|y|width|height|rx|ry|stroke-width)$/.test(path)) {
                value = n;
            }
        }
        if (typeof value === 'string' && /^metric\.(active-above|active-below)$/.test(path)) {
            const n = parseFloat(value);
            if (Number.isFinite(n)) value = n;
        }

        setItemKey(cfg, path, value);
        this._renderItem(cfg);
        if (this.selectedId === id) this._showHandles(id);
        this._fireLayoutChange();
    }

    selectItem(id) {
        this._clearHandles();
        this.selectedId = id;
        if (this.editing) this._showHandles(id);
        this.container.dispatchEvent(new CustomEvent('sc-item-select', {
            bubbles: true, detail: { _id: id },
        }));
    }

    deselect() {
        this.selectedId = null;
        this._clearHandles();
        this.container.dispatchEvent(new CustomEvent('sc-item-deselect', { bubbles: true }));
    }

    /** Set the canvas page size. Accepts {x, y, width, height} (any subset). */
    setCanvasBounds(bounds) {
        this.canvas = { ...this.canvas, ..._sanitiseBounds(bounds) };
        this._renderBounds();
        this._renderGrid();
        this._fitViewport();
        this._fireLayoutChange();
        this.container.dispatchEvent(new CustomEvent('sc-canvas-resize', {
            bubbles: true, detail: { ...this.canvas },
        }));
    }

    getCanvasBounds() { return { ...this.canvas }; }

    /** Snap a value to the grid (no-op if snap disabled or grid is zero). */
    snap(v) {
        const g = this.options.grid;
        if (!this.options.snap || !g) return v;
        return Math.round(v / g) * g;
    }

    getNeededChannels() {
        const set = new Set();
        for (const cfg of this.items) {
            for (const c of getItemChannels(cfg)) set.add(c);
        }
        return [...set];
    }


    // ── DOM construction ─────────────────────────────────────────────────── //

    _buildDOM() {
        this.container.classList.add('sc-editor-container');
        this.container.style.position = 'relative';
        this.container.style.overflow = 'hidden';

        this.svgRoot = document.createElementNS(SVG_NS, 'svg');
        this.svgRoot.setAttribute('class', 'sc-viewport');
        this.svgRoot.style.width   = '100%';
        this.svgRoot.style.height  = '100%';
        this.svgRoot.style.display = 'block';
        this.svgRoot.style.userSelect = 'none';
        this.container.appendChild(this.svgRoot);

        // Layer ordering: bounds (page) → grid → items → handles
        this.boundsLayer = document.createElementNS(SVG_NS, 'g');
        this.boundsLayer.setAttribute('class', 'sc-bounds-layer');
        this.svgRoot.appendChild(this.boundsLayer);

        this.gridLayer = document.createElementNS(SVG_NS, 'g');
        this.gridLayer.setAttribute('class', 'sc-grid-layer');
        this.gridLayer.style.pointerEvents = 'none';
        this.svgRoot.appendChild(this.gridLayer);

        this.itemLayer = document.createElementNS(SVG_NS, 'g');
        this.itemLayer.setAttribute('class', 'sc-item-layer');
        this.svgRoot.appendChild(this.itemLayer);

        this.handleLayer = document.createElementNS(SVG_NS, 'g');
        this.handleLayer.setAttribute('class', 'sc-handle-layer');
        this.svgRoot.appendChild(this.handleLayer);

        // Click on empty area deselects
        this.svgRoot.addEventListener('click', (e) => {
            if (!this.editing) return;
            const tgt = e.target;
            // Only deselect when the click really hit the bounds rect or empty SVG.
            if (tgt === this.svgRoot || tgt.classList?.contains('sc-bounds-rect')) {
                this.deselect();
            }
        });
    }


    // ── Pan + zoom (purely visual, doesn't change canvas bounds) ─────────── //

    _bindEvents() {
        this.svgRoot.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const rect   = this.svgRoot.getBoundingClientRect();
            const cx = (e.clientX - rect.left) / rect.width  * this._viewBox.width  + this._viewBox.x;
            const cy = (e.clientY - rect.top)  / rect.height * this._viewBox.height + this._viewBox.y;
            this._viewBox = {
                x: cx - (cx - this._viewBox.x) / factor,
                y: cy - (cy - this._viewBox.y) / factor,
                width:  this._viewBox.width  / factor,
                height: this._viewBox.height / factor,
            };
            this._applyViewBox();
        }, { passive: false });

        let panStart = null;
        this.svgRoot.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && e.getModifierState('Space'))) {
                panStart = { x: e.clientX, y: e.clientY, vb: { ...this._viewBox } };
                e.preventDefault();
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (!panStart) return;
            const rect = this.svgRoot.getBoundingClientRect();
            const sx = panStart.vb.width  / rect.width;
            const sy = panStart.vb.height / rect.height;
            this._viewBox = {
                ...panStart.vb,
                x: panStart.vb.x - (e.clientX - panStart.x) * sx,
                y: panStart.vb.y - (e.clientY - panStart.y) * sy,
            };
            this._applyViewBox();
        });
        window.addEventListener('mouseup', () => { panStart = null; });

        // Re-fit on container resize
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => this._applyViewBox()).observe(this.container);
        }
    }

    _fitViewport() {
        const pad = Math.max(this.canvas.width, this.canvas.height) * VIEWPORT_PADDING_FACTOR;
        this._viewBox = {
            x: this.canvas.x - pad,
            y: this.canvas.y - pad,
            width:  this.canvas.width  + pad * 2,
            height: this.canvas.height + pad * 2,
        };
        this._applyViewBox();
    }

    _applyViewBox() {
        if (!this._viewBox) return;
        const v = this._viewBox;
        this.svgRoot.setAttribute('viewBox', `${v.x} ${v.y} ${v.width} ${v.height}`);
    }


    // ── Canvas bounds (the "page" and its drag handles) ──────────────────── //

    _renderBounds() {
        this.boundsLayer.innerHTML = '';

        // White page background — items are drawn on top
        const bg = document.createElementNS(SVG_NS, 'rect');
        bg.setAttribute('class', 'sc-bounds-rect');
        bg.setAttribute('x',      this.canvas.x);
        bg.setAttribute('y',      this.canvas.y);
        bg.setAttribute('width',  this.canvas.width);
        bg.setAttribute('height', this.canvas.height);
        bg.setAttribute('fill',   'white');
        bg.setAttribute('stroke', '#999');
        bg.setAttribute('stroke-width', '1');
        this.boundsLayer.appendChild(bg);

        if (!this.editing) return;

        // Corner + edge resize handles for the canvas page
        const { x, y, width, height } = this.canvas;
        const handles = [
            { cx: x + width, cy: y + height, dir: 'se' },
            { cx: x + width, cy: y,          dir: 'ne' },
            { cx: x,         cy: y + height, dir: 'sw' },
            { cx: x,         cy: y,          dir: 'nw' },
            { cx: x + width / 2, cy: y + height,    dir: 's' },
            { cx: x + width / 2, cy: y,             dir: 'n' },
            { cx: x + width,     cy: y + height / 2, dir: 'e' },
            { cx: x,             cy: y + height / 2, dir: 'w' },
        ];
        for (const h of handles) {
            const r = document.createElementNS(SVG_NS, 'rect');
            const sz = 10;
            r.setAttribute('class', 'sc-bounds-handle');
            r.setAttribute('x', h.cx - sz / 2);
            r.setAttribute('y', h.cy - sz / 2);
            r.setAttribute('width',  sz);
            r.setAttribute('height', sz);
            r.style.cursor = h.dir + '-resize';
            r.dataset.dir  = h.dir;
            this._bindBoundsHandle(r, h.dir);
            this.boundsLayer.appendChild(r);
        }
    }

    _bindBoundsHandle(handleEl, dir) {
        handleEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();

            const rect = this.svgRoot.getBoundingClientRect();
            const sx   = this._viewBox.width  / rect.width;
            const sy   = this._viewBox.height / rect.height;
            const orig = { ...this.canvas };

            const onMove = (ev) => {
                const dx = (ev.clientX - e.clientX) * sx;
                const dy = (ev.clientY - e.clientY) * sy;

                let { x, y, width, height } = orig;
                if (dir.includes('e')) width  = Math.max(50, this.snap(width  + dx));
                if (dir.includes('s')) height = Math.max(50, this.snap(height + dy));
                if (dir.includes('w')) {
                    const nx = this.snap(x + dx);
                    width = Math.max(50, width + (x - nx));
                    x = nx;
                }
                if (dir.includes('n')) {
                    const ny = this.snap(y + dy);
                    height = Math.max(50, height + (y - ny));
                    y = ny;
                }
                this.canvas = { x, y, width, height };
                this._renderBounds();
                this._renderGrid();
            };

            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',   onUp);
                this._fireLayoutChange();
                this.container.dispatchEvent(new CustomEvent('sc-canvas-resize', {
                    bubbles: true, detail: { ...this.canvas },
                }));
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }


    // ── Grid overlay ─────────────────────────────────────────────────────── //

    _renderGrid() {
        this.gridLayer.innerHTML = '';
        if (!this.options.showGrid || !this.editing) return;

        const step = this.options.grid;
        if (step <= 0) return;

        const { x, y, width, height } = this.canvas;

        // Two passes: a softer minor grid every `step`, and a stronger major
        // grid every 5 steps. Stroke widths are deliberately set in canvas units
        // and made slightly bigger than 1 px so they survive viewBox scaling.
        const minorPath = document.createElementNS(SVG_NS, 'path');
        const majorPath = document.createElementNS(SVG_NS, 'path');
        let minor = '';
        let major = '';

        for (let gx = x, i = 0; gx <= x + width + 0.5; gx += step, i++) {
            const seg = `M ${gx} ${y} L ${gx} ${y + height} `;
            if (i % 5 === 0) major += seg; else minor += seg;
        }
        for (let gy = y, j = 0; gy <= y + height + 0.5; gy += step, j++) {
            const seg = `M ${x} ${gy} L ${x + width} ${gy} `;
            if (j % 5 === 0) major += seg; else minor += seg;
        }

        // `vector-effect: non-scaling-stroke` keeps the lines a constant
        // screen pixel width regardless of how the viewBox is zoomed/panned.
        // Without it the lines collapse to sub-pixel and disappear entirely.
        minorPath.setAttribute('d',      minor);
        minorPath.setAttribute('stroke', 'rgba(70, 0, 132, 0.30)');
        minorPath.setAttribute('stroke-width', '1');
        minorPath.setAttribute('vector-effect', 'non-scaling-stroke');
        minorPath.setAttribute('fill',   'none');
        minorPath.setAttribute('class',  'sc-grid sc-grid-minor');
        this.gridLayer.appendChild(minorPath);

        majorPath.setAttribute('d',      major);
        majorPath.setAttribute('stroke', 'rgba(70, 0, 132, 0.55)');
        majorPath.setAttribute('stroke-width', '1.5');
        majorPath.setAttribute('vector-effect', 'non-scaling-stroke');
        majorPath.setAttribute('fill',   'none');
        majorPath.setAttribute('class',  'sc-grid sc-grid-major');
        this.gridLayer.appendChild(majorPath);
    }


    // ── Items ───────────────────────────────────────────────────────────── //

    _rerenderAllItems() {
        this.itemLayer.innerHTML = '';
        for (const cfg of this.items) this._renderItem(cfg);
    }

    _renderItem(config) {
        const old = this._itemEl(config._id);
        if (old) old.remove();
        const g = renderItem(config, this.editing);
        if (!g) return;
        this.itemLayer.appendChild(g);
        if (this.editing) this._makeItemInteractive(g, config);
    }

    _itemEl(id) {
        return this.itemLayer.querySelector(`g[data-item-id="${id}"]`);
    }

    _makeItemInteractive(g, config) {
        g.style.cursor = 'move';

        g.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectItem(config._id);
        });

        g.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            // If the user clicked on a corner handle the handle's own listener handles it.
            if (e.target?.classList?.contains('sc-handle')) return;
            e.stopPropagation();
            e.preventDefault();

            const rect = this.svgRoot.getBoundingClientRect();
            const sx   = this._viewBox.width  / rect.width;
            const sy   = this._viewBox.height / rect.height;
            const orig = { x: parseFloat(config.attr?.x) || 0, y: parseFloat(config.attr?.y) || 0 };

            const onMove = (ev) => {
                const dx = (ev.clientX - e.clientX) * sx;
                const dy = (ev.clientY - e.clientY) * sy;
                config.attr = config.attr || {};
                config.attr.x = this.snap(orig.x + dx);
                config.attr.y = this.snap(orig.y + dy);
                this._renderItem(config);
                this._showHandles(config._id);
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',   onUp);
                this._fireLayoutChange();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }


    // ── Selection handles ───────────────────────────────────────────────── //

    _clearHandles() {
        this.handleLayer.innerHTML = '';
    }

    _showHandles(id) {
        this._clearHandles();
        const config = this.items.find(i => i._id === id);
        if (!config) return;

        const bb = getItemBBox(config);
        const pad = 3;

        const hg = document.createElementNS(SVG_NS, 'g');
        hg.setAttribute('class', 'sc-handles');

        const border = document.createElementNS(SVG_NS, 'rect');
        border.setAttribute('x',      bb.x - pad);
        border.setAttribute('y',      bb.y - pad);
        border.setAttribute('width',  bb.width  + pad * 2);
        border.setAttribute('height', bb.height + pad * 2);
        border.setAttribute('fill',   'none');
        border.setAttribute('stroke', '#0099ff');
        border.setAttribute('stroke-width', '1.5');
        border.setAttribute('stroke-dasharray', '5 3');
        border.style.pointerEvents = 'none';
        hg.appendChild(border);

        const corners = [
            { cx: bb.x,            cy: bb.y,             dir: 'nw' },
            { cx: bb.x + bb.width, cy: bb.y,             dir: 'ne' },
            { cx: bb.x,            cy: bb.y + bb.height, dir: 'sw' },
            { cx: bb.x + bb.width, cy: bb.y + bb.height, dir: 'se' },
        ];
        for (const c of corners) {
            const r = document.createElementNS(SVG_NS, 'rect');
            const sz = 8;
            r.setAttribute('class', 'sc-handle');
            r.setAttribute('x', c.cx - sz / 2);
            r.setAttribute('y', c.cy - sz / 2);
            r.setAttribute('width',  sz);
            r.setAttribute('height', sz);
            r.setAttribute('fill', 'white');
            r.setAttribute('stroke', '#0099ff');
            r.setAttribute('stroke-width', '1.5');
            r.style.cursor = c.dir + '-resize';
            this._bindResizeHandle(r, id, c.dir);
            hg.appendChild(r);
        }
        this.handleLayer.appendChild(hg);
    }

    _bindResizeHandle(h, id, dir) {
        h.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();

            const rect = this.svgRoot.getBoundingClientRect();
            const sx   = this._viewBox.width  / rect.width;
            const sy   = this._viewBox.height / rect.height;

            const cfg = this.items.find(i => i._id === id);
            if (!cfg) return;
            const bb0 = getItemBBox(cfg);

            const onMove = (ev) => {
                const dx = (ev.clientX - e.clientX) * sx;
                const dy = (ev.clientY - e.clientY) * sy;

                let { x, y, width, height } = bb0;
                if (dir.includes('e')) width  = Math.max(20, width  + dx);
                if (dir.includes('s')) height = Math.max(20, height + dy);
                if (dir.includes('w')) { x = x + dx; width  = Math.max(20, width  - dx); }
                if (dir.includes('n')) { y = y + dy; height = Math.max(20, height - dy); }

                cfg.attr = cfg.attr || {};
                cfg.attr.x      = this.snap(x);
                cfg.attr.y      = this.snap(y);
                cfg.attr.width  = this.snap(width);
                cfg.attr.height = this.snap(height);

                // Special case: text uses x/y as baseline anchor; keep height effective.
                if (cfg.type === 'text') {
                    // Approximate baseline shift so resizing visually grows the box.
                    cfg.attr.y = this.snap(y + height * 0.7);
                }

                this._renderItem(cfg);
                this._showHandles(id);
            };

            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',   onUp);
                this._fireLayoutChange();
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }


    // ── Plumbing ─────────────────────────────────────────────────────────── //

    _fireLayoutChange() {
        this.container.dispatchEvent(new CustomEvent('sc-layout-change', { bubbles: true }));
    }
}


// ── Helpers ──────────────────────────────────────────────────────────── //

function _parseViewBox(s) {
    if (!s) return null;
    if (typeof s === 'object') return _sanitiseBounds(s);
    const parts = String(s).trim().split(/[\s,]+/).map(parseFloat);
    if (parts.length < 4 || parts.some(p => !Number.isFinite(p))) return null;
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function _sanitiseBounds(b) {
    const out = {};
    for (const k of ['x', 'y', 'width', 'height']) {
        if (b[k] != null) {
            const n = parseFloat(b[k]);
            if (Number.isFinite(n)) out[k] = n;
        }
    }
    return out;
}

function _normaliseItem(raw) {
    const cfg = { ...raw };
    cfg.attr = { ...(raw.attr || {}) };
    if (raw.metric) cfg.metric = { ...raw.metric };
    if (raw.action) cfg.action = { ...raw.action };
    if (!cfg._id) cfg._id = 'item-' + Math.random().toString(36).slice(2, 9);
    return cfg;
}

function _serialiseItem(cfg) {
    const out = { type: cfg.type, attr: { ...cfg.attr } };
    if (cfg.metric && Object.keys(cfg.metric).length) out.metric = { ...cfg.metric };
    if (cfg.action && Object.keys(cfg.action).length) out.action = { ...cfg.action };
    return out;
}
