// QA only: in-memory Realtime-Database stand-in with the same API surface the app uses (ref/onValue/set/update/push/remove).
import { seed } from "./seed";
const mk = () => ({ "3dbee": seed(Date.now()) });
const root = { v: mk() };
const subs = [];
const parts = p => String(p).split("/").filter(Boolean);
const get = p => parts(p).reduce((a, k) => (a == null ? null : a[k] ?? null), root.v);
const put = (p, val) => {
  const ks = parts(p); if (!ks.length) { root.v = val; return; }
  let o = root.v; ks.slice(0, -1).forEach(k => { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; });
  if (val === null || val === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = val;
};
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const notify = () => subs.forEach(s => s.cb({ val: () => clone(get(s.path)) }));
if (typeof window !== "undefined") window.__qa = { read: p => clone(get(p)), write: (p, v) => { put(p, v); notify(); }, reset: () => { root.v = mk(); notify(); }, log: [] };
export const getDatabase = () => ({});
export const ref = (_db, path) => ({ path });
export const onValue = (r, cb, err) => {
  const s = { path: r.path, cb };
  if (r.path === ".info/connected") { setTimeout(() => cb({ val: () => true }), 0); return () => {}; }
  subs.push(s); setTimeout(() => cb({ val: () => clone(get(r.path)) }), 0);
  return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
};
export const set = async (r, v) => { put(r.path, clone(v)); window.__qa?.log.push(["set", r.path]); notify(); };
export const update = async (r, patch) => { Object.entries(patch).forEach(([k, v]) => put(`${r.path}/${k}`, clone(v))); window.__qa?.log.push(["update", r.path, Object.keys(patch)]); notify(); };
// like Firebase: push(ref) returns a reference immediately; push(ref, value) also writes and is awaitable
export const push = (r, v) => {
  const key = "-qa" + Math.random().toString(36).slice(2, 10), path = `${r.path}/${key}`, out = { path, key };
  if (v !== undefined) { put(path, clone(v)); notify(); out.then = (res, rej) => Promise.resolve({ path, key }).then(res, rej); }
  return out;
};
export const remove = async r => { put(r.path, null); notify(); };
