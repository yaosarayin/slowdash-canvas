// canvas-items.mjs — item type definitions for the canvas editor overlay
// Author: Yao Yin
// Created: 2026-04-29
//
// Each item type is a plain-object descriptor plus static rendering helpers.
// Items are drawn as SVG foreign-object or SVG group elements inside the
// canvas viewport SVG so they scale with the viewport transform.
//
// Item schema (stored in the layout JSON):
//   {
//     id:     string   — unique identifier
//     type:   string   — one of ITEM_TYPES keys
//     x:      number   — left edge in canvas coordinates
//     y:      number   — top edge in canvas coordinates
//     width:  number   — width in canvas coordinates
//     height: number   — height in canvas coordinates
//     label:  string   — display label
//     ... type-specific fields ...
//     style:  object   — visual overrides (fill, color, rx, fontSize, etc.)
//   }


// ── Constants ──────────────────────────────────────────────────────────────── //

const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULTS = {
    'plot-button':    { width: 140, height: 44, label: 'Open Plot',    style: { fill: '#3498db', color: 'white',  rx: 8 } },
    'data-display':   { width: 180, height: 70, label: 'Value',        style: { fill: 'white',   color: '#009090', border: '#009090' } },
    'control-button': { width: 140, height: 44, label: 'Run Command',  style: { fill: '#e74c3c', color: 'white',  rx: 8 } },
};

// ── Utility ────────────────────────────────────────────────────────────────── //

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function svgText(txt, attrs = {}) {
    const el = svgEl('text', attrs);
    el.textContent = txt;
    return el;
}

/** Returns a safe DOM-id for an item id (removes special chars). */
function domId(itemId) {
    return 'sc-item-' + itemId.replace(/[^a-z0-9]/gi, '_');
}


// ── ItemRenderer base ──────────────────────────────────────────────────────── //

/**
 * Base class.  Subclasses override render() and optionally updateData().
 * All methods are static — there is no instance state; the SVG DOM is the state.
 */
class ItemRenderer {
    /** Human-readable label used in the "Add item" dialog. */
    static label = '';

    /**
     * Returns a new default config object for this item type.
     * @param {number} x  Suggested placement x.
     * @param {number} y  Suggested placement y.
     */
    static defaultConfig(type, x = 100, y = 100) {
        const d = DEFAULTS[type] || { width: 120, height: 40, label: 'Item', style: {} };
        return {
            id:     'item-' + Math.random().toString(36).slice(2, 9),
            type,
            x, y,
            width:  d.width,
            height: d.height,
            label:  d.label,
            style:  { ...d.style },
        };
    }

    /**
     * Render the item into an SVG <g> element.
     * @param {object} config   Item config object.
     * @param {boolean} editing Whether the canvas is in edit mode.
     * @returns {SVGGElement}
     */
    static render(config, editing) {
        throw new Error('ItemRenderer.render() not implemented');
    }

    /**
     * Update the item's visual from a fresh data value.
     * Called periodically during view mode.
     * @param {SVGGElement} g        The item's root <g> element.
     * @param {object}      config   Item config.
     * @param {number|null} value    Latest data value (null if unavailable).
     * @param {string}      status   'active' | 'inactive' | 'dead' | 'none'
     */
    static updateData(g, config, value, status) {
        // default: nothing
    }

    /**
     * Returns an array of form-field descriptors for the properties panel.
     * Each descriptor: { key, label, type ('text'|'number'|'color'|'checkbox'), placeholder }
     */
    static propertyFields() {
        return [
            { key: 'label',  label: 'Label',  type: 'text' },
            { key: 'x',      label: 'X',      type: 'number' },
            { key: 'y',      label: 'Y',      type: 'number' },
            { key: 'width',  label: 'Width',  type: 'number' },
            { key: 'height', label: 'Height', type: 'number' },
        ];
    }

    /** Names of data channels this item needs (empty array = none). */
    static getChannels(config) {
        return [];
    }
}


// ── PlotButton ─────────────────────────────────────────────────────────────── //

class PlotButton extends ItemRenderer {
    static label = 'Plot Button';

    static render(config, editing) {
        const g = svgEl('g', { id: domId(config.id), class: 'sc-item sc-plot-button' });
        const s = config.style || {};
        const rx = s.rx ?? 8;
        const fill = s.fill || '#3498db';
        const textColor = s.color || 'white';
        const { x, y, width, height, label } = config;

        const rect = svgEl('rect', {
            x, y, width, height, rx,
            fill,
            stroke: s.stroke || fill,
            'stroke-width': 1,
        });
        g.appendChild(rect);

        // Icon
        const iconX = x + 12;
        const iconY = y + height / 2;
        const icon = svgText('📈', {
            x: iconX, y: iconY,
            'font-size': Math.min(height * 0.5, 18),
            'dominant-baseline': 'middle',
            'text-anchor': 'middle',
        });
        g.appendChild(icon);

        // Label text
        const txt = svgText(label || 'Plot', {
            x: x + width / 2 + 6,
            y: y + height / 2,
            fill: textColor,
            'font-size': s.fontSize || Math.min(height * 0.38, 15),
            'font-family': 'sans-serif',
            'dominant-baseline': 'middle',
            'text-anchor': 'middle',
        });
        g.appendChild(txt);

        if (!editing && config.href) {
            g.style.cursor = 'pointer';
            g.addEventListener('click', () => {
                window.open(config.href, config.target || '_blank');
            });
        }

        return g;
    }

