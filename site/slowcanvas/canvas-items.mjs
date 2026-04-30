// canvas-items.mjs — item type definitions for the SlowCanvas editor
// Author: Yao Yin
//
// The on-disk format mirrors the existing slowdash canvas-panel schema
// (app/site/slowjs/panel-canvas.mjs):
//
//   { type, attr: {...}, metric?: {...}, action?: {...} }
//
// `type` is one of the slowdash canvas item kinds: image, text, box,
// circle, valve, solenoid, button, plot, micro_plot, grid.
//
// The editor only needs *visual approximations* of each item — the
// authoritative rendering happens in the live-preview iframe (slowdash.html)
// which loads the same JSON via the real panel-canvas renderer.


// ── Constants ────────────────────────────────────────────────────────── //

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Defaults used when a new item is added from the toolbar. */
const ITEM_PRESETS = {
    text:     { width: 120, height: 32, label: 'Label',
                attr: { 'font-size': '14pt', 'fill': '#222', 'text': 'Label' } },
    box:      { width: 80,  height: 80,
                attr: { 'stroke': '#333', 'stroke-width': 1, 'fill': 'none' } },
    circle:   { width: 60,  height: 60,
                attr: { 'stroke': '#333', 'stroke-width': 1, 'fill': 'none' } },
    button:   { width: 120, height: 36, label: 'Button',
                attr: { 'rx': 6, 'ry': 6, 'stroke': '#333', 'fill': 'none', 'label': 'Button' } },
    image:    { width: 200, height: 150,
                attr: { 'href': '' } },
    valve:    { width: 30,  height: 30,
                attr: { 'stroke': '#333', 'fill': 'none', 'orientation': 'horizontal' } },
    solenoid: { width: 60,  height: 30,
                attr: { 'stroke': '#333', 'stroke-width': 3, 'fill': 'none', 'turns': 12 } },
    grid:     { width: null, height: null,
                attr: { 'dx': 50, 'dy': 50, 'stroke': 'lightgray', 'stroke-width': 0.5 } },
};

/** Friendly labels shown in the toolbar's "Add" menu. */
const ITEM_LABELS = {
    text:     'Text',
    box:      'Box',
    circle:   'Circle',
    button:   'Button',
    image:    'Image',
    valve:    'Valve',
    solenoid: 'Solenoid',
    grid:     'Grid',
};


// ── Utility ──────────────────────────────────────────────────────────── //

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
    return el;
}

function svgText(txt, attrs = {}) {
    const el = svgEl('text', attrs);
    el.textContent = txt;
    return el;
}

function clientItemId() {
    return 'item-' + Math.random().toString(36).slice(2, 9);
}

/** Returns the item's bounding box (x, y, width, height) in canvas coords. */
export function getItemBBox(item) {
    const a = item.attr || {};
    const x = parseFloat(a.x) || 0;
    const y = parseFloat(a.y) || 0;
    const w = parseFloat(a.width)  || ITEM_PRESETS[item.type]?.width  || 80;
    const h = parseFloat(a.height) || ITEM_PRESETS[item.type]?.height || 30;
    return { x, y, width: w, height: h };
}

/** Read a nested key like 'attr.x' or 'metric.channel' from the item config. */
export function getItemKey(item, path) {
    const parts = path.split('.');
    let v = item;
    for (const p of parts) {
        if (v == null) return undefined;
        v = v[p];
    }
    return v;
}

/** Set a nested key, auto-creating intermediate objects. */
export function setItemKey(item, path, value) {
    const parts = path.split('.');
    let target = item;
    for (let i = 0; i < parts.length - 1; i++) {
        if (target[parts[i]] == null || typeof target[parts[i]] !== 'object') {
            target[parts[i]] = {};
        }
        target = target[parts[i]];
    }
    if (value === '' || value === null || value === undefined) {
        delete target[parts[parts.length - 1]];
    } else {
        target[parts[parts.length - 1]] = value;
    }
}


// ── Default config factory ───────────────────────────────────────────── //

export function makeDefaultConfig(type, x = 100, y = 100) {
    const preset = ITEM_PRESETS[type] || { width: 80, height: 80, attr: {} };
    const attr = {
        x, y,
        ...(preset.width  != null ? { width:  preset.width }  : {}),
        ...(preset.height != null ? { height: preset.height } : {}),
        ...preset.attr,
    };
    if (type === 'text') {
        attr.x = x;
        attr.y = y + (preset.height || 32) * 0.7;  // baseline at ~70% height
    }
    const cfg = { _id: clientItemId(), type, attr };
    return cfg;
}


// ── Renderer (visual approximation in the editor) ────────────────────── //

