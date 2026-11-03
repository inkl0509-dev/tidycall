// Temporary photos, stored as small JPEGs in Firestore: photos/{id}
//   { taskId, kind: 'assign' | 'decline' | 'done', image, from, fromName, place,
//     to: [uids who may see it], toManagers: bool, createdAt, viewedAt, deleteAt }
// A photo is deleted 2 minutes after its receiver first opens it, or after 24 hours if nobody opens it.
const { Timestamp } = require('./firebase');

const VIEW_SECONDS = 120;
const UNVIEWED_HOURS = 24;
const MAX_CHARS = 900000;

function checkImage(image) {
  if (image == null || image === '') return null;
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    const e = new Error('That photo could not be read. Try taking it again.'); e.status = 400; throw e;
  }
  if (image.length > MAX_CHARS) { const e = new Error('That photo is too large. Try again.'); e.status = 400; throw e; }
  return image;
}

/** Create a photo document (inside a batch/transaction if `writer` is given) and return its id. */
function addPhoto(store, writer, { image, taskId, kind, from, fromName, place, to = [], toManagers = false }) {
  const ref = store.collection('photos').doc();
  const data = {
    taskId, kind, image, from, fromName: fromName || '', place: place || '',
    to, toManagers, createdAt: Timestamp.now(), viewedAt: null, deleteAt: null,
  };
  if (writer) writer.set(ref, data); else return ref.set(data).then(() => ref.id);
  return ref.id;
}

/** Delete photos whose 2 minutes are up, and photos nobody opened within 24 hours. */
async function purgePhotos(store) {
  const now = Timestamp.now();
  const due = await store.collection('photos').where('deleteAt', '<=', now).get();
  const old = await store.collection('photos').where('createdAt', '<=', Timestamp.fromMillis(now.toMillis() - UNVIEWED_HOURS * 3600e3)).get();
  const refs = new Map();
  due.docs.filter((d) => d.data().deleteAt).forEach((d) => refs.set(d.id, d.ref));
  old.docs.forEach((d) => refs.set(d.id, d.ref));
  await Promise.all([...refs.values()].map((r) => r.delete().catch(() => {})));
  return refs.size;
}

module.exports = { VIEW_SECONDS, checkImage, addPhoto, purgePhotos };