    static propertyFields() {
        return [
            ...super.propertyFields(),
            { key: 'href',   label: 'URL (slowplot link)', type: 'text', placeholder: 'slowplot.html?config=...' },
            { key: 'target', label: 'Open in',            type: 'select', options: ['_blank', '_self'] },
            { key: 'style.fill',  label: 'Background',    type: 'color' },
            { key: 'style.color', label: 'Text color',    type: 'color' },
            { key: 'style.rx',    label: 'Corner radius',  type: 'number' },
        ];
    }
}


// ── DataDisplay ────────────────────────────────────────────────────────────── //

class DataDisplay extends ItemRenderer {
    static label = 'Data Display';

    static render(config, editing) {
        const g = svgEl('g', { id: domId(config.id), class: 'sc-item sc-data-display' });
        const s = config.style || {};
        const { x, y, width, height, label } = config;

        // Border rect
        const rect = svgEl('rect', {
            x, y, width, height, rx: s.rx ?? 4,
            fill: s.fill || 'white',
            stroke: s.border || '#009090',
            'stroke-width': 1.5,
        });
        g.appendChild(rect);

        // Channel label (top)
        const labelTxt = svgText(label || config.channel || 'Channel', {
            x: x + width / 2,
            y: y + height * 0.32,
            fill: s.labelColor || '#555',
            'font-size': s.labelFontSize || Math.min(height * 0.28, 12),
            'font-family': 'sans-serif',
            'dominant-baseline': 'middle',
            'text-anchor': 'middle',
        });
        labelTxt.setAttribute('data-role', 'label');
        g.appendChild(labelTxt);

        // Value (center, larger)
        const valueTxt = svgText('—', {
            x: x + width / 2,
            y: y + height * 0.68,
            fill: s.color || '#009090',
            'font-size': s.fontSize || Math.min(height * 0.42, 20),
            'font-family': 'monospace',
            'font-weight': 'bold',
            'dominant-baseline': 'middle',
            'text-anchor': 'middle',
        });
        valueTxt.setAttribute('data-role', 'value');
        g.appendChild(valueTxt);

        return g;
    }

    static updateData(g, config, value, status) {
        const s = config.style || {};
        const valueTxt = g.querySelector('[data-role="value"]');
        const rect     = g.querySelector('rect');
        if (!valueTxt) return;

        if (value === null || value === undefined) {
            valueTxt.textContent = '—';
            if (rect) rect.setAttribute('stroke', '#aaa');
            return;
        }

        const fmt = config.format || '%.4g';
        valueTxt.textContent = _formatValue(value, fmt);

        const colorActive   = s.colorActive   || '#009090';
        const colorInactive = s.colorInactive || 'orange';
        const colorDead     = s.colorDead     || '#bbb';

        let borderColor = colorActive;
        if (status === 'inactive') borderColor = colorInactive;
        if (status === 'dead')     borderColor = colorDead;

        if (rect) rect.setAttribute('stroke', borderColor);
        valueTxt.setAttribute('fill', borderColor);
    }

    static propertyFields() {
        return [
            ...super.propertyFields(),
            { key: 'channel',      label: 'Data channel',   type: 'text',   placeholder: 'channel_name' },
            { key: 'format',       label: 'Format string',  type: 'text',   placeholder: '%.4g' },
            { key: 'active-above', label: 'Active above',   type: 'number', placeholder: '' },
            { key: 'active-below', label: 'Active below',   type: 'number', placeholder: '' },
            { key: 'style.fill',   label: 'Background',     type: 'color' },
            { key: 'style.border', label: 'Border color',   type: 'color' },
        ];
    }

    static getChannels(config) {
        return config.channel ? [config.channel] : [];
    }
}


// ── ControlButton ──────────────────────────────────────────────────────────── //

class ControlButton extends ItemRenderer {
    static label = 'Control Button';

