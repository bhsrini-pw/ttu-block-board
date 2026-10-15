/* TTU SEC block board: the rules, with no Miro calls, so they can be tested on their own.
 * Board scale: 1 ft = 5 px (the board was built at this scale by tools/miro_board.py). */
(function (root) {
  "use strict";
  const PX = 5; // pixels per foot
  const HALF_FT = PX / 2; // sides snap to half a foot

  const fmt = (v, d = 1) => {
    const s = (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: d });
    return s;
  };
  const snapPx = (v) => Math.round(v / HALF_FT) * HALF_FT;
  const strip = (html) => String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** Reads a block shape made by the board builder: "<space no>-<n> / <name> / <L>' × <B>' · <area> sf" (name and area may be missing on small blocks). */
  function parseBlock(content, w, h) {
    const lines = strip(content).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const m = lines[0].match(/^((?:OS |SC )?\d\.\d{3})(?:-(\d+))?$/);
    if (!m) return null;
    const areaLine = lines.find((l) => /\bsf\b/.test(l));
    const am = areaLine && areaLine.match(/([\d,]+(?:\.\d+)?)\s*sf/);
    const nsf = am ? parseFloat(am[1].replace(/,/g, "")) : Math.round(((w * h) / (PX * PX)) * 2) / 2;
    const name = lines.length >= 3 ? lines[1] : lines.length === 2 && !/['′]/.test(lines[1]) ? lines[1] : "";
    return { tag: lines[0], no: m[1], name, nsf, locked: true };
  }

  /** The label a block shows at a given size (px). Smaller blocks show less, as on the board builder. */
  function labelFor(meta, w, h) {
    const L = w / PX, B = h / PX, A = L * B, small = Math.min(w, h);
    const diff = A - meta.nsf;
    const dims = `${fmt(L)}' × ${fmt(B)}'`;
    const area = `${fmt(A)} sf${Math.abs(diff) >= 0.5 ? ` (${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))})` : ""}`;
    if (small >= 70 && w >= 160 && meta.name) return `<p><b>${esc(meta.tag)}</b></p><p>${esc(meta.name)}</p><p>${dims} · ${area}</p>`;
    if (small >= 40 && w >= 70) return `<p><b>${esc(meta.tag)}</b></p><p>${dims}</p>`;
    return `<p><b>${esc(meta.no)}</b></p>`;
  }

  /**
   * A block was resized from (w0, h0) to (w, h). With the area locked, the side that moved most keeps its new length
   * (snapped to half a foot) and the other side follows; a corner drag (both sides, same proportion) scales back to the
   * area. Returns the corrected size. Unlocked, the new size stands (snapped) and the area follows.
   */
  function resize(meta, w0, h0, w, h) {
    const min = 2 * PX;
    if (!meta.locked) return { w: Math.max(min, snapPx(w)), h: Math.max(min, snapPx(h)) };
    const A = meta.nsf * PX * PX;
    const dw = Math.abs(w - w0) / w0, dh = Math.abs(h - h0) / h0;
    const proportional = dw > 0.005 && dh > 0.005 && Math.abs(w / h - w0 / h0) / (w0 / h0) < 0.03;
    if (proportional) { const r = w / h, nw = Math.sqrt(A * r); return { w: nw, h: A / nw }; }
    if (dw >= dh) { const nw = Math.max(min, snapPx(w)); return { w: nw, h: A / nw }; }
    const nh = Math.max(min, snapPx(h)); return { w: A / nh, h: nh };
  }

  /** Space number → unit (a row of the adjacency matrix). The table comes with the loaded requests, so no program data lives in this code. */
  const unitFor = (no, req) => (req && req.spaceUnits && req.spaceUnits[no]) || "other";
  const CONTEXT_NAMES = { "stadium / concourse": "stadium", "service drive": "service", "main campus entry": "entry" };
  const contextUnit = (content) => CONTEXT_NAMES[strip(content).trim().toLowerCase()] || null;

  /** From a project file saved by the adjacency tool: unit names, the level per pair (agreed, else a clear majority), distances. */
  function requestsFromProject(project) {
    const units = (project.units || []).map((u) => ({ id: u.id, name: u.name }));
    const levels = {};
    const keys = new Set([...Object.keys(project.votes || {}), ...Object.keys(project.agreed || {})]);
    for (const k of keys) {
      const ag = project.agreed?.[k]?.level;
      if (ag) { levels[k] = ag; continue; }
      const counts = {};
      for (const v of Object.values(project.votes?.[k] || {})) if (v?.level) counts[v.level] = (counts[v.level] || 0) + 1;
      const best = Math.max(0, ...Object.values(counts));
      const tops = Object.keys(counts).filter((l) => counts[l] === best);
      if (best && tops.length === 1) levels[k] = tops[0];
    }
    const st = project.settings || {};
    const spaceUnits = { ...(project.spaceUnits || {}), ...(project.unitOf || {}) }; // saved by the tool's "Save project"
    return { units, levels, spaceUnits, dDirect: st.dDirect ?? 10, dIdeal: st.dIdeal ?? 60, dAvoid: st.dAvoid ?? 20, loadedAt: new Date().toISOString() };
  }

  const gap = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));
  const overlap = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0; };

  /**
   * Scores an arrangement. rects: [{unit, floor, x, y, w, h}] in feet, measured from each floor's plate corner, so
   * blocks on different floors can be compared for stacking. Context rects carry floor "*" semantics per floor (they
   * are listed per floor). Same rules as the adjacency tool: Direct ×3, Ideal ×2, Keep apart ×3, Low not scored.
   */
  function score(req, rects) {
    const W = { D: 3, I: 2, L: 0, X: 3 };
    const by = {};
    for (const r of rects) (by[r.unit] ||= []).push(r);
    const pairs = [];
    let num = 0, den = 0;
    for (const [k, level] of Object.entries(req.levels)) {
      const [a, b] = k.split("|");
      const RA = by[a] || [], RB = by[b] || [];
      let status = "open", best = Infinity, stacked = false;
      if (RA.length && RB.length) {
        for (const p of RA) for (const q of RB) {
          if (p.floor === q.floor) best = Math.min(best, gap(p, q));
          else if (!p.context && !q.context && overlap(p, q) > 25) stacked = true;
        }
        if (level === "D") status = best <= req.dDirect ? "met" : stacked ? "partial" : "unmet";
        else if (level === "I") status = best <= req.dIdeal || stacked ? "met" : "unmet";
        else if (level === "L") status = best <= req.dIdeal || stacked ? "met" : "far";
        else status = best <= req.dAvoid ? "conflict" : "met";
      }
      const v = { met: 1, partial: 0.5 }[status] || 0;
      if (W[level]) { den += W[level]; num += W[level] * v; }
      pairs.push({ a, b, level, status, gap: best === Infinity ? null : best });
    }
    return { score: den ? num / den : null, pairs };
  }

  const api = { PX, fmt, strip, parseBlock, labelFor, resize, unitFor, contextUnit, requestsFromProject, score, snapPx };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TTU = api;
})(typeof window !== "undefined" ? window : globalThis);