export function renderItem(config, editing = false) {
    const a   = config.attr || {};
    const bb  = getItemBBox(config);
    const g   = svgEl('g', { 'class': 'sc-item', 'data-item-id': config._id });

    // Transparent bounding-box rect for reliable hit-testing in edit mode.
    // Without this, items with `fill: none` (solenoid, valve outlines) were
    // almost impossible to click. Inserted first so the visual layers paint
    // on top of it.
    if (editing && config.type !== 'grid') {
        const hit = svgEl('rect', {
            x: bb.x, y: (config.type === 'text') ? bb.y - bb.height : bb.y,
            width:  bb.width,
            height: bb.height,
            fill:   'transparent',
            stroke: 'none',
            'data-role': 'hitbox',
            'pointer-events': 'all',
        });
        g.appendChild(hit);
    }

    switch (config.type) {
        case 'text': {
            const t = svgText(a.text || '(text)', {
                x: parseFloat(a.x) || 0,
                y: parseFloat(a.y) || 0,
                fill: a.fill || '#222',
                'font-size': a['font-size'] || '14pt',
                'font-family': a['font-family'] || 'sans-serif',
                'font-weight': a['font-weight'] || 'normal',
            });
            g.appendChild(t);
            break;
        }
        case 'box': {
            g.appendChild(svgEl('rect', {
                x: bb.x, y: bb.y, width: bb.width, height: bb.height,
                rx: a.rx, ry: a.ry,
                fill: a.fill || 'none',
                stroke: a.stroke || '#333',
                'stroke-width': a['stroke-width'] || 1,
            }));
            if (config.metric?.channel) {
                g.appendChild(svgText(config.metric.channel, {
                    x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 + 4,
                    fill: '#888', 'font-size': '10pt', 'font-family': 'monospace',
                    'text-anchor': 'middle',
                }));
            }
            break;
        }
        case 'circle': {
            g.appendChild(svgEl('ellipse', {
                cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2,
                rx: bb.width / 2, ry: bb.height / 2,
                fill: a.fill || 'none',
                stroke: a.stroke || '#333',
                'stroke-width': a['stroke-width'] || 1,
            }));
            break;
        }
        case 'button': {
            g.appendChild(svgEl('rect', {
                x: bb.x, y: bb.y, width: bb.width, height: bb.height,
                rx: a.rx ?? 6, ry: a.ry ?? 6,
                fill: a.fill || 'none',
                stroke: a.stroke || '#333',
                'stroke-width': a['stroke-width'] || 1,
            }));
            g.appendChild(svgText(a.label || 'Button', {
                x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 + 4,
                fill: a['label-color'] || a.stroke || '#333',
                'font-size': a['font-size'] || '11pt',
                'text-anchor': 'middle',
            }));
            break;
        }
        case 'image': {
            const href = a.href ? `./api/config/file/${a.href}` : '';
            if (href) {
                g.appendChild(svgEl('image', {
                    x: bb.x, y: bb.y, width: bb.width, height: bb.height,
                    href,
                    preserveAspectRatio: 'xMidYMid meet',
                }));
            }
            if (!href) {
                g.appendChild(svgEl('rect', {
                    x: bb.x, y: bb.y, width: bb.width, height: bb.height,
                    fill: 'rgba(200,200,200,0.3)',
                    stroke: '#aaa', 'stroke-dasharray': '4 3',
                }));
                g.appendChild(svgText('(image)', {
                    x: bb.x + bb.width / 2, y: bb.y + bb.height / 2,
                    fill: '#888', 'font-size': '10pt', 'text-anchor': 'middle',
                }));
            }
            break;
        }
        case 'valve': {
            const x0 = bb.x, y0 = bb.y;
            const x1 = bb.x + bb.width, y1 = bb.y + bb.height;
            const points = (a.orientation || 'horizontal').startsWith('v')
                ? `${x0},${y0} ${x1},${y0} ${x0},${y1} ${x1},${y1} ${x0},${y0}`
                : `${x0},${y0} ${x0},${y1} ${x1},${y0} ${x1},${y1} ${x0},${y0}`;
            g.appendChild(svgEl('polyline', {
                points,
                fill: a.fill || 'none',
                stroke: a.stroke || '#333',
                'stroke-width': a['stroke-width'] || 1,
            }));
            break;
        }
        case 'solenoid': {
            const n = parseInt(a.turns || 12);
            let d = '';
            for (let i = 0; i < n; i++) {
                const sx = bb.x + i * bb.width / n;
                const sy = bb.y + bb.height;
                const ex = sx + bb.width / n;
                const ey = sy - bb.height;
                d += `M ${sx} ${sy} L ${ex} ${ey} `;
            }
            g.appendChild(svgEl('path', {
                d,
                fill: 'none',
                stroke: a.stroke || '#333',
                'stroke-width': a['stroke-width'] || 3,
            }));
            break;
        }
        case 'grid': {
            // The "grid" item is rendered by the live preview itself.
            // In the editor we show a faint hint so users can select/delete it.
            const rect = svgEl('rect', {
                x: 0, y: 0, width: '100%', height: '100%',
                fill: 'transparent', stroke: 'rgba(120,120,200,0.3)',
                'stroke-dasharray': '4 4', 'pointer-events': 'none',
            });
            g.appendChild(rect);
            g.appendChild(svgText('(grid item)', {
                x: 8, y: 18,
                fill: 'rgba(120,120,200,0.7)', 'font-size': '10pt',
            }));
            break;
        }
        default: {
            console.warn('Unknown item type:', config.type);
            return null;
        }
    }
    return g;
}


