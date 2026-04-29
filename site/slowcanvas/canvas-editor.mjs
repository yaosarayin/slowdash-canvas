// canvas-editor.mjs — interactive SVG viewport for the canvas editor
// Author: Yao Yin
// Created: 2026-04-29
//
// CanvasEditor manages:
//   • An <svg> viewport that holds the background SVG and all items.
//   • Pan (middle-mouse / space+drag) and zoom (wheel).
//   • Item rendering, selection, drag-to-move, and resize handles.
//   • Re-export of the current layout as a plain JSON object.
//
// The editor fires custom events on its container element:
//   sc-item-select  — { detail: { id } }  when an item is selected
//   sc-item-deselect — fired when the selection is cleared
//   sc-layout-change — fired after any structural change (move, resize, add, delete)

import { renderItem, updateItemData, getItemChannels, ITEM_REGISTRY } from './canvas-items.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── CanvasEditor ─────────────────────────────────────────────────────────── //

export class CanvasEditor {
    /**
     * @param {HTMLElement} container  The host element (gets position:relative).
     * @param {object}      options    Optional overrides.
     */
    constructor(container, options = {}) {
        this.container = container;
        this.options   = options;

        // Runtime state
        this.editing      = false;
        this.items        = [];          // array of item config objects (source of truth)
        this.selectedId   = null;
        this.background   = null;        // { file, x, y, width, height }
        this.viewBox      = { x: 0, y: 0, width: 1200, height: 800 };

        // Pan/zoom
        this._pan         = { x: 0, y: 0 };
        this._zoom        = 1.0;
        this._dragging    = false;
        this._dragStart   = null;

        // Item drag
        this._itemDrag      = null;   // { id, startX, startY, origX, origY }
        this._resizeDrag    = null;   // { id, handle, startX, startY, orig }

        this._buildDOM();
        this._bindEvents();
    }


    // ── Public API ───────────────────────────────────────────────────────── //

    /** Switch between view (false) and edit (true) modes. */
    setEditing(editing) {
        this.editing = editing;
        this.svgRoot.setAttribute('data-editing', editing ? '1' : '0');
        this._rerenderAllItems();
        if (!editing) this.deselect();
    }

    /**
     * Load a full canvas layout object (the JSON from the server).
     * Replaces all current items and the background.
     */
    loadLayout(layout) {
        const canvas = layout.canvas || {};
        this.viewBox   = { x: 0, y: 0, width: 1200, height: 800, ...(canvas.viewBox || {}) };
        this.background = canvas.background || null;
        this.items      = (layout.items || []).map(i => ({ ...i }));

        this.svgRoot.setAttribute('viewBox',
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);

        this._applyBackground();
        this._rerenderAllItems();
        this._resetViewport();
    }

    /** Return the current layout as a plain JSON-serialisable object. */
    getLayout() {
        return {
            canvas: {
                viewBox:    { ...this.viewBox },
                background: this.background ? { ...this.background } : null,
                dataRefresh: this.options.dataRefresh || 10,
            },
            items: this.items.map(i => ({ ...i })),
        };
    }

    /** Set or replace the background SVG. */
    setBackground(svgFilename, svgText, placement = {}) {
        this.background = {
            file:   svgFilename,
            x:      placement.x      ?? this.viewBox.x,
            y:      placement.y      ?? this.viewBox.y,
            width:  placement.width  ?? this.viewBox.width,
            height: placement.height ?? this.viewBox.height,
        };
        this._applyBackground(svgText);
        this._fireLayoutChange();
    }

    /** Add a new item from a config object. Returns the new item. */
    addItem(config) {
        this.items.push(config);
        this._renderItem(config);
        this._fireLayoutChange();
        this.selectItem(config.id);
        return config;
    }

    /** Remove an item by id. */
    removeItem(id) {
        this.items = this.items.filter(i => i.id !== id);
        const el = this._itemEl(id);
        if (el) el.remove();
        const handles = this.svgRoot.querySelector(`.sc-handles[data-for="${id}"]`);
        if (handles) handles.remove();
        if (this.selectedId === id) this.deselect();
        this._fireLayoutChange();
    }

    /** Update a property path (e.g. 'style.fill') on an existing item. */
    updateItemProp(id, path, value) {
        const config = this.items.find(i => i.id === id);
        if (!config) return;
        _setPath(config, path, value);
        this._rerenderItem(id);
        this._fireLayoutChange();
    }

    /** Replace the full config for an item and re-render it. */
    updateItem(newConfig) {
        const idx = this.items.findIndex(i => i.id === newConfig.id);
        if (idx < 0) return;
        this.items[idx] = { ...newConfig };
        this._rerenderItem(newConfig.id);
        this._fireLayoutChange();
    }

