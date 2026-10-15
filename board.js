/* TTU SEC block board: Miro glue (Web SDK v2). Uses the rules in logic.js.
 * Each block remembers its program area and last size in its own app metadata ("ttu"), so the app can tell a
 * resize from a move and put the area back. Requests for the adjacency score live in board app data. */
(function () {
  "use strict";
  const T = window.TTU;
  const KEY = "ttu";
  const REQ_KEY = "ttu-requests";
  const busy = new Set();

  async function getMeta(item) {
    if (!item || item.type !== "shape") return null;
    let m = null;
    try { m = await item.getMetadata(KEY); } catch (e) { m = null; }
    if (m && m.no) return m;
    const p = T.parseBlock(item.content, item.width, item.height);
    if (!p) return null;
    m = { ...p, w: item.width, h: item.height };
    try { await item.setMetadata(KEY, m); } catch (e) { /* read-only board: still usable for this session */ }
    return m;
  }

  /** If a block was resized since we last saw it, apply the area rule, fix its label and remember the new size. */
  async function enforce(item) {
    if (!item || item.type !== "shape" || busy.has(item.id)) return false;
    const m = await getMeta(item);
    if (!m) return false;
    const resized = Math.abs(item.width - m.w) > 0.5 || Math.abs(item.height - m.h) > 0.5;
    if (!resized) return false;
    busy.add(item.id);
    try {
      const n = T.resize(m, m.w, m.h, item.width, item.height);
      await apply(item, m, n.w, n.h);
      return true;
    } finally { setTimeout(() => busy.delete(item.id), 600); }
  }

  /** Set a block's size (px), keeping its top-left corner where it is, and refresh its label and memory. */
  async function apply(item, m, w, h) {
    const quarter = Math.round(((item.rotation || 0) % 180 + 180) % 180) === 90; // rotated a quarter turn
    const left = item.x - item.width / 2, top = item.y - item.height / 2;
    item.width = w; item.height = h;
    if (!quarter) { item.x = left + w / 2; item.y = top + h / 2; }
    item.content = T.labelFor(m, w, h);
    await item.sync();
    const next = { ...m, w: item.width, h: item.height };
    await item.setMetadata(KEY, next);
    return next;
  }

  async function handleItems(items) {
    for (const it of items || []) { try { await enforce(it); } catch (e) { console.warn("TTU block", e); } }
  }

  /** Background script: runs while the board is open (for everyone who has the app). */
  function startHeadless() {
    miro.board.ui.on("icon:click", async () => { await miro.board.ui.openPanel({ url: "panel.html" }); });
    try { miro.board.ui.on("experimental:items:update", (ev) => handleItems(ev.items)); } catch (e) { /* not available: polling below */ }
    // Polling the selection catches a resize even where the update event is not available.
    setInterval(async () => {
      try { const sel = await miro.board.getSelection(); if (sel.length && sel.length <= 30) await handleItems(sel); } catch (e) { /* board closing */ }
    }, 1000);
  }

  /** Floors (frames titled "... floor"), each with its plate (the purple dashed shape) and the blocks / context on it. */
  async function readFloors() {
    const frames = (await miro.board.get({ type: "frame" })).filter((f) => /floor\s*$/i.test(f.title || ""));
    const shapes = await miro.board.get({ type: "shape" });
    const floors = [];
    for (const f of frames) {
      const kids = shapes.filter((s) => s.parentId === f.id);
      const plate = kids.find((s) => String(s.style?.borderColor || "").toLowerCase() === "#8f7fee");
      floors.push({ frame: f, plate, kids });
    }
    return { floors, shapes };
  }

  async function getRequests() { try { return (await miro.board.getAppData(REQ_KEY)) || null; } catch (e) { return null; } }
  async function setRequests(r) { await miro.board.setAppData(REQ_KEY, r); }

  window.TTUBoard = { getMeta, enforce, apply, handleItems, startHeadless, readFloors, getRequests, setRequests, KEY };
})();
