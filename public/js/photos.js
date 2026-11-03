// Temporary photos: take/choose a picture, and open one with a 2-minute countdown.
// The server deletes a photo 2 minutes after its receiver first opens it (managers can save a copy first).
import { api } from './firebase.js';
import { h, fill, dialog, toast } from './ui.js';
import { compressImage } from './maps.js';

/** Ask for a photo (camera on phones). Resolves to a small JPEG data URL, or null if cancelled. */
export function pickPhoto({ camera = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    if (camera) input.setAttribute('capture', 'environment');
    let done = false;
    const finish = (v) => { if (!done) { done = true; input.remove(); resolve(v); } };
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return finish(null);
      try {
        const out = await compressImage(f, { maxSide: 1280, maxChars: 600000 });
        finish(out.image);
      } catch (e) { toast(e.message, 'error'); finish(null); }
    });
    // If the picker is closed without a photo, the page gets focus back with no file chosen.
    window.addEventListener('focus', () => setTimeout(() => { if (!input.files.length) finish(null); }, 1200), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** A small preview of a photo not sent yet, with a remove button. */
export function photoPreview(image, onRemove) {
  return h('div.photo-preview',
    h('img', { src: image, alt: 'Photo to send' }),
    h('button.btn.ghost.small', { type: 'button', onclick: onRemove }, 'Remove photo'));
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;

/** Open a temporary photo. canSave = show "Save to device" (managers). */
export function openPhoto(id, { title = 'Photo', canSave = false } = {}) {
  return dialog(title, (close) => {
    const body = h('div.sheet-body.photo-sheet', h('div.photo-loading', h('span.spinner', { 'aria-label': 'Loading photo' })));
    let timer = null;
    const stop = () => { if (timer) clearInterval(timer); };
    api('photo', { action: 'view', id }).then((p) => {
      if (p.gone) {
        fill(body, h('p.photo-gone', '🗑️ This photo has been deleted. Photos are removed 2 minutes after they are opened.'),
          h('button.btn.wide', { type: 'button', onclick: () => close(null) }, 'OK'));
        return;
      }
      const countdown = h('p.photo-countdown', p.deleteAt ? '' : 'The 2-minute timer starts when the receiver opens it.');
      const save = canSave ? h('button.btn', { type: 'button', onclick: () => {
        const a = h('a', { href: p.image, download: `tidycall-${(p.place || 'photo').replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.jpg` });
        document.body.append(a); a.click(); a.remove();
        toast('Saved to this device (check Downloads or Photos).', 'ok');
      } }, '⬇ Save to device') : null;
      fill(body,
        h('img.photo-full', { src: p.image, alt: `Photo of ${p.place || 'the area'}` }),
        h('p.hint', `${p.fromName ? `From ${p.fromName}` : ''}${p.place ? ` · ${p.place}` : ''}`),
        countdown,
        h('div.row-start', save, h('button.btn.ghost', { type: 'button', style: { marginLeft: 'auto' }, onclick: () => { stop(); close(null); } }, 'Close')));
      if (p.deleteAt) {
        const tick = () => {
          const left = Math.round((p.deleteAt - Date.now()) / 1000);
          countdown.textContent = left > 0
            ? `🗑️ Deleted in ${fmt(left)}${canSave ? '. Save it now if you want to keep it.' : ''}`
            : '🗑️ Deleted';
          if (left <= 0) {
            stop();
            api('photo', { action: 'expire', id }).catch(() => {});
            body.querySelector('.photo-full')?.classList.add('expired');
            if (save) save.disabled = true;
          }
        };
        tick(); timer = setInterval(tick, 1000);
      }
    }).catch((e) => { fill(body, h('p.form-error', e.message), h('button.btn.wide', { type: 'button', onclick: () => close(null) }, 'OK')); });
    return body;
  });
}

/** Button that opens a photo. */
export function photoButton(id, label, opts) {
  return h('button.photo-btn', { type: 'button', onclick: (e) => { e.stopPropagation(); openPhoto(id, opts); } }, label);
}