// ── Property fields shown in the side panel ──────────────────────────── //

const COMMON_GEOMETRY = [
    { key: 'attr.x',      label: 'X',       type: 'number' },
    { key: 'attr.y',      label: 'Y',       type: 'number' },
    { key: 'attr.width',  label: 'Width',   type: 'number' },
    { key: 'attr.height', label: 'Height',  type: 'number' },
];

const ACTION_FIELDS = [
    { key: 'action.open',        label: 'Open URL on click',     type: 'text',
      placeholder: 'slowplot.html?config=...' },
    { key: 'action.submit.name', label: 'Submit name (control)', type: 'text',
      placeholder: 'run, stop, ...' },
];

const METRIC_FIELDS = [
    { key: 'metric.channel',      label: 'Data channel',  type: 'text',
      placeholder: 'channel_name' },
    { key: 'metric.format',       label: 'Format',        type: 'text',
      placeholder: '%.4g' },
    { key: 'metric.active-above', label: 'Active above',  type: 'number' },
    { key: 'metric.active-below', label: 'Active below',  type: 'number' },
];

const PROPERTY_FIELDS = {
    text: [
        ...COMMON_GEOMETRY,
        { key: 'attr.text',        label: 'Text',         type: 'text' },
        { key: 'attr.fill',        label: 'Color',        type: 'color' },
        { key: 'attr.font-size',   label: 'Font size',    type: 'text', placeholder: '14pt' },
        { key: 'attr.font-weight', label: 'Font weight',  type: 'select',
          options: ['normal', 'bold'] },
        ...ACTION_FIELDS,
        ...METRIC_FIELDS,
    ],
    box: [
        ...COMMON_GEOMETRY,
        { key: 'attr.label',  label: 'Label',         type: 'text' },
        { key: 'attr.stroke', label: 'Stroke color',  type: 'color' },
        { key: 'attr.fill',   label: 'Fill color',    type: 'color' },
        { key: 'attr.rx',     label: 'Corner radius', type: 'number' },
        ...ACTION_FIELDS,
        ...METRIC_FIELDS,
    ],
    circle: [
        ...COMMON_GEOMETRY,
        { key: 'attr.label',  label: 'Label',        type: 'text' },
        { key: 'attr.stroke', label: 'Stroke color', type: 'color' },
        { key: 'attr.fill',   label: 'Fill color',   type: 'color' },
        ...ACTION_FIELDS,
        ...METRIC_FIELDS,
    ],
    button: [
        ...COMMON_GEOMETRY,
        { key: 'attr.label',  label: 'Label',        type: 'text' },
        { key: 'attr.stroke', label: 'Stroke color', type: 'color' },
        { key: 'attr.fill',   label: 'Fill color',   type: 'color' },
        { key: 'attr.rx',     label: 'Corner radius',type: 'number' },
        ...ACTION_FIELDS,
    ],
    image: [
        ...COMMON_GEOMETRY,
        { key: 'attr.href', label: 'File (in project config dir)', type: 'text',
          placeholder: 'svg-FloorPlan.svg' },
        ...ACTION_FIELDS,
    ],
    valve: [
        ...COMMON_GEOMETRY,
        { key: 'attr.orientation', label: 'Orientation', type: 'select',
          options: ['horizontal', 'vertical'] },
        { key: 'attr.stroke',      label: 'Stroke',      type: 'color' },
        ...METRIC_FIELDS,
    ],
    solenoid: [
        ...COMMON_GEOMETRY,
        { key: 'attr.turns',  label: 'Turns',  type: 'number' },
        { key: 'attr.stroke', label: 'Stroke', type: 'color' },
        ...METRIC_FIELDS,
    ],
    grid: [
        { key: 'attr.dx',     label: 'Step X',       type: 'number' },
        { key: 'attr.dy',     label: 'Step Y',       type: 'number' },
        { key: 'attr.stroke', label: 'Line color',   type: 'color' },
    ],
};

export function getPropertyFields(type) {
    return PROPERTY_FIELDS[type] || [];
}

export function getItemTypes() {
    return Object.keys(ITEM_LABELS);
}

export function getItemLabel(type) {
    return ITEM_LABELS[type] || type;
}

export function getItemChannels(config) {
    return config.metric?.channel ? [config.metric.channel] : [];
}