    static render(config, editing) {
        const g = svgEl('g', { id: domId(config.id), class: 'sc-item sc-control-button' });
        const s = config.style || {};
        const rx = s.rx ?? 8;
        const fill = s.fill || '#e74c3c';
        const textColor = s.color || 'white';
        const { x, y, width, height, label } = config;

        const rect = svgEl('rect', {
            x, y, width, height, rx,
            fill,
            stroke: s.stroke || _darken(fill),
            'stroke-width': 1,
        });
        g.appendChild(rect);

        // Icon
        const icon = svgText('⚙', {
            x: x + 14,
            y: y + height / 2,
            'font-size': Math.min(height * 0.5, 18),
            'dominant-baseline': 'middle',
            'text-anchor': 'middle',
            fill: textColor,
        });
        g.appendChild(icon);

        // Label
        const txt = svgText(label || 'Run', {
            x: x + width / 2 + 6,
            y: y + height / 2,
            fill: textColor,
            'font-size': s.fontSize || Math.min(height * 0.38, 15),
            'font-family': 'sans-serif',
            'dominant-baseline': 'middle',
            'text-anchor': 'middle',
        });
        g.appendChild(txt);

        // Hover feedback during view mode
        if (!editing) {
            rect.addEventListener('mouseenter', () => rect.setAttribute('opacity', '0.85'));
            rect.addEventListener('mouseleave', () => rect.setAttribute('opacity', '1'));
            g.style.cursor = 'pointer';
            g.addEventListener('click', () => {
                // Dispatch custom event — canvas-app.mjs listens and calls CanvasAPI.sendCommand()
                g.dispatchEvent(new CustomEvent('sc-control-click', {
                    bubbles: true,
                    detail: { action: config.action, params: config.params || {} },
                }));
            });
        }

        return g;
    }

    static propertyFields() {
        return [
            ...super.propertyFields(),
            { key: 'action', label: 'Action / command name', type: 'text',     placeholder: 'my_script_action' },
            { key: 'params', label: 'Params (JSON)',          type: 'textarea', placeholder: '{}' },
            { key: 'style.fill',  label: 'Background',       type: 'color' },
            { key: 'style.color', label: 'Text color',       type: 'color' },
            { key: 'style.rx',    label: 'Corner radius',    type: 'number' },
        ];
    }
}


// ── Registry ────────────────────────────────────────────────────────────────── //

export const ITEM_REGISTRY = {
    'plot-button':    PlotButton,
    'data-display':   DataDisplay,
    'control-button': ControlButton,
};

/** Returns a default config for the given item type, placed at (x, y). */
export function makeDefaultConfig(type, x = 100, y = 100) {
    return ItemRenderer.defaultConfig(type, x, y);
}

/** Render a single item config into a new SVG group element. */
export function renderItem(config, editing = false) {
    const Cls = ITEM_REGISTRY[config.type];
    if (!Cls) {
        console.warn('Unknown item type:', config.type);
        return null;
    }
    return Cls.render(config, editing);
}

/** Update the visual of an already-rendered item from new data. */
export function updateItemData(g, config, value, status) {
    const Cls = ITEM_REGISTRY[config.type];
    if (Cls) Cls.updateData(g, config, value, status);
}

/** Return property field descriptors for the given item type. */
export function getPropertyFields(type) {
    const Cls = ITEM_REGISTRY[type];
    return Cls ? Cls.propertyFields() : [];
}

/** Return all data channels needed by an item config. */
export function getItemChannels(config) {
    const Cls = ITEM_REGISTRY[config.type];
    return Cls ? Cls.getChannels(config) : [];
}


// ── Helpers ─────────────────────────────────────────────────────────────────── //

/**
 * Format a numeric value using a printf-style format string.
 * Supports %d, %i, %f, %e, %g, %s.
 */
function _formatValue(value, fmt) {
    if (typeof value !== 'number') return String(value);
    const m = fmt.match(/^(.*?)%([\d.+-]*)([difegs])(.*?)$/);
    if (!m) return String(value);
    const [, pre, spec, conv, post] = m;
    let out;
    switch (conv) {
        case 'd': case 'i': out = Math.round(value).toString(); break;
        case 'f': {
            const dp = parseInt((spec.match(/\.(\d+)/) || [,'4'])[1]);
            out = value.toFixed(dp);
            break;
        }
        case 'e': {
            const dp = parseInt((spec.match(/\.(\d+)/) || [,'4'])[1]);
            out = value.toExponential(dp);
            break;
        }
        case 'g': case 's': default: {
            const sig = parseInt((spec.match(/\.(\d+)/) || [,'4'])[1]);
            out = parseFloat(value.toPrecision(sig)).toString();
            break;
        }
    }
    return pre + out + post;
}

/** Darkens a hex color by ~20 % for border/shadow use. */
function _darken(hex) {
    try {
        const n = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, ((n >> 16) & 0xff) - 40);
        const g = Math.max(0, ((n >> 8)  & 0xff) - 40);
        const b = Math.max(0, (n          & 0xff) - 40);
        return `rgb(${r},${g},${b})`;
    } catch { return hex; }
}
