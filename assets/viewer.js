// Run/model browser with a depth slider. Used on results/ and models/.
// Reads the JSON index written by scripts/build_index.py; nothing here needs editing to add runs.
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const RUN_FIELDS = [
    ["data", "Data"],
    ["cables", "DAS cables"],
    ["weighting", "Weighting"],
    ["radius_km", "Weighting radius", (v) => v + " km"],
    ["checker_km", "Checker size", (v) => v + " km"],
    ["anomaly_pct", "Anomaly", (v) => "±" + v + "%"],
    ["start_model", "Starting model", (v) => `<a href="../models/#${esc(v)}">${esc(v)}</a>`],
    ["picks", "Picks"],
    ["smoothing_km", "Smoothing", (v) => v + " km"],
    ["iterations", "Iterations"],
    ["date", "Date", (v) => (v ? esc(v) : "Not recorded")],
    ["source", "Source"],
  ];
  const MODEL_FIELDS = [["kind", "Kind"], ["field", "Field"], ["units", "Units"], ["source", "Source"]];

  function fmt(v) { return Array.isArray(v) ? v.join(", ") : v; }

  function chartSVG(metrics, depths, cur) {
    // One small line per metric vs depth, with the current depth marked.
    const names = Object.keys(metrics);
    const W = 360, H = 150, L = 34, R = 10, T = 12, B = 26;
    const xs = depths.map(Number);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let lo = Infinity, hi = -Infinity;
    names.forEach((n) => Object.values(metrics[n]).forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    lo = Math.min(0, lo); hi = Math.max(1, hi);
    const X = (d) => L + ((d - x0) / (x1 - x0 || 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    const colors = ["var(--ak-slow)", "var(--ak-fast)", "var(--ak-ok)", "var(--ak-warn)"];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Metrics by depth" style="width:100%;max-width:${W}px;height:auto">`;
    [lo, (lo + hi) / 2, hi].forEach((v) => {
      s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--ak-line)" />`;
      s += `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--ak-muted)">${+v.toFixed(2)}</text>`;
    });
    [x0, x1].forEach((d) => (s += `<text x="${X(d)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ak-muted)">${d} km</text>`));
    s += `<line x1="${X(cur)}" x2="${X(cur)}" y1="${T}" y2="${H - B}" stroke="var(--ak-muted)" stroke-dasharray="3 3" />`;
    names.forEach((n, i) => {
      const pts = Object.entries(metrics[n]).map(([d, v]) => [Number(d), v]).sort((a, b) => a[0] - b[0]);
      s += `<polyline fill="none" stroke="${colors[i % 4]}" stroke-width="2" points="${pts.map(([d, v]) => `${X(d)},${Y(v)}`).join(" ")}" />`;
      const here = metrics[n][String(cur)];
      if (here != null) s += `<circle cx="${X(cur)}" cy="${Y(here)}" r="4" fill="${colors[i % 4]}" />`;
    });
    s += "</svg>";
    const legend = names.map((n, i) => {
      const v = metrics[n][String(cur)];
      return `<span><i style="background:${colors[i % 4]}"></i>${esc(n)} <b>${v != null ? v.toFixed(3) : "–"}</b></span>`;
    }).join("");
    return `<div class="akv-metrics"><div class="akv-legend">${legend}</div>${s}</div>`;
  }

  function mount(el) {
    const mode = el.dataset.mode || "run";
    const isRun = mode === "run";
    const state = { items: [], filter: "All", cur: null, cmp: "", depth: null, playing: null };

    const filters = isRun
      ? [
          ["All", () => true],
          ["DAS only", (r) => r.data === "DAS only"],
          ["DAS + BB", (r) => r.data === "DAS + BB"],
          ["BB only", (r) => r.data === "BB only"],
          ["1D start", (r) => r.start_model === "alaska-1d"],
          ["3D start", (r) => r.start_model === "alaska-3d"],
          ["Details to confirm", (r) => r.confirm],
        ]
      : [["All", () => true]];

    el.innerHTML = `<div class="akv">
      <div class="akv-side">
        ${isRun ? `<div class="akv-filters" role="group" aria-label="Filter runs"></div>` : ""}
        <div class="akv-list" role="listbox" aria-label="${isRun ? "Runs" : "Models"}"></div>
      </div>
      <section class="akv-detail" aria-live="polite"></section>
    </div>`;
    const $f = el.querySelector(".akv-filters"), $l = el.querySelector(".akv-list"), $d = el.querySelector(".akv-detail");

    const byId = (id) => state.items.find((x) => x.id === id);
    const pills = (r) =>
      (r.status === "planned" ? '<span class="pill next">Planned</span>' : isRun ? '<span class="pill done">Run</span>' : "") +
      (r.confirm ? ' <span class="pill confirm">Details to confirm</span>' : "") +
      (r.warning ? ' <span class="pill invalid">Invalid results</span>' : "");

    function renderFilters() {
      if (!$f) return;
      $f.innerHTML = filters.map(([n]) => `<button class="akv-chip" aria-pressed="${n === state.filter}">${n}</button>`).join("");
      $f.querySelectorAll("button").forEach((b, i) => (b.onclick = () => { state.filter = filters[i][0]; renderFilters(); renderList(); }));
    }

    function renderList() {
      const test = filters.find(([n]) => n === state.filter)[1];
      const list = state.items.filter(test);
      $l.innerHTML = list.length
        ? list.map((r) => `<button class="akv-item" role="option" aria-selected="${r.id === state.cur}" data-id="${esc(r.id)}">
            <span class="akv-item-top"><span class="akv-item-title">${esc(r.title || r.id)}</span></span>
            <span class="akv-item-meta">${esc([isRun ? r.date || "Date not recorded" : null, r.data, r.checker_km ? r.checker_km + " km" : null, r.kind].filter(Boolean).join(" · "))}</span>
            <span class="akv-item-meta">${r.depths.length ? r.depths.length + " depth" + (r.depths.length > 1 ? "s" : "") : "No slices yet"}${r.confirm ? " · <em>to confirm</em>" : ""}${r.warning ? ' · <strong class="akv-bad">invalid</strong>' : ""}</span>
          </button>`).join("")
        : `<p class="akv-empty-note">No runs match this filter.</p>`;
      $l.querySelectorAll(".akv-item").forEach((b) => (b.onclick = () => select(b.dataset.id)));
    }

    function select(id) {
      state.cur = id;
      const r = byId(id);
      if (!r.depths.includes(state.depth)) state.depth = r.depths.includes(20) ? 20 : r.depths[0] ?? null;
      if (state.cmp === id) state.cmp = "";
      try { history.replaceState(null, "", "#" + id); } catch (e) {}
      renderList();
      renderDetail();
      preload(r);
    }

    function preload(r) {
      Object.values(r.slices).concat(Object.values(r.true || {})).forEach((src) => { const i = new Image(); i.src = src; });
    }

    function slicePanels(r) {
      const d = String(state.depth);
      const panels = [];
      if (isRun) {
        // Prefer the true pattern at this depth; otherwise a depth-less one; otherwise the nearest depth we have.
        let t = r.true && r.true[d], cap = `True pattern at ${d} km`;
        if (!t && r.true_any) { t = r.true_any; cap = "True pattern"; }
        if (!t && r.true && Object.keys(r.true).length) {
          const near = Object.keys(r.true).map(Number).sort((a, b) => Math.abs(a - state.depth) - Math.abs(b - state.depth))[0];
          t = r.true[String(near)]; cap = `True pattern at ${near} km`;
        }
        panels.push(t ? [t, cap] : [null, "True pattern not added"]);
      }
      panels.push(r.slices[d] ? [r.slices[d], `${isRun ? "Recovered" : esc(r.title)} at ${d} km`] : [null, `No slice at ${d} km`]);
      if (state.cmp) {
        const c = byId(state.cmp);
        panels.push(c.slices[d] ? [c.slices[d], `${esc(c.title)} at ${d} km`] : [null, `${esc(c.title)}: no slice at ${d} km`]);
      }
      return panels.map(([src, cap]) => `<figure class="akv-fig">${src
        ? `<a href="${src}" class="akv-zoom" data-caption="${esc(cap)}"><img src="${src}" alt="${esc(cap)}"></a>`
        : `<div class="akv-missing">${esc(cap)}</div>`}<figcaption>${cap}</figcaption></figure>`).join("");
    }

    function renderSlices() {
      const r = byId(state.cur);
      const box = $d.querySelector(".akv-slices");
      if (!box) return;
      box.innerHTML = slicePanels(r);
      box.style.setProperty("--cols", box.children.length);
      const lab = $d.querySelector(".akv-depth-val");
      if (lab) lab.textContent = state.depth + " km";
      const m = $d.querySelector(".akv-metrics-wrap");
      if (m && r.metrics) m.innerHTML = chartSVG(r.metrics, r.depths, state.depth);
    }

    function renderDetail() {
      const r = byId(state.cur);
      const fields = (isRun ? RUN_FIELDS : MODEL_FIELDS).filter(([k]) => (isRun && k === "date") || (r[k] != null && r[k] !== ""));
      const others = state.items.filter((x) => x.id !== r.id && x.depths.length);
      let h = `<header class="akv-head">
        <div><h2 id="${esc(r.id)}">${esc(r.title || r.id)}</h2><div class="akv-pills">${pills(r)}</div></div>
      </header>`;
      if (r.warning) h += `<div class="akv-warning" role="note"><b>Results not valid.</b> ${esc(r.warning).replace(/^These results are invalid\.\s*/, "")}</div>`;
      if (r.description) h += `<p class="akv-notes">${esc(r.description)}</p>`;

      if (r.depths.length) {
        const i = r.depths.indexOf(state.depth);
        h += `<div class="akv-scrub">
          <div class="akv-scrub-row">
            <button class="akv-play" aria-label="Play through depths">${state.playing ? "❚❚" : "▶"}</button>
            <label class="akv-depth-label" for="akv-depth-${mode}">Depth <b class="akv-depth-val">${state.depth} km</b></label>
            <input id="akv-depth-${mode}" type="range" min="0" max="${r.depths.length - 1}" step="1" value="${i}" ${r.depths.length < 2 ? "disabled" : ""}>
            ${others.length ? `<label class="akv-cmp">Compare with <select id="akv-cmp-${mode}"><option value="">none</option>${others.map((o) => `<option value="${esc(o.id)}" ${o.id === state.cmp ? "selected" : ""}>${esc(o.title || o.id)}</option>`).join("")}</select></label>` : ""}
          </div>
        </div>
        <div class="akv-slices"></div>`;
        if (r.metrics) h += `<div class="akv-metrics-wrap"></div>`;
      } else {
        h += `<div class="akv-missing akv-missing-lg">No depth slices in this folder yet. Add files named like <code>z020km.png</code>.</div>`;
      }

      if (fields.length || r.notes) {
        h += `<div class="akv-meta"><table class="akv-params"><tbody>${fields.map(([k, label, f]) => `<tr><th>${label}</th><td>${f ? f(r[k]) : esc(fmt(r[k]))}</td></tr>`).join("")}</tbody></table>
          ${r.notes ? `<div class="akv-notes">${esc(r.notes).replace(/\n\n/g, "<br><br>")}</div>` : ""}</div>`;
      }
      if (r.other && r.other.length) {
        h += `<h3>Other figures</h3><div class="akv-other">${r.other.map((o) => `<figure class="akv-fig"><a href="${o.src}" class="akv-zoom" data-caption="${esc(o.caption)}"><img src="${o.src}" alt="${esc(o.caption)}" loading="lazy"></a><figcaption>${esc(o.caption)}</figcaption></figure>`).join("")}</div>`;
      }
      $d.innerHTML = h;
      renderSlices();

      const range = $d.querySelector("input[type=range]");
      const setDepth = (d) => {
        state.depth = d;
        if (range) range.value = r.depths.indexOf(d);
        renderSlices();
      };
      if (range) {
        range.oninput = () => setDepth(r.depths[Number(range.value)]);
        const play = $d.querySelector(".akv-play");
        play.onclick = () => {
          if (state.playing) { clearInterval(state.playing); state.playing = null; play.textContent = "▶"; return; }
          play.textContent = "❚❚";
          state.playing = setInterval(() => {
            const j = (r.depths.indexOf(state.depth) + 1) % r.depths.length;
            setDepth(r.depths[j]);
          }, 700);
        };
        const cmp = $d.querySelector("select");
        if (cmp) cmp.onchange = () => { state.cmp = cmp.value; if (state.cmp) preload(byId(state.cmp)); renderSlices(); };
      }
    }

    fetch(el.dataset.src)
      .then((res) => res.json())
      .then((items) => {
        state.items = items;
        if (!items.length) { $d.innerHTML = `<div class="akv-missing akv-missing-lg">Nothing here yet.</div>`; return; }
        renderFilters();
        const want = decodeURIComponent(location.hash.slice(1));
        if (el.dataset.compare && !want) state.cmp = el.dataset.compare;
        select(byId(want) ? want : el.dataset.start && byId(el.dataset.start) ? el.dataset.start : items[0].id);
        if (state.cmp === state.cur) state.cmp = "";
        renderDetail();
      })
      .catch(() => { $d.innerHTML = `<div class="akv-missing akv-missing-lg">Could not load ${esc(el.dataset.src)}. Preview the site with <code>quarto preview</code> rather than opening the HTML file directly.</div>`; });

    document.addEventListener("keydown", (e) => {
      if (!state.cur || document.querySelector(".akv-overlay") || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      const r = byId(state.cur), j = r.depths.indexOf(state.depth);
      if (e.key === "ArrowRight" && j < r.depths.length - 1) { state.depth = r.depths[j + 1]; renderDetail(); }
      if (e.key === "ArrowLeft" && j > 0) { state.depth = r.depths[j - 1]; renderDetail(); }
    });
  }

  // Image viewer overlay: opens a figure over a dimmed page; close with ×, Esc, or a click outside.
  function zoom(src, caption) {
    const box = document.createElement("div");
    box.className = "akv-overlay";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = `<button class="akv-close" aria-label="Close">×</button>
      <figure><img src="${esc(src)}" alt="${esc(caption)}"><figcaption>${caption || ""}</figcaption></figure>`;
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey, true); document.body.style.overflow = ""; };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    box.addEventListener("click", (e) => { if (e.target === box || e.target.classList.contains("akv-close")) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    document.body.appendChild(box);
    box.querySelector(".akv-close").focus();
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.akv-zoom");
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    zoom(a.getAttribute("href"), a.dataset.caption);
  });

  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("[data-akviewer]").forEach(mount));
})();
