// In-house maps: upload a floor plan, pin places on it, show where a task is.
// A map is stored in Firestore as maps/{id}: { name, image (small JPEG as data URL), width, height, pins: [{place, x, y}] }
// x and y are 0–1 (fraction of the image width/height), so pins stay in place at any screen size.
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase.js';
import { h, dialog } from './ui.js';

const MAX_SIDE = 2000;
const MAX_CHARS = 800000; // keeps each map well under Firestore's 1 MB document limit

/** Shrink a photo/scan of the floor plan so it fits in one Firestore document. */
export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file (JPG or PNG). For a PDF plan, take a screenshot first.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    let side = Math.min(MAX_SIDE, Math.max(img.naturalWidth, img.naturalHeight));
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = side / Math.max(img.naturalWidth, img.naturalHeight);
      const w = Math.round(img.naturalWidth * scale);
      const hgt = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, hgt); // transparent PNGs get a white background
      g.drawImage(img, 0, 0, w, hgt);
      for (const q of [0.8, 0.65, 0.5]) {
        const data = c.toDataURL('image/jpeg', q);
        if (data.length <= MAX_CHARS) return { image: data, width: w, height: hgt };
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('That image is too detailed. Try a smaller picture of the plan.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const cache = new Map();
/** Load one map (cached for this session). */
export function getMap(id) {
  if (!cache.has(id)) {
    cache.set(id, getDoc(doc(db, 'maps', id)).then((d) => (d.exists() ? { id: d.id, ...d.data() } : null)).catch((e) => { cache.delete(id); throw e; }));
  }
  return cache.get(id);
}
export function putMapInCache(m) { cache.set(m.id, Promise.resolve(m)); }

/** Find the pin for a place name across all maps. */
export function findPin(maps, place) {
  if (!place) return null;
  const want = place.trim().toLowerCase();
  for (const m of maps) {
    const p = (m.pins || []).find((x) => x.place.trim().toLowerCase() === want);
    if (p) return { mapId: m.id, mapName: m.name, x: p.x, y: p.y };
  }
  return null;
}

/**
 * The map picture with pins.
 * opts.pins:   [{place, x, y}] small labelled dots
 * opts.marker: {x, y} the big "go here" pin
 * opts.selected: place name to highlight
 * opts.onTap(x, y, place|null): tap on a pin (place) or on the map (null)
 * opts.labels: 'all' shows every pin name; default shows only the selected one (floor plans usually have names printed)
 * opts.pan:    wide maps get a minimum width and scroll sideways, so pins stay big enough to tap on a phone
 */
export function mapView(map, opts = {}) {
  const img = h('img.map-img', { src: map.image, alt: `Map: ${map.name}`, draggable: false });
  const stage = h('div.map-stage', img);
  const ratio = map.width && map.height ? map.width / map.height : 1.5;
  const label = (p) => h(`button.map-pin${opts.selected && opts.selected === p.place ? '.on' : ''}`, {
    type: 'button', style: { left: `${p.x * 100}%`, top: `${p.y * 100}%` }, title: p.place, 'aria-label': p.place,
    onclick: (e) => { e.stopPropagation(); if (opts.onTap) opts.onTap(p.x, p.y, p.place); },
  }, h('span.map-pin-dot'), opts.labels === 'all' || (opts.selected && opts.selected === p.place) ? h('span.map-pin-label', p.place) : null);
  (opts.pins || []).forEach((p) => stage.append(label(p)));
  if (opts.marker) {
    stage.append(h('div.map-marker', { style: { left: `${opts.marker.x * 100}%`, top: `${opts.marker.y * 100}%` }, 'aria-hidden': 'true' },
      h('span.map-marker-pulse'), h('span.map-marker-pin', '📍')));
  }
  if (opts.onTap) {
    stage.classList.add('tappable');
    stage.addEventListener('click', (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      opts.onTap(+x.toFixed(4), +y.toFixed(4), null);
    });
  }
  if (opts.pan && ratio > 1.8) {
    stage.style.minWidth = `${Math.round(Math.min(1400, 360 * ratio))}px`;
    const pan = h('div.map-pan', stage);
    // Start scrolled to the selected spot.
    const focus = opts.marker || (opts.pins || []).find((p) => p.place === opts.selected);
    if (focus) setTimeout(() => { pan.scrollLeft = focus.x * pan.scrollWidth - pan.clientWidth / 2; }, 30);
    return pan;
  }
  return stage;
}

/** Read a TidyCall map file (.json with the image and pins already set). */
export async function readMapPack(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('That file is not a TidyCall map file.'); }
  if (!data || typeof data.image !== 'string' || !data.image.startsWith('data:image/')) throw new Error('That file has no map picture in it.');
  if (data.image.length > 900000) throw new Error('The map picture in that file is too large.');
  const pins = (Array.isArray(data.pins) ? data.pins : [])
    .filter((p) => p && typeof p.place === 'string' && p.place.trim() && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    .map((p) => ({ place: p.place.trim().slice(0, 80), x: +p.x, y: +p.y }));
  return { name: String(data.name || 'Map').slice(0, 40), image: data.image, width: +data.width || 0, height: +data.height || 0, pins };
}

/** A small crop of the map centred on the pin, used on task cards. Tap opens the full map. */
export function mapThumb(map, point, title) {
  return h('button.map-thumb', { type: 'button', 'aria-label': `Show ${title} on the map`, onclick: () => showOnMap(map, point, title) },
    // The image is moved so the pin's spot sits in the middle of the box (translate % = % of the image itself).
    h('img.map-thumb-img', { src: map.image, alt: '', draggable: false, style: { transform: `translate(${-point.x * 100}%, ${-point.y * 100}%)` } }),
    h('span.map-thumb-pin', { 'aria-hidden': 'true' }, '📍'),
    h('span.map-thumb-label', `Tap for map · ${map.name}`));
}

/** Full-screen map with the pin, zoom buttons, and scroll to the pin. */
export function showOnMap(map, point, title) {
  return dialog(title || map.name, (close) => {
    let zoom = 1;
    const view = mapView(map, { marker: point });
    const scroller = h('div.map-scroller', view);
    const setZoom = (z) => {
      zoom = Math.min(4, Math.max(1, z));
      view.style.width = `${zoom * 100}%`;
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
      requestAnimationFrame(() => {
        scroller.scrollLeft = point.x * scroller.scrollWidth - scroller.clientWidth / 2;
        scroller.scrollTop = point.y * scroller.scrollHeight - scroller.clientHeight / 2;
      });
    };
    const zoomLabel = h('span.zoom-label', '100%');
    const body = h('div.sheet-body.map-sheet',
      h('p.hint', map.name),
      scroller,
      h('div.row-start',
        h('button.btn.ghost.small', { type: 'button', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.5) }, '−'),
        zoomLabel,
        h('button.btn.ghost.small', { type: 'button', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.5) }, '+'),
        h('button.btn.small', { type: 'button', style: { marginLeft: 'auto' }, onclick: () => close(true) }, 'Close')));
    // Start zoomed so the map fills the window's height (wide plans need more zoom on a phone).
    setTimeout(() => {
      const ratio = map.width && map.height ? map.width / map.height : 1.5;
      const fit = (window.innerHeight * 0.6) / ((scroller.clientWidth || 360) / ratio);
      setZoom(Math.min(4, Math.max(1.5, fit)));
    }, 60);
    return body;
  });
}