    /** Select an item by id (shows handles in edit mode). */
    selectItem(id) {
        this.deselect();
        this.selectedId = id;
        if (this.editing) this._showHandles(id);
        this.container.dispatchEvent(new CustomEvent('sc-item-select', {
            bubbles: true, detail: { id },
        }));
    }

    /** Clear the current selection. */
    deselect() {
        this.selectedId = null;
        this.svgRoot.querySelectorAll('.sc-handles').forEach(el => el.remove());
        this.container.dispatchEvent(new CustomEvent('sc-item-deselect', { bubbles: true }));
    }

    /** Update live data for all data-display items. */
    updateData(dataPacket) {
        if (!dataPacket) return;
        for (const config of this.items) {
            const channels = getItemChannels(config);
            if (!channels.length) continue;

            const channel = channels[0];
            const ts = dataPacket[channel];
            const [, value] = _lastTX(ts);
            const status = _channelStatus(config, dataPacket, channel);
            const g = this._itemEl(config.id);
            if (g) updateItemData(g, config, value, status);
        }
    }

    /** Returns all channel names needed by current items. */
    getNeededChannels() {
        const set = new Set();
        for (const config of this.items) {
            for (const ch of getItemChannels(config)) set.add(ch);
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
        this.svgRoot.setAttribute('viewBox', `0 0 ${this.viewBox.width} ${this.viewBox.height}`);
        this.svgRoot.style.width  = '100%';
        this.svgRoot.style.height = '100%';
        this.svgRoot.style.display = 'block';
        this.svgRoot.style.userSelect = 'none';
        this.container.appendChild(this.svgRoot);

        // <g> that receives pan/zoom transform
        this.viewportG = document.createElementNS(SVG_NS, 'g');
        this.viewportG.setAttribute('class', 'sc-viewport-g');
        this.svgRoot.appendChild(this.viewportG);

        // Background layer inside the transformed group
        this.bgLayer = document.createElementNS(SVG_NS, 'g');
        this.bgLayer.setAttribute('class', 'sc-bg-layer');
        this.viewportG.appendChild(this.bgLayer);

        // Item layer
        this.itemLayer = document.createElementNS(SVG_NS, 'g');
        this.itemLayer.setAttribute('class', 'sc-item-layer');
        this.viewportG.appendChild(this.itemLayer);

        // Handle layer (selection / resize handles; stays on top)
        this.handleLayer = document.createElementNS(SVG_NS, 'g');
        this.handleLayer.setAttribute('class', 'sc-handle-layer');
        this.viewportG.appendChild(this.handleLayer);

        // Transparent hit-rect to capture background clicks
        const hitRect = document.createElementNS(SVG_NS, 'rect');
        hitRect.setAttribute('class', 'sc-hit-rect');
        hitRect.setAttribute('x', this.viewBox.x);
        hitRect.setAttribute('y', this.viewBox.y);
        hitRect.setAttribute('width',  this.viewBox.width);
        hitRect.setAttribute('height', this.viewBox.height);
        hitRect.setAttribute('fill',   'transparent');
        hitRect.style.pointerEvents = 'fill';
        this.bgLayer.insertBefore(hitRect, this.bgLayer.firstChild);
        this._hitRect = hitRect;

        hitRect.addEventListener('click', (e) => {
            if (this.editing) this.deselect();
        });
    }


    // ── Event binding ─────────────────────────────────────────────────────── //

    _bindEvents() {
        // Zoom
        this.svgRoot.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            const rect   = this.svgRoot.getBoundingClientRect();
            const cx     = (e.clientX - rect.left) / rect.width  * this.viewBox.width  + this.viewBox.x;
            const cy     = (e.clientY - rect.top)  / rect.height * this.viewBox.height + this.viewBox.y;
            const newW   = this.viewBox.width  / factor;
            const newH   = this.viewBox.height / factor;
            this.viewBox = {
                x: cx - (cx - this.viewBox.x) / factor,
                y: cy - (cy - this.viewBox.y) / factor,
                width:  newW,
                height: newH,
            };
            this._applyViewBox();
        }, { passive: false });

