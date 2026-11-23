/* "Segment it yourself": paint a label map over an H&E test image, then compare with the ground truth and the model.
   The label buffer is 224 x 224 (the size the model works at); the canvas is scaled up by CSS. */
(function () {
  "use strict";
  var HB = window.HB, U = window.HBUtil, M = window.HBMetrics;
  if (!HB || !U) return;
  var $ = U.$, $$ = U.$$;
  var root = $("[data-play]");
  if (!root || !HB.play.length) return;
  var N = 224, KEY = "histobanana.scoreboard.v1", TIE = 0.02;

  var el = {
    tasks: $("[data-play-tasks]", root), instruction: $("[data-play-instruction]", root), wrap: $("[data-play-wrap]", root),
    img: $("[data-play-img]", root), canvas: $("[data-play-canvas]", root), cursor: $("[data-play-cursor]", root),
    count: $("[data-play-count]", root), scale: $("[data-play-scale]", root), palette: $("[data-play-palette]", root),
    size: $("[data-play-size]", root), sizeOut: $("[data-play-sizeout]", root), opacity: $("[data-play-opacity]", root),
    undo: $("[data-play-undo]", root), redo: $("[data-play-redo]", root), fillRest: $("[data-play-fillrest]", root), fillName: $("[data-play-fillname]", root), hint: $("[data-play-hint]", root), clear: $("[data-play-clear]", root), compare: $("[data-play-compare]", root),
    result: $("[data-play-result]", root), verdict: $("[data-play-verdict]", root),
    board: $("[data-play-boardbody]", root)
  };
  var ctx = el.canvas.getContext("2d");
  var st = {
    set: null, k: 0, at: {}, user: new Uint8Array(N * N), gt: null, pr: null, history: [], future: [], path: null, tool: "brush", cls: 1, size: 8,
    locked: false, token: 0, img: ctx.createImageData(N, N), last: null, drawing: false, hover: false, scores: null
  };

  /* ---------- storage (may be unavailable: private mode, file origin policies) ---------- */
  var memory = { v: 1, results: {} };
  function loadBoard() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) { var d = JSON.parse(raw); if (d && d.v === 1 && d.results) memory = d; }
    } catch (err) { /* keep the in-memory board */ }
  }
  function saveBoard() {
    try { window.localStorage.setItem(KEY, JSON.stringify(memory)); } catch (err) { /* in-memory only */ }
  }

  /* ---------- drawing ---------- */
  function refresh(x0, y0, x1, y1) {
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(N - 1, Math.ceil(x1)); y1 = Math.min(N - 1, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return;
    var d = st.img.data, cl = st.set.classes;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var i = y * N + x, o = i * 4, v = st.user[i];
      if (v > 0 && cl[v]) { var c = cl[v].color; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
      else if (st.gt && st.gt[i] === 255 && (x + y) % 6 < 3) { d[o] = d[o + 1] = d[o + 2] = 150; d[o + 3] = 170; }
      else d[o + 3] = 0;
    }
    ctx.putImageData(st.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
  function stamp(cx, cy, r, v) {
    var x0 = Math.max(0, Math.ceil(cx - r)), x1 = Math.min(N - 1, Math.trunc(cx + r));
    var y0 = Math.max(0, Math.ceil(cy - r)), y1 = Math.min(N - 1, Math.trunc(cy + r)), r2 = r * r + 0.25;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) st.user[y * N + x] = v;
    }
  }
  function line(x0, y0, x1, y1) {
    var r = Math.max(0.5, st.size / 2), v = st.tool === "eraser" ? 0 : st.cls;
    var dist = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(dist / Math.max(0.5, r / 2)));
    for (var s = 0; s <= steps; s++) stamp(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, r, v);
    refresh(Math.min(x0, x1) - r - 1, Math.min(y0, y1) - r - 1, Math.max(x0, x1) + r + 1, Math.max(y0, y1) + r + 1);
  }
  function pushHistory() {
    st.history.push(st.user.slice());
    if (st.history.length > 40) st.history.shift();
    st.future = [];
    el.undo.disabled = false; el.redo.disabled = true;
  }
  function undo() {
    if (st.locked || !st.history.length) return;
    st.future.push(st.user);
    st.user = st.history.pop();
    el.undo.disabled = !st.history.length; el.redo.disabled = false;
    refresh(0, 0, N - 1, N - 1);
  }
  function redo() {
    if (st.locked || !st.future.length) return;
    st.history.push(st.user);
    st.user = st.future.pop();
    el.undo.disabled = false; el.redo.disabled = !st.future.length;
    refresh(0, 0, N - 1, N - 1);
  }
  /* Bucket fill: the 4-connected region of the visitor's map that has the label of the clicked pixel gets the selected
     class. Iterative scanline with an explicit stack; indices never leave the 224 x 224 buffer. Returns the pixel count. */
  function fillAt(x, y, v) {
    x = Math.round(x); y = Math.round(y);
    if (st.locked || x < 0 || y < 0 || x >= N || y >= N) return 0;
    if (v == null) v = st.tool === "eraser" ? 0 : st.cls;
    var u = st.user, from = u[y * N + x];
    if (from === v) return 0;
    pushHistory();
    var stack = [x, y], count = 0;
    while (stack.length) {
      var py = stack.pop(), px = stack.pop();
      if (u[py * N + px] !== from) continue;
      var l = px, r = px;
      while (l > 0 && u[py * N + l - 1] === from) l--;
      while (r < N - 1 && u[py * N + r + 1] === from) r++;
      for (var i = l; i <= r; i++) { u[py * N + i] = v; count++; }
      for (var dy = -1; dy <= 1; dy += 2) {
        var ny = py + dy;
        if (ny < 0 || ny >= N) continue;
        var inRun = false;
        for (i = l; i <= r; i++) {
          if (u[ny * N + i] === from) { if (!inRun) { stack.push(i, ny); inRun = true; } } else inRun = false;
        }
      }
    }
    refresh(0, 0, N - 1, N - 1);
    return count;
  }
  function fillUnpainted(v) {
    if (st.locked) return 0;
    if (v == null) v = st.cls;
    if (!v) return 0;
    pushHistory();
    var count = 0;
    for (var i = 0; i < st.user.length; i++) if (st.user[i] === 0) { st.user[i] = v; count++; }
    refresh(0, 0, N - 1, N - 1);
    return count;
  }
  /* Lasso: fill the closed outline given as [[x, y], ...] (even-odd rule, scanline per image line). */
  function fillPolygon(pts, v) {
    if (st.locked || pts.length < 3) return 0;
    if (v == null) v = st.cls;
    var count = 0;
    for (var y = 0; y < N; y++) {
      var xs = [];
      for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        var a = pts[i], b = pts[j];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(N - 1, Math.trunc(xs[k + 1]));
        for (var x = x0; x <= x1; x++) { st.user[y * N + x] = v; count++; }
      }
    }
    refresh(0, 0, N - 1, N - 1);
    return count;
  }
  function clearAll() {
    if (st.locked) return;
    pushHistory();
    st.user = new Uint8Array(N * N);
    refresh(0, 0, N - 1, N - 1);
  }
  function toLabel(e) {
    var r = el.wrap.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * N - 0.5, (e.clientY - r.top) / r.height * N - 0.5, r];
  }
  function moveCursor(e) {
    if (e.pointerType === "touch" || st.locked) { el.cursor.hidden = true; return; }
    var r = el.wrap.getBoundingClientRect(), d = Math.max(4, st.size / N * r.width);
    el.cursor.hidden = false;
    el.cursor.style.width = el.cursor.style.height = d + "px";
    el.cursor.style.transform = "translate(" + (e.clientX - r.left - d / 2) + "px," + (e.clientY - r.top - d / 2) + "px)";
  }
  el.wrap.addEventListener("pointerdown", function (e) {
    if (st.locked || !st.gt || (e.button != null && e.button > 0)) return;
    e.preventDefault();
    var p = toLabel(e);
    if (st.tool === "fill") { fillAt(p[0], p[1]); return; }
    el.wrap.setPointerCapture(e.pointerId);
    pushHistory();
    st.drawing = true;
    st.last = p;
    if (st.tool === "lasso") { st.path = [[p[0], p[1]]]; thin(p[0], p[1], p[0], p[1]); return; }
    line(p[0], p[1], p[0], p[1]);
    moveCursor(e);
  });
  el.wrap.addEventListener("pointermove", function (e) {
    moveCursor(e);
    if (!st.drawing) return;
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];
    for (var i = 0; i < evs.length; i++) {
      var p = toLabel(evs[i]);
      if (st.tool === "lasso") { st.path.push([p[0], p[1]]); thin(st.last[0], st.last[1], p[0], p[1]); }
      else line(st.last[0], st.last[1], p[0], p[1]);
      st.last = p;
    }
  });
  function thin(x0, y0, x1, y1) {                 // one-pixel outline while the lasso is drawn
    var keep = st.size, tool = st.tool; st.size = 1; st.tool = "brush";
    line(x0, y0, x1, y1);
    st.size = keep; st.tool = tool;
  }
  function endStroke() {
    if (st.drawing && st.tool === "lasso" && st.path) { fillPolygon(st.path); st.path = null; }
    st.drawing = false; st.last = null;
  }
  el.wrap.addEventListener("pointerup", endStroke);
  el.wrap.addEventListener("pointercancel", endStroke);
  el.wrap.addEventListener("pointerleave", function () { el.cursor.hidden = true; });
  el.wrap.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ---------- tools ---------- */
  function setClass(i) {
    if (!st.set.classes[i]) return;
    st.cls = i;
    if (i === 0) setTool("eraser"); else if (st.tool === "eraser") setTool("brush");
    el.fillName.textContent = i ? st.set.classes[i].name : "class"; el.fillRest.disabled = !i;
    $$(".swatch", el.palette).forEach(function (b) { var on = +b.dataset.i === i; b.classList.toggle("is-active", on); b.setAttribute("aria-checked", String(on)); });
  }
  function setTool(t) {
    st.tool = t;
    el.wrap.setAttribute("data-tool", t);
    el.hint.textContent = { brush: "Brush: drag to paint.", fill: "Fill: click a region to give it the selected class. Outline a shape with the brush first, then fill inside.", lasso: "Lasso: drag an outline and release; the inside is filled.", eraser: "Eraser: drag to remove paint." }[t] || "";
    $$("[data-tool]", root).forEach(function (b) { var on = b.dataset.tool === t; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
  }
  function setSize(v) {
    st.size = Math.max(1, Math.min(40, v));
    el.size.value = st.size; el.sizeOut.textContent = st.size;
  }
  $$("[data-tool]", root).forEach(function (b) {
    b.addEventListener("click", function () {
      setTool(b.dataset.tool);
      if (b.dataset.tool !== "eraser" && st.cls === 0) setClass(1);
    });
  });
  el.size.addEventListener("input", function () { setSize(+el.size.value); });
  el.opacity.addEventListener("input", function () { el.canvas.style.opacity = el.opacity.value / 100; });
  el.canvas.style.opacity = el.opacity.value / 100;
  el.undo.addEventListener("click", undo);
  el.redo.addEventListener("click", redo);
  el.fillRest.addEventListener("click", function () { fillUnpainted(); });
  el.clear.addEventListener("click", clearAll);

  /* ---------- rounds ---------- */
  function buildPalette() {
    el.palette.innerHTML = "";
    st.set.classes.forEach(function (c, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "swatch"; b.dataset.i = i; b.setAttribute("role", "radio");
      var sw = document.createElement("i"), name = document.createElement("span"), key = document.createElement("kbd");
      sw.style.background = U.rgb(c.color);
      name.textContent = c.name + (i === 0 ? " (erases)" : "");
      key.textContent = i < 10 ? String(i) : "";
      b.appendChild(sw); b.appendChild(name); if (i < 10) b.appendChild(key);
      b.addEventListener("click", function () { setClass(i); });
      el.palette.appendChild(b);
    });
  }
  function lock(on) {
    st.locked = on;
    el.wrap.classList.toggle("is-locked", on);
    el.compare.disabled = on;
    if (on) el.cursor.hidden = true;
  }
  function load() {
    var set = st.set, ex = set.examples[st.k], token = ++st.token;
    st.gt = st.pr = null; st.scores = null;
    st.user = new Uint8Array(N * N); st.history = []; st.future = []; el.undo.disabled = true; el.redo.disabled = true;
    lock(false);
    el.result.hidden = true;
    ctx.clearRect(0, 0, N, N);
    st.img = ctx.createImageData(N, N);
    el.img.src = ex.he;
    el.count.textContent = "Image " + (st.k + 1) + " of " + set.examples.length + " · " + set.dataset_name + " · test split";
    el.scale.textContent = set.mpp + " µm/px · " + Math.round(N * set.mpp) + " µm across";
    return Promise.all([U.loadLabel(ex.gt), U.loadLabel(ex.pr)]).then(function (m) {
      if (token !== st.token) return;
      st.gt = m[0]; st.pr = m[1];
      refresh(0, 0, N - 1, N - 1);
    });
  }
  function selectTask(id) {
    st.set = HB.sets[id];
    st.k = st.at[id] || 0;
    el.instruction.textContent = st.set.instruction;
    $$(".task-tab", el.tasks).forEach(function (t) { var on = t.dataset.id === id; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", String(on)); });
    buildPalette();
    setTool("brush"); setClass(1);
    return load();
  }
  function next() {
    st.k = (st.k + 1) % st.set.examples.length;
    st.at[st.set.id] = st.k;
    var p = load();
    el.wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return p;
  }
  function compare() {
    if (!st.gt || st.locked) return null;
    var u = M.score(st.gt, st.user), m = M.score(st.gt, st.pr), painted = false;
    for (var i = 0; i < st.user.length; i++) if (st.user[i]) { painted = true; break; }
    var lines = [["mIoU", u.miou, m.miou, true], ["Dice", u.dice, m.dice, true], ["Pixel agreement", u.acc, m.acc, true], ["Foreground Dice", u.fg, m.fg, false]];
    if (st.set.family === "nuclei") lines.push(["bPQ (connected regions)", M.bpq(st.gt, st.user, N, N), M.bpq(st.gt, st.pr, N, N), false]);
    var votes = 0, html = "";
    lines.forEach(function (l) {
      var a = l[1], b = l[2], d = (a == null ? 0 : a) - (b == null ? 0 : b), who = d > TIE ? 1 : d < -TIE ? -1 : 0;
      if (l[3]) votes += who;
      html += '<tr><th scope="row">' + l[0] + (l[3] ? "" : " <small>not in the verdict</small>") + '</th><td class="' + (who > 0 ? "is-best" : "") + '">' + (a == null ? "–" : U.fmt(a)) +
        '</td><td class="' + (who < 0 ? "is-best" : "") + '">' + (b == null ? "–" : U.fmt(b)) + '</td><td class="txt">' + (who > 0 ? "you" : who < 0 ? "model" : "level") + "</td></tr>";
    });
    st.scores = { user: u, model: m, votes: votes };
    var v;
    if (!painted) v = "You left the canvas empty. Here is what the model painted.";
    else if (votes > 0) v = "You beat the model on this one.";
    else if (votes < 0) v = "The model wins this round.";
    else v = "A draw: neither side is ahead on most metrics.";
    el.verdict.textContent = v;
    var hidden = { 0: true }, ex = st.set.examples[st.k];
    [["user", st.user], ["gt", st.gt], ["model", st.pr]].forEach(function (p) {
      var box = $('[data-mini="' + p[0] + '"]', root);
      $("img", box).src = ex.he;
      var c = $("canvas", box); c.style.opacity = 0.78;
      U.drawLabels(c, st.set.classes, p[1], null, { hidden: hidden });
    });
    $('[data-score="user"]', root).textContent = "your painting";
    $('[data-score="model"]', root).textContent = "one network evaluation";
    $("[data-play-legend]", root).innerHTML = st.set.classes.map(function (c, i) {
      return i === 0 ? "" : '<span class="legend-chip"><i style="background:' + U.rgb(c.color) + '"></i>' + c.name + "</span>";
    }).join("");
    $("[data-play-metrics]", root).innerHTML = html;
    el.result.hidden = false;
    if (window.HBSwipeHints) window.HBSwipeHints();
    lock(true);
    if (painted) { memory.results[st.set.id + ":" + st.k] = { u: u.miou, m: m.miou, w: votes > 0 ? 1 : 0 }; saveBoard(); renderBoard(); }
    el.result.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return st.scores;
  }
  function renderBoard() {
    var html = "", tot = { n: 0, w: 0, u: 0, m: 0 };
    HB.play.forEach(function (t) {
      var n = 0, w = 0, u = 0, m = 0;
      Object.keys(memory.results).forEach(function (key) {
        if (key.split(":")[0] !== t.id) return;
        var r = memory.results[key]; n++; u += r.u; m += r.m; if (r.w != null ? r.w : r.u - r.m > TIE) w++;
      });
      tot.n += n; tot.w += w; tot.u += u; tot.m += m;
      html += '<tr><th scope="row">' + t.title + "</th><td>" + n + " / " + HB.sets[t.id].examples.length + "</td><td>" + (n ? w : "–") + "</td><td>" + (n ? U.fmt(u / n) : "–") + "</td><td>" + (n ? U.fmt(m / n) : "–") + "</td></tr>";
    });
    html += '<tr class="ours"><th scope="row">All tasks</th><td>' + tot.n + "</td><td>" + (tot.n ? tot.w : "–") + "</td><td>" + (tot.n ? U.fmt(tot.u / tot.n) : "–") + "</td><td>" + (tot.n ? U.fmt(tot.m / tot.n) : "–") + "</td></tr>";
    el.board.innerHTML = html;
  }
  el.compare.addEventListener("click", compare);
  $("[data-play-next]", root).addEventListener("click", next);
  $("[data-play-next2]", root).addEventListener("click", next);
  $("[data-play-edit]", root).addEventListener("click", function () { lock(false); el.result.hidden = true; });
  $("[data-play-reset]", root).addEventListener("click", function () { memory = { v: 1, results: {} }; saveBoard(); renderBoard(); });

  /* ---------- keyboard: only while the pointer or the focus is inside the game ---------- */
  root.addEventListener("pointerenter", function () { st.hover = true; });
  root.addEventListener("pointerleave", function () { st.hover = false; });
  document.addEventListener("keydown", function (e) {
    if (!st.hover && !root.contains(document.activeElement)) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { if (e.shiftKey) redo(); else undo(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "Y")) { redo(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k >= "0" && k <= "9") { setClass(+k); e.preventDefault(); }
    else if (k === "b" || k === "B") { setTool("brush"); if (st.cls === 0) setClass(1); }
    else if (k === "e" || k === "E") setTool("eraser");
    else if (k === "f" || k === "F") { setTool("fill"); if (st.cls === 0) setClass(1); }
    else if (k === "l" || k === "L") { setTool("lasso"); if (st.cls === 0) setClass(1); }
    else if (k === "[") setSize(st.size - (st.size > 10 ? 2 : 1));
    else if (k === "]") setSize(st.size + (st.size >= 10 ? 2 : 1));
    else if (k === "n" || k === "N") next();
    else if (k === "Enter" && tag !== "BUTTON") { compare(); e.preventDefault(); }
  });

  /* ---------- start ---------- */
  HB.play.forEach(function (t) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "task-tab"; b.dataset.id = t.id; b.setAttribute("role", "tab"); b.textContent = t.title;
    b.addEventListener("click", function () { selectTask(t.id); });
    el.tasks.appendChild(b);
  });
  loadBoard();
  renderBoard();
  var ready = selectTask(HB.play[0].id);
  window.HBPlay = {
    state: st, ready: function () { return ready; }, line: line, compare: compare, next: next, setClass: setClass, setTool: setTool,
    selectTask: selectTask, undo: undo, redo: redo, fillAt: fillAt, fillUnpainted: fillUnpainted, fillPolygon: fillPolygon, board: function () { return memory; }
  };
})();