        // Pan via middle-mouse drag or space+drag
        this.svgRoot.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && e.getModifierState('Space'))) {
                this._panStart = { x: e.clientX, y: e.clientY, vb: { ...this.viewBox } };
                e.preventDefault();
            }
        });
        window.addEventListener('mousemove', (e) => {
            if (!this._panStart) return;
            const rect  = this.svgRoot.getBoundingClientRect();
            const scaleX = this.viewBox.width  / rect.width;
            const scaleY = this.viewBox.height / rect.height;
            const dx = (e.clientX - this._panStart.x) * scaleX;
            const dy = (e.clientY - this._panStart.y) * scaleY;
            this.viewBox = {
                ...this._panStart.vb,
                x: this._panStart.vb.x - dx,
                y: this._panStart.vb.y - dy,
            };
            this._applyViewBox();
        });
        window.addEventListener('mouseup', () => { this._panStart = null; });
    }


    // ── Item interaction ─────────────────────────────────────────────────── //

    _makeItemInteractive(g, config) {
        if (!this.editing) return;

        g.style.cursor = 'move';

        g.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectItem(config.id);
        });

        g.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();

            const rect    = this.svgRoot.getBoundingClientRect();
            const svgRect = this.svgRoot.viewBox.baseVal;
            const scaleX  = svgRect.width  / rect.width;
            const scaleY  = svgRect.height / rect.height;

            this._itemDrag = {
                id:    config.id,
                startX: e.clientX,
                startY: e.clientY,
                origX:  config.x,
                origY:  config.y,
                scaleX, scaleY,
            };

            const onMove = (ev) => {
                if (!this._itemDrag) return;
                const dx = (ev.clientX - this._itemDrag.startX) * this._itemDrag.scaleX;
                const dy = (ev.clientY - this._itemDrag.startY) * this._itemDrag.scaleY;
                const cfg = this.items.find(i => i.id === this._itemDrag.id);
                if (!cfg) return;
                cfg.x = Math.round(this._itemDrag.origX + dx);
                cfg.y = Math.round(this._itemDrag.origY + dy);
                this._rerenderItem(cfg.id);
                this._showHandles(cfg.id);
            };

            const onUp = () => {
                if (this._itemDrag) {
                    this._fireLayoutChange();
                    this._itemDrag = null;
                }
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',  onUp);
            };

            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }


    // ── Handles (selection + resize) ─────────────────────────────────────── //

    _showHandles(id) {
        // Remove old handles for this item
        this.svgRoot.querySelectorAll(`.sc-handles[data-for="${id}"]`).forEach(el => el.remove());

        const config = this.items.find(i => i.id === id);
        if (!config) return;

        const hg = document.createElementNS(SVG_NS, 'g');
        hg.setAttribute('class', 'sc-handles');
        hg.setAttribute('data-for', id);

        const { x, y, width, height } = config;
        const pad = 4;

        // Dashed selection border
        const border = document.createElementNS(SVG_NS, 'rect');
        border.setAttribute('x',           x - pad);
        border.setAttribute('y',           y - pad);
        border.setAttribute('width',       width  + pad * 2);
        border.setAttribute('height',      height + pad * 2);
        border.setAttribute('fill',        'none');
        border.setAttribute('stroke',      '#0099ff');
        border.setAttribute('stroke-width', '1.5');
        border.setAttribute('stroke-dasharray', '5 3');
        border.style.pointerEvents = 'none';
        hg.appendChild(border);

        // Corner resize handles
        const corners = [
            { cx: x,          cy: y,           dir: 'nw' },
            { cx: x + width,  cy: y,           dir: 'ne' },
            { cx: x,          cy: y + height,  dir: 'sw' },
            { cx: x + width,  cy: y + height,  dir: 'se' },
        ];
        for (const c of corners) {
            const h = document.createElementNS(SVG_NS, 'rect');
            const hs = 8;
            h.setAttribute('x',      c.cx - hs / 2);
            h.setAttribute('y',      c.cy - hs / 2);
            h.setAttribute('width',  hs);
            h.setAttribute('height', hs);
            h.setAttribute('fill',   'white');
            h.setAttribute('stroke', '#0099ff');
            h.setAttribute('stroke-width', '1.5');
            h.style.cursor = c.dir + '-resize';
            h.dataset.dir  = c.dir;
            this._bindResizeHandle(h, id, config, c.dir);
            hg.appendChild(h);
        }

        this.handleLayer.appendChild(hg);
    }

    _bindResizeHandle(h, id, origConfig, dir) {
        h.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();

            const rect   = this.svgRoot.getBoundingClientRect();
            const svgVB  = this.svgRoot.viewBox.baseVal;
            const scaleX = svgVB.width  / rect.width;
            const scaleY = svgVB.height / rect.height;

            const snap = this.options.snap || 1;
            const drag = {
                startX: e.clientX,
                startY: e.clientY,
                orig:   { x: origConfig.x, y: origConfig.y, width: origConfig.width, height: origConfig.height },
                scaleX, scaleY, dir,
            };

            const onMove = (ev) => {
                const dx = (ev.clientX - drag.startX) * drag.scaleX;
                const dy = (ev.clientY - drag.startY) * drag.scaleY;
                const cfg = this.items.find(i => i.id === id);
                if (!cfg) return;

                let { x, y, width, height } = drag.orig;
                if (dir.includes('e')) { width  = Math.max(40, width  + dx); }
                if (dir.includes('s')) { height = Math.max(20, height + dy); }
                if (dir.includes('w')) { x = x + dx; width  = Math.max(40, width  - dx); }
                if (dir.includes('n')) { y = y + dy; height = Math.max(20, height - dy); }

                cfg.x = Math.round(x / snap) * snap;
                cfg.y = Math.round(y / snap) * snap;
                cfg.width  = Math.round(width  / snap) * snap;
                cfg.height = Math.round(height / snap) * snap;

                this._rerenderItem(id);
                this._showHandles(id);
            };

            const onUp = () => {
                this._fireLayoutChange();
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup',   onUp);
            };

            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup',   onUp);
        });
    }


    // ── Rendering helpers ─────────────────────────────────────────────────── //

    _applyBackground(svgText) {
        this.bgLayer.innerHTML = '';

        // Re-add the hit rect
        this.bgLayer.appendChild(this._hitRect);

        if (!this.background) return;

        if (svgText) {
            // Inline SVG embedded in a foreignObject for full fidelity
            const parser = new DOMParser();
            const doc    = parser.parseFromString(svgText, 'image/svg+xml');
            const svgEl  = doc.documentElement;

            // Place it using a nested <svg> with position/size from background config
            const nested = document.createElementNS(SVG_NS, 'svg');
            nested.setAttribute('x',      this.background.x);
            nested.setAttribute('y',      this.background.y);
            nested.setAttribute('width',  this.background.width);
            nested.setAttribute('height', this.background.height);
            nested.setAttribute('class',  'sc-background-svg');
            nested.setAttribute('preserveAspectRatio', 'xMidYMid meet');

            // Copy viewBox from source SVG if available
            const vb = svgEl.getAttribute('viewBox');
            if (vb) nested.setAttribute('viewBox', vb);

            // Move children across
            while (svgEl.firstChild) nested.appendChild(svgEl.firstChild);

            // Allow background SVG elements to be selected for property editing
            if (this.editing) {
                nested.style.cursor = 'default';
                nested.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const target = e.target;
                    if (target !== nested) {
                        this.container.dispatchEvent(new CustomEvent('sc-svg-element-select', {
                            bubbles: true, detail: { element: target },
                        }));
                    }
                });
            }

            this.bgLayer.appendChild(nested);
            this.background._svgEl = nested;
        } else if (this.background.file) {
            // Fall back to <image> if we only have a filename (e.g. after reload)
            const img = document.createElementNS(SVG_NS, 'image');
            img.setAttribute('href',   `./api/config/file/${this.background.file}`);
            img.setAttribute('x',      this.background.x);
            img.setAttribute('y',      this.background.y);
            img.setAttribute('width',  this.background.width);
            img.setAttribute('height', this.background.height);
            img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            this.bgLayer.appendChild(img);
        }
    }

    _renderItem(config) {
        const existing = this._itemEl(config.id);
        if (existing) existing.remove();

        const g = renderItem(config, this.editing);
        if (!g) return;

        this.itemLayer.appendChild(g);
        this._makeItemInteractive(g, config);
    }

    _rerenderItem(id) {
        const config = this.items.find(i => i.id === id);
        if (!config) return;
        this._renderItem(config);
        if (this.editing && this.selectedId === id) {
            this._showHandles(id);
        }
    }

    _rerenderAllItems() {
        this.itemLayer.innerHTML = '';
        for (const config of this.items) this._renderItem(config);
    }

    _itemEl(id) {
        return this.itemLayer.querySelector(`#sc-item-${id.replace(/[^a-z0-9]/gi, '_')}`);
    }

    _applyViewBox() {
        this.svgRoot.setAttribute('viewBox',
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
    }

    _resetViewport() {
        this.viewBox = { x: 0, y: 0, width: this.viewBox.width, height: this.viewBox.height };
        this._applyViewBox();
    }

    _fireLayoutChange() {
        this.container.dispatchEvent(new CustomEvent('sc-layout-change', { bubbles: true }));
    }
}


// ── Utility ──────────────────────────────────────────────────────────────── //

/** Set a nested property by dot-path (e.g. 'style.fill'). */
function _setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

/** Extract the last [time, value] from a timeseries data packet. */
function _lastTX(ts) {
    if (!ts || !ts.t || ts.t.length === 0) return [null, null];
    const last = ts.t.length - 1;
    return [ts.t[last], ts.x ? ts.x[last] : null];
}

/** Determine channel status from the data packet and item config. */
function _channelStatus(config, dataPacket, channel) {
    const ts = dataPacket[channel];
    if (!ts || !ts.t || ts.t.length === 0) return 'dead';

    const [, value] = _lastTX(ts);
    if (value === null || value === undefined) return 'dead';

    const above = config['active-above'];
    const below = config['active-below'];
    if (above !== undefined && above !== null && value < above) return 'inactive';
    if (below !== undefined && below !== null && value > below) return 'inactive';

    return 'active';
}
