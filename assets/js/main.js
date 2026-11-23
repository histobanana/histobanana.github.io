/* HistoBanana project page: teaser, generation gallery, region viewer, task explorer. Plain JS, no dependencies. */
(function () {
  "use strict";
  var HB = window.HB;
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var UNLABELLED = [150, 150, 150];

  /* ---------- shared helpers (also used by paint.js) ---------- */
  var labelCache = {};
  function loadLabel(url) {
    if (!labelCache[url]) {
      labelCache[url] = new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () {
          var c = document.createElement("canvas");
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          var ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(im, 0, 0);
          var d = ctx.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height);
          for (var i = 0; i < out.length; i++) out[i] = d[i * 4];
          resolve(out);
        };
        im.onerror = reject;
        im.src = url;
      });
    }
    return labelCache[url];
  }
  /* Paint label maps into a 224 px canvas. opts: split (0..1; left of it = a, right = b), hidden {classIndex: true},
     solid (draw class 0 too, as the model paints it). */
  function drawLabels(canvas, classes, a, b, opts) {
    opts = opts || {};
    var w = canvas.width, h = canvas.height, ctx = canvas.getContext("2d");
    var img = ctx.createImageData(w, h), d = img.data, cut = b ? Math.round((opts.split == null ? 1 : opts.split) * w) : w;
    var hidden = opts.hidden || {};
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, v = (x < cut ? a : b)[i], o = i * 4;
        if (v === 255) {
          if ((x + y) % 6 < 3) { d[o] = UNLABELLED[0]; d[o + 1] = UNLABELLED[1]; d[o + 2] = UNLABELLED[2]; d[o + 3] = 200; }
          continue;
        }
        if (hidden[v] || !classes[v]) continue;
        var col = classes[v].color;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function sprite(url, cols, nr, idx) {
    var el = document.createElement("div");
    el.className = "sprite";
    el.style.backgroundImage = 'url("' + url + '")';
    el.style.backgroundSize = cols * 100 + "% " + nr * 100 + "%";
    var cx = idx % cols, cy = (idx - cx) / cols;
    el.style.backgroundPosition = (cols > 1 ? cx / (cols - 1) * 100 : 0) + "% " + (nr > 1 ? cy / (nr - 1) * 100 : 0) + "%";
    return el;
  }
  function fmt(v) { return v.toFixed(2); }
  function rgb(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }
  window.HBUtil = { loadLabel: loadLabel, drawLabels: drawLabels, fmt: fmt, rgb: rgb, $: $, $$: $$ };

  /* ---------- teaser ---------- */
  function initTeaser() {
    var root = $("[data-teaser]");
    if (!root) return;
    var running = !reduceMotion, visible = true, timers = [];
    var later = function (fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; };

    // tile 1: one conditioning input changes at a time. Each state: text is typed, the images appear, then a dwell.
    var tText = $("[data-tt-text]", root), tSamples = $("[data-tt-samples]", root), tCtl = $("[data-tt-control]", root), tAdd = $("[data-tt-add]", root);
    var steps = [["organs", "H&E, FFPE, [organ]. 0.5 µm per pixel.", [0, 1, 4, 6], "the organ changes"], ["diagnoses", "H&E, FFPE, skin, [diagnosis]. 0.5 µm per pixel.", [0, 1, 2, 3], "the diagnosis changes"],
                 ["scale", "H&E, FFPE, skin. [scale] per pixel.", [7, 9, 11, 13], "the scale changes, 0.25 to 16 µm/px"], ["prep", "H&E, [preparation], [organ]. 0.5 µm per pixel.", [0, 1, 2, 3], "the preparation changes"],
                 ["notes", "", "note", "a slide note is added"], ["fields", "", "fields", "pathology fields are added (a subtle effect)"], ["captions", "", "caption", "a patch caption is added"], ["context", "given: the surrounding tissue of a window", [], "the window continues its surroundings"]];
    var TYPE = 60, DWELL = 7000, pi = 0;
    function tileOf(el, cap) { var box = document.createElement("div"), c = document.createElement("div"); c.className = "cap"; c.textContent = cap; box.appendChild(el); box.appendChild(c); tSamples.appendChild(box); return el; }
    function showPrompt(instant, only) {
      var st = steps[(only != null ? only : pi) % steps.length], ctl = HB.controls[st[0]]; if (only == null) pi++;
      tSamples.innerHTML = ""; tAdd.textContent = ""; tAdd.hidden = true;
      tSamples.className = "tt-samples" + (typeof st[2] === "string" ? (ctl.best.seeds.length === 1 ? " is-one" : " is-two") : "");
      tCtl.textContent = "one network evaluation; " + st[3];
      var tiles = [], txt = st[1], add = "";
      if (st[0] === "context") {
        ctl.items.forEach(function (it, k) {
          ["before", "after"].forEach(function (q) {
            var w = document.createElement("div"); w.className = "sprite ctx"; w.style.backgroundImage = 'url("assets/gen/controls/context_' + q + it.suffix + '.webp")'; w.style.backgroundSize = "cover";
            var o = document.createElement("i"); o.style.left = it.box[1] * 100 + "%"; o.style.top = it.box[0] * 100 + "%"; o.style.width = o.style.height = it.box[2] * 100 + "%"; w.appendChild(o);
            tiles.push(tileOf(w, q + " " + (k + 1)));
          });
        });
      } else if (typeof st[2] === "string") {          // notes, fields, captions: the same two seeds without and with the extra text
        var bst = ctl.best, ln = ctl.lines[2 * bst.example];
        txt = ln.intro; add = "+ " + st[2] + ": " + (ln.note.length > 96 ? ln.note.slice(0, ln.note.lastIndexOf(" ", 96)) + " …" : ln.note);
        [[1, "without"], [0, "with " + st[2]]].forEach(function (q) {
          bst.seeds.forEach(function (j) { tiles.push(tileOf(sprite("assets/gen/controls/" + st[0] + ".webp", ctl.cols, ctl.n, (2 * bst.example + q[0]) * ctl.cols + j), q[1])); });
        });
      } else {
        st[2].forEach(function (line) {
          tiles.push(tileOf(sprite("assets/gen/controls/" + st[0] + ".webp", ctl.cols, ctl.n, line * ctl.cols + (ctl.lines[line].lead || 0)), (st[0] === "scale" ? ctl.lines[line].label.split(" · ")[1] : ctl.lines[line].label.replace(/^skin: /, ""))));
        });
      }
      var n = 0;
      function reveal() { if (add) { tAdd.hidden = false; tAdd.textContent = add; } tiles.forEach(function (t, k) { later(function () { t.classList.add("is-in"); }, instant ? 0 : 320 * k); }); }
      if (instant) { tText.textContent = txt; reveal(); return; }
      tText.textContent = "";
      (function type() {
        if (!running || !visible) { later(type, 300); return; }
        n = Math.min(txt.length, n + 2);
        tText.textContent = txt.slice(0, n);
        if (n < txt.length) later(type, TYPE); else { later(reveal, 500); later(function () { showPrompt(false); }, DWELL); }
      })();
    }
    showPrompt(reduceMotion);
    window.HBTeaser = { states: steps.length, show: function (i) { timers.forEach(clearTimeout); running = false; showPrompt(true, i); }, timing: { type_ms_per_2_chars: TYPE, dwell_ms: DWELL } };

    // tile 4: report summary -> generated region
    var reports = HB.regions.filter(function (r) { return r.report; }), ri = 0;
    var rText = $("[data-tr-text]", root), rFull = $("[data-tr-full]", root), rDet = $("[data-tr-detail]", root);
    function showReport() {
      if (!reports.length) return;
      if (!running || !visible) { later(showReport, 400); return; }
      var r = reports[ri % reports.length]; ri++;
      rFull.classList.remove("is-in"); rDet.classList.remove("is-in");
      rText.textContent = "“" + (r.report.length > 150 ? r.report.slice(0, r.report.lastIndexOf(" ", 150)) + " …" : r.report) + "”";
      rFull.style.backgroundImage = 'url("' + r.full + '")'; rDet.style.backgroundImage = 'url("' + r.detail + '")';
      later(function () { rFull.classList.add("is-in"); }, reduceMotion ? 0 : 1600);
      later(function () { rDet.classList.add("is-in"); }, reduceMotion ? 0 : 3400);
      if (!reduceMotion) later(showReport, 12000);
    }
    showReport();

    // tiles 2 and 4: nested zoom
    $$('[data-tile="zoom"]', root).forEach(function (tile) {
      var id = tile.getAttribute("data-zoom"), info = HB.teaser[id];
      var region = HB.regions.filter(function (r) { return r.id === id; })[0];
      if (!info || !region) return;
      var frames = info.frames, holder = $("[data-tz-frame]", tile), scaleEl = $("[data-tz-scale]", tile);
      var wrap = document.createElement("div"); wrap.className = "tz-wrap"; holder.appendChild(wrap);
      var n = frames.length, layers = [];
      for (var k = 0; k + 1 < n; k++) {             // layer k: frame k with frame k + 1 inset at its place, so the target stays sharp
        var f = frames[k], c = frames[k + 1], el = document.createElement("div"), inset = document.createElement("div");
        el.className = "tz-img"; inset.className = "tz-img";
        el.style.backgroundImage = 'url("assets/gen/teaser/' + id + "_" + k + '.webp")';
        inset.style.backgroundImage = 'url("assets/gen/teaser/' + id + "_" + (k + 1) + '.webp")';
        inset.style.inset = "auto"; inset.style.left = (c.x - f.x) / f.side * 100 + "%"; inset.style.top = (c.y - f.y) / f.side * 100 + "%";
        inset.style.width = inset.style.height = c.side / f.side * 100 + "%";
        el.appendChild(inset); wrap.appendChild(el); layers.push(el);
      }
      var logs = [0];
      for (k = 0; k + 1 < n; k++) logs.push(logs[k] + Math.log(frames[k].side / frames[k + 1].side));
      var total = logs[n - 1], D = 17000, HOLD = 3000, clock = 0, last = null;
      function render(z) {       // z in [0, total]: log zoom
        var k = 0;
        while (k < n - 2 && z >= logs[k + 1]) k++;
        var f = frames[k], c = frames[k + 1], r = f.side / c.side, s = Math.min(r, Math.exp(z - logs[k]));
        var q = (1 - 1 / s) / (1 - 1 / r), u0 = (c.x - f.x) / f.side, v0 = (c.y - f.y) / f.side;
        layers.forEach(function (el, j) { el.style.visibility = j === k ? "visible" : "hidden"; });
        layers[k].style.transform = "translate(" + (-u0 * q * s * 100) + "%," + (-v0 * q * s * 100) + "%) scale(" + s + ")";
        var across = f.side / s * region.mpp;          // micrometres across the tile
        scaleEl.textContent = across >= 1000 ? (across / 1000).toFixed(1) + " mm across" : Math.round(across) + " µm across";
      }
      render(0);
      if (reduceMotion || n < 2) return;
      function tick(now) {
        requestAnimationFrame(tick);
        if (!running || !visible) { last = null; return; }
        if (last == null) last = now;
        clock += now - last; last = now;
        var half = D + HOLD, t = clock % (2 * half), u = t < half ? t / D : (2 * half - t - HOLD) / D;
        u = Math.min(1, Math.max(0, u));
        var e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        render(e * total);
      }
      requestAnimationFrame(tick);
    });

    // tile 3: tasks as images
    var tk = { img: $("[data-tk-img]", root), img2: $("[data-tk-img2]", root), canvas: $("[data-tk-canvas]", root), text: $("[data-tk-text]", root) };
    var tkSets = ["panck", "pannuke", "beetle", "panda", "inst_pannuke", "det_pannuke", "tiger"].map(function (id) { return HB.sets[id]; }).filter(Boolean);
    var ti = 0;
    function showTask() {
      if (!tkSets.length) return;
      if (!running || !visible) { later(showTask, 400); return; }
      var set = tkSets[ti % tkSets.length], ex = set.examples[(ti / tkSets.length | 0) % set.examples.length]; ti++;
      var out = tk.canvas.parentNode;
      out.classList.remove("is-painted");
      loadLabel(ex.pr).then(function (pr) {
        tk.img.src = ex.he; tk.img2.src = ex.he;
        drawLabels(tk.canvas, set.classes, pr, null, {});
        tk.text.textContent = "“" + set.instruction + "”";
        void out.offsetWidth;
        later(function () { out.classList.add("is-painted"); }, reduceMotion ? 0 : 1200);
        if (!reduceMotion) later(showTask, 8500);
      });
    }
    showTask();

    var toggle = $("[data-teaser-toggle]");
    if (reduceMotion) { toggle.hidden = true; }
    toggle.addEventListener("click", function () {
      running = !running;
      toggle.textContent = running ? "Pause animation" : "Play animation";
      toggle.setAttribute("aria-pressed", String(!running));
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(root);
    }
  }

  /* ---------- method sketch ---------- */
  function initSketch() {
    var img = $("[data-sketch-img]"), canvas = $("[data-sketch-canvas]"), text = $("[data-sketch-text]");
    var set = HB.sets.pannuke || HB.sets[Object.keys(HB.sets)[0]];
    if (!img || !set) return;
    var best = 0;
    set.examples.forEach(function (e, k) { if (e.miou > set.examples[best].miou) best = k; });
    var mid = set.examples.slice().sort(function (a, b) { return a.miou - b.miou; })[set.examples.length >> 1];
    img.src = mid.he;
    loadLabel(mid.pr).then(function (pr) { drawLabels(canvas, set.classes, pr, null, {}); });
    text.textContent = "“" + set.instruction + "”";
  }

  /* ---------- hero mosaic: generated patches on the left, painted task answers on the right ---------- */
  function initHero() {
    var box = $("[data-hero-mosaic]");
    if (!box) return;
    var sets = ["beetle", "pannuke", "panck", "panda", "tiger", "inst_pannuke", "sicap", "det_pannuke"].map(function (id) { return HB.sets[id]; }).filter(Boolean);
    for (var r = 0; r < 4; r++) {
      var dense = HB.uncond.dense;                 // unconditional samples that are at least 80 % tissue, in order
      box.appendChild(sprite("assets/gen/uncond.webp", 8, 3, dense[(r * 2) % dense.length]));
      box.appendChild(sprite("assets/gen/uncond.webp", 8, 3, dense[(r * 2 + 1) % dense.length]));
      for (var j = 0; j < 2; j++) {
        var set = sets[(r * 2 + j) % sets.length], c = document.createElement("canvas");
        c.width = c.height = 224; box.appendChild(c);
        (function (set, c) { loadLabel(set.examples[0].pr).then(function (pr) { drawLabels(c, set.classes, pr, null, {}); }); })(set, c);
      }
    }
  }

  /* ---------- text-to-image gallery ---------- */
  function initT2I() {
    var root = $("[data-t2i]");
    if (!root) return;
    var chips = $("[data-t2i-chips]", root), grid = $("[data-t2i-grid]", root), prompt = $("[data-t2i-prompt]", root);
    var group = "tumour", current = null;
    function label(c) {
      if (c.group === "scale") return c.organ + " · " + c.scale + " µm/px";
      return c.organ + (c.group === "normal" ? "" : ": " + c.diagnosis.replace(", nos", ""));
    }
    function select(c) {
      current = c;
      prompt.textContent = c.prompt;
      grid.innerHTML = "";
      for (var k = 0; k < 8; k++) {
        var s = sprite("assets/gen/t2i/" + c.id + ".webp", 4, 2, k);
        s.setAttribute("role", "img");
        s.setAttribute("aria-label", "Generated H&E patch, seed " + (k + 1) + " of 8, for the prompt: " + c.prompt);
        grid.appendChild(s);
      }
      $$(".chip", chips).forEach(function (b) { b.classList.toggle("is-active", b.dataset.id === c.id); b.setAttribute("aria-pressed", String(b.dataset.id === c.id)); });
    }
    function build() {
      chips.innerHTML = "";
      var cells = HB.t2i.filter(function (c) { return c.group === group; });
      cells.forEach(function (c) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "chip"; b.dataset.id = c.id; b.textContent = label(c);
        b.addEventListener("click", function () { select(c); });
        chips.appendChild(b);
      });
      select(cells[0]);
    }
    $$(".task-tab", root).forEach(function (tab) {
      tab.addEventListener("click", function () {
        group = tab.dataset.group;
        $$(".task-tab", root).forEach(function (t) { t.classList.toggle("is-active", t === tab); t.setAttribute("aria-selected", String(t === tab)); });
        build();
      });
    });
    build();
    var un = $("[data-uncond]");
    for (var k = 0; k < 24; k++) {
      var s = sprite("assets/gen/uncond.webp", 8, 3, k);
      s.setAttribute("role", "img"); s.setAttribute("aria-label", "Unconditional generated H&E patch " + (k + 1));
      un.appendChild(s);
    }
  }

  /* ---------- browse by control ---------- */
  function initControls() {
    var root = $("[data-controls]");
    if (!root || !HB.controls) return;
    var tabs = $("[data-ctl-tabs]", root), body = $("[data-ctl-body]", root);
    var items = [["organs", "Organ"], ["diagnoses", "Diagnosis"], ["scale", "Scale"], ["prep", "Preparation"], ["notes", "Slide notes"], ["fields", "Pathology fields"], ["captions", "Patch captions"], ["empty", "Empty prompt"], ["order", "Known pixels"], ["context", "Surrounding context"]];
    function show(id) {
      $$(".task-tab", tabs).forEach(function (t) { t.classList.toggle("is-active", t.dataset.id === id); t.setAttribute("aria-selected", String(t.dataset.id === id)); });
      body.innerHTML = "";
      if (id === "empty") {
        var p = document.createElement("p"); p.className = "result-note"; p.style.margin = "0";
        p.textContent = "With no prompt at all the model chooses organ, diagnosis and scale itself. Any subset of the fields is a valid prompt: the organ lines under “Organ” give no diagnosis.";
        var g = document.createElement("div"); g.className = "uncond-grid";
        for (var k = 0; k < 16; k++) g.appendChild(sprite("assets/gen/uncond.webp", 8, 3, k));
        body.appendChild(p); body.appendChild(g); return;
      }
      if (id === "order") {
        var o = HB.controls.order, w = document.createElement("div"); w.className = "ctl-order";
        w.innerHTML = '<p class="result-note" style="margin:0 0 12px">A strip of 832 × 3,008 px generated in ' + o.rounds + ' rounds, 224 px windows in random order. Each new window is given the pixels it shares with finished neighbours and continues them. Move the slider to see the strip at a quarter, half, three quarters and all of the rounds.</p><img alt="Partly generated strip of H&E tissue" width="' + o.width + '" height="' + o.height + '"><label class="slider-row">Progress <input type="range" min="0" max="3" step="1" value="1" aria-label="Generation progress"> <output></output></label>';
        body.appendChild(w);
        var im = $("img", w), sl = $("input", w), out = $("output", w), names = ["25", "50", "75", "100"];
        var set = function () { im.src = "assets/gen/controls/order_" + names[sl.value] + ".webp"; out.textContent = names[sl.value] + "%"; };
        sl.addEventListener("input", set); set(); return;
      }
      if (id === "context") {
        var cx = HB.controls.context, wr = document.createElement("div"); wr.className = "ctl-context";
        wr.innerHTML = '<p class="result-note" style="margin:0 0 12px">In the region model every window also receives a context vector: a context network looks at the region generated so far, at a quarter of the resolution and up to 12 × 12 windows around, and summarises what surrounds the window. Below, two windows of the any-order strip (boxed) with their surroundings just before they are generated, in rounds ' + cx.items.map(function (it) { return it.round; }).join(" and ") + " of " + cx.rounds + ', and after.</p><div class="ctx-pair">' + cx.items.map(function (it, k) { return '<figure><div class="ctx-img"><img src="assets/gen/controls/context_before' + it.suffix + '.webp" alt="Generated surroundings with one empty window"><i data-k="' + k + '"></i></div><figcaption>window ' + (k + 1) + ', before</figcaption></figure><figure><div class="ctx-img"><img src="assets/gen/controls/context_after' + it.suffix + '.webp" alt="The same field after the window is generated"><i data-k="' + k + '"></i></div><figcaption>window ' + (k + 1) + ', after</figcaption></figure>'; }).join("") + "</div>";
        body.appendChild(wr);
        $$("i", wr).forEach(function (b) { var bx = cx.items[+b.dataset.k].box; b.style.left = bx[1] * 100 + "%"; b.style.top = bx[0] * 100 + "%"; b.style.width = b.style.height = bx[2] * 100 + "%"; });
        return;
      }
      var c = HB.controls[id];
      c.lines.forEach(function (line, r) {
        if (line.intro) {
          var note = document.createElement("p"); note.className = "result-note ctl-note";
          note.innerHTML = "Prompt: <code></code><br>" + (line.how || "Slide note, given as a second text segment") + ": <q></q>";
          $("code", note).textContent = line.intro; $("q", note).textContent = line.note;
          body.appendChild(note);
        }
        var row = document.createElement("div"); row.className = "ctl-line";
        var lab = document.createElement("strong"); lab.textContent = line.label; lab.title = line.prompt;
        var ims = document.createElement("div"); ims.className = "ctl-imgs"; ims.style.setProperty("--n", c.cols);
        for (var j = 0; j < c.cols; j++) { var s = sprite("assets/gen/controls/" + id + ".webp", c.cols, c.n, r * c.cols + j); s.setAttribute("role", "img"); s.setAttribute("aria-label", "Generated patch for the prompt: " + line.prompt); ims.appendChild(s); }
        row.appendChild(lab); row.appendChild(ims); body.appendChild(row);
      });
    }
    items.forEach(function (it) {
      var t = document.createElement("button"); t.type = "button"; t.className = "task-tab"; t.dataset.id = it[0]; t.setAttribute("role", "tab"); t.textContent = it[1];
      t.addEventListener("click", function () { show(it[0]); }); tabs.appendChild(t);
    });
    show("organs");
  }

  /* ---------- tiled pan / zoom viewer ---------- */
  function initViewer() {
    var root = $("[data-viewer]");
    if (!root) return;
    var stage = $("[data-viewer-stage]", root), canvas = $("[data-viewer-canvas]", root), ctx = canvas.getContext("2d");
    var thumbs = $("[data-viewer-thumbs]", root), caption = $("[data-viewer-caption]", root);
    var bar = $("[data-viewer-scale] span", root), barText = $("[data-viewer-scale] em", root);
    var region = null, view = { x: 0, y: 0, z: 1 }, minZ = 0.05, tiles = {}, pending = false, W = 0, H = 0, dpr = 1;
    function levelSize(l) { var s = Math.pow(2, region.levels - 1 - l); return [Math.ceil(region.width / s), Math.ceil(region.height / s)]; }
    function tile(l, tx, ty) {
      var key = region.id + "/" + l + "/" + tx + "_" + ty, t = tiles[key];
      if (!t) {
        t = tiles[key] = { img: new Image(), ok: false };
        t.img.onload = function () { t.ok = true; draw(); };
        t.img.src = "assets/gen/regions/" + key + ".webp";
      }
      return t;
    }
    function resize() {
      var r = stage.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      if (region) { minZ = Math.min(W / region.width, H / region.height) * 0.9; clamp(); draw(); }
    }
    function fit() { view.z = Math.min(W / region.width, H / region.height) * 0.96; view.x = region.width / 2; view.y = region.height / 2; }
    function clamp() {
      view.z = Math.max(minZ, Math.min(2, view.z));
      view.x = Math.max(0, Math.min(region.width, view.x)); view.y = Math.max(0, Math.min(region.height, view.y));
    }
    function draw() { if (!pending) { pending = true; requestAnimationFrame(paint); } }
    function paintLevel(l, onlyLoaded) {
      var s = Math.pow(2, region.levels - 1 - l), size = levelSize(l), T = region.tile;
      var x0 = view.x - W / 2 / view.z, y0 = view.y - H / 2 / view.z, x1 = view.x + W / 2 / view.z, y1 = view.y + H / 2 / view.z;
      var a = Math.max(0, Math.trunc(x0 / s / T)), b = Math.max(0, Math.trunc(y0 / s / T));
      var c = Math.min(Math.ceil(size[0] / T) - 1, Math.trunc(x1 / s / T)), d = Math.min(Math.ceil(size[1] / T) - 1, Math.trunc(y1 / s / T));
      for (var ty = b; ty <= d; ty++) for (var tx = a; tx <= c; tx++) {
        var t = tile(l, tx, ty);
        if (!t.ok) continue;
        var px = (tx * T * s - x0) * view.z, py = (ty * T * s - y0) * view.z;
        ctx.drawImage(t.img, px, py, t.img.naturalWidth * s * view.z + 0.6, t.img.naturalHeight * s * view.z + 0.6);
      }
    }
    function paint() {
      pending = false;
      if (!region) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingQuality = "high";
      var want = region.levels - 1 + Math.ceil(Math.log2(view.z * dpr) - 0.15);
      want = Math.max(0, Math.min(region.levels - 1, want));
      paintLevel(0);
      for (var l = 1; l <= want; l++) paintLevel(l);
      // scale bar
      var umPerPx = region.mpp / view.z, target = 120 * umPerPx, nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000], um = nice[0];
      for (var i = 0; i < nice.length; i++) if (nice[i] <= target) um = nice[i];
      bar.style.width = um / umPerPx + "px";
      barText.textContent = um >= 1000 ? um / 1000 + " mm" : um + " µm";
    }
    function zoomAt(f, cx, cy) {
      var wx = view.x + (cx - W / 2) / view.z, wy = view.y + (cy - H / 2) / view.z;
      view.z = Math.max(minZ, Math.min(2, view.z * f));
      view.x = wx - (cx - W / 2) / view.z; view.y = wy - (cy - H / 2) / view.z;
      clamp(); draw();
    }
    function show(r) {
      region = r; resize(); fit(); minZ = view.z * 0.9; draw();
      $$(".viewer-thumb", thumbs).forEach(function (b) { b.classList.toggle("is-active", b.dataset.id === r.id); b.setAttribute("aria-selected", String(b.dataset.id === r.id)); });
      var full = r.full_px[0].toLocaleString("en-US") + " × " + r.full_px[1].toLocaleString("en-US") + " px at 0.5 µm/px";
      var txt = "<strong>" + r.title.replace(/ x /g, " × ").replace(/um/g, "µm") + ".</strong> ";
      if (r.report) {
        txt += "Shown at " + r.mpp.toFixed(1) + " µm/px, the size of the copy at hand, with a detail at full resolution. The whole region was conditioned on the summary below, as in the report-to-region figure of the paper.";
        txt += '<div class="report-box"><div><span class="prompt-label">Report summary (conditioning text)</span><blockquote></blockquote></div><figure style="margin:0"><img src="' + r.detail + '" alt="Detail of the generated region at 0.5 µm/px" loading="lazy"><figcaption class="muted" style="font-size:.74rem;margin-top:4px">detail, 448 µm across</figcaption></figure></div>';
      } else if (r.id.indexOf("slide") === 0) {
        txt += "Generated at " + full + "; shown here up to " + r.mpp.toFixed(1) + " µm/px to keep the page small. No prompt was given: the model drew the tissue itself";
        txt += r.read ? "; a medical vision-language model (MedGemma-4B) reads it as " + r.read.organ + ", " + r.read.diagnosis + "." : ".";
      } else txt += "Shown at full resolution. No prompt was given; the layout comes from the coarse level of the cascade.";
      caption.innerHTML = txt;
      if (r.report) $("blockquote", caption).textContent = r.report;
    }
    HB.regions.forEach(function (r, k) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "viewer-thumb"; b.dataset.id = r.id; b.setAttribute("role", "tab");
      b.innerHTML = '<img src="assets/gen/regions/' + r.id + '/thumb.webp" alt="" loading="lazy"><span>' + (r.report ? "From a report" : r.id.indexOf("slide") === 0 ? "Whole slide " + k : "8,192 px region") + "</span>";
      b.addEventListener("click", function () { show(r); });
      thumbs.appendChild(b);
    });
    // pointers: drag to pan, two fingers to pinch
    var pts = {}, pinch = 0;
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      stage.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY];
      stage.classList.add("is-dragging", "is-active");
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      var ids = Object.keys(pts), prev = pts[e.pointerId];
      if (ids.length === 1 && e.pointerType !== "touch") { view.x -= (e.clientX - prev[0]) / view.z; view.y -= (e.clientY - prev[1]) / view.z; }
      if (ids.length === 2 && e.pointerType === "touch") {      // two fingers: move by the midpoint, zoom by the distance
        var o = pts[ids[0] === String(e.pointerId) ? ids[1] : ids[0]];
        view.x -= (e.clientX - prev[0]) / 2 / view.z; view.y -= (e.clientY - prev[1]) / 2 / view.z; void o;
      }
      pts[e.pointerId] = [e.clientX, e.clientY];
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), r = stage.getBoundingClientRect();
        if (pinch) zoomAt(dist / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        pinch = dist;
      }
      clamp(); draw();
    });
    function up(e) { delete pts[e.pointerId]; pinch = 0; if (!Object.keys(pts).length) stage.classList.remove("is-dragging"); }
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    stage.addEventListener("wheel", function (e) {
      if (!stage.classList.contains("is-active") && !e.ctrlKey) return;      // scroll the page until the viewer is clicked
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    document.addEventListener("pointerdown", function (e) { if (!stage.contains(e.target)) stage.classList.remove("is-active"); });
    stage.addEventListener("dblclick", function (e) { var r = stage.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
    stage.addEventListener("keydown", function (e) {
      var step = 80 / view.z, used = true;
      if (e.key === "ArrowLeft") view.x -= step; else if (e.key === "ArrowRight") view.x += step;
      else if (e.key === "ArrowUp") view.y -= step; else if (e.key === "ArrowDown") view.y += step;
      else if (e.key === "+" || e.key === "=") zoomAt(1.5, W / 2, H / 2); else if (e.key === "-") zoomAt(1 / 1.5, W / 2, H / 2);
      else used = false;
      if (used) { e.preventDefault(); clamp(); draw(); }
    });
    $("[data-zoom-in]", root).addEventListener("click", function () { zoomAt(1.6, W / 2, H / 2); });
    $("[data-zoom-out]", root).addEventListener("click", function () { zoomAt(1 / 1.6, W / 2, H / 2); });
    $("[data-zoom-reset]", root).addEventListener("click", function () { fit(); draw(); });
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) $("[data-viewer-hint]", root).textContent = "Two fingers to move and zoom, or use the buttons";
    stage.addEventListener("pointerdown", function (e) { if (e.pointerType === "touch") stage.classList.remove("is-active"); });
    window.addEventListener("resize", resize);
    window.HBViewer = { state: function () { return { z: view.z, x: view.x, y: view.y, id: region && region.id, loaded: Object.keys(tiles).filter(function (k) { return tiles[k].ok; }).length }; }, zoomAt: zoomAt };
    var started = false;
    function start() { if (!started) { started = true; show(HB.regions[0]); } }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es, ob) { if (es[0].isIntersecting) { start(); ob.disconnect(); } }, { rootMargin: "600px" }).observe(root);
    } else start();
  }

  /* ---------- task explorer ---------- */
  function initExplorer() {
    var root = $("[data-explorer]");
    if (!root) return;
    var el = {
      tabs: $("[data-ex-tabs]", root), sets: $("[data-ex-sets]", root), input: $("[data-ex-input]", root), base: $("[data-ex-base]", root),
      canvas: $("[data-ex-canvas]", root), prompt: $("[data-ex-prompt]", root), readout: $("[data-ex-readout]", root), compare: $("[data-ex-compare]", root),
      divider: $("[data-ex-divider]", root), tip: $("[data-ex-tip]", root), opacity: $("[data-ex-opacity]", root), legend: $("[data-ex-legend]", root),
      metrics: $("[data-ex-metrics]", root), title: $("[data-ex-title]", root), note: $("[data-ex-note]", root), count: $("[data-ex-count]", root),
      foot: $("[data-ex-inputfoot]", root)
    };
    var st = { fam: null, set: null, k: 0, split: 0.5, hidden: {}, gt: null, pr: null, token: 0 };
    function render() { if (st.gt) drawLabels(el.canvas, st.set.classes, st.pr, st.gt, { split: st.split, hidden: st.hidden }); }
    function setSplit(v) {
      st.split = Math.max(0, Math.min(1, v));
      el.divider.style.left = st.split * 100 + "%";
      el.divider.setAttribute("aria-valuenow", String(Math.round(st.split * 100)));
      render();
    }
    function metric(name, value, cls) { return '<div class="metric ' + (cls || "") + '"><strong>' + value + "</strong><span>" + name + "</span></div>"; }
    function showExample() {
      var set = st.set, ex = set.examples[st.k], token = ++st.token;
      el.input.src = ex.he; el.base.src = ex.he;
      el.input.alt = "H&E test image, " + set.dataset_name; el.base.alt = "";
      el.count.textContent = "Example " + (st.k + 1) + " of " + set.examples.length;
      el.title.textContent = set.title + " · " + set.dataset_name;
      el.note.textContent = set.mpp + " µm/px · test split · full test set in the paper: " + set.paper.metric + " " + set.paper.value.toFixed(3).replace(/^0/, "");
      el.foot.textContent = "field of view " + Math.round(224 * set.mpp) + " µm";
      Promise.all([loadLabel(ex.gt), loadLabel(ex.pr)]).then(function (m) {
        if (token !== st.token) return;
        st.gt = m[0]; st.pr = m[1];
        render();
        var s = window.HBMetrics.score(st.gt, st.pr), html = "";
        if (set.family === "cls") {
          var ok = ex.label === ex.pred;
          html += metric("label", set.classes[ex.label].name) + metric("painted on " + Math.round(ex.share[ex.pred] * 100) + "% of pixels", set.classes[ex.pred].name, ok ? "is-good" : "is-bad");
          html += metric("balanced accuracy, full test set (paper)", set.paper.value.toFixed(3).replace(/^0/, ""));
        } else {
          html += metric("mIoU, this image", fmt(s.miou)) + metric("Dice, this image", fmt(s.dice)) + metric("foreground Dice", fmt(s.fg)) + metric("pixels agree", Math.round(s.acc * 100) + "%");
          if (set.family === "nuclei") { var q = window.HBMetrics.bpq(st.gt, st.pr, 224, 224); if (q != null) html += metric("bPQ, connected regions", fmt(q)); }
          if (ex.extra && ex.extra.value != null) html += metric(ex.extra.name + ", this image", fmt(ex.extra.value));
          if (ex.extra && ex.extra.found != null) html += metric("cells found / annotated", ex.extra.found + " / " + ex.extra.annotated);
        }
        el.metrics.innerHTML = html;
      });
    }
    function showSet(id) {
      st.set = HB.sets[id]; st.k = 0;
      st.hidden = {};
      if (st.set.family !== "cls") st.hidden[0] = true;          // background off by default
      el.prompt.textContent = st.set.instruction;
      $$(".chip", el.sets).forEach(function (b) { b.classList.toggle("is-active", b.dataset.id === id); b.setAttribute("aria-pressed", String(b.dataset.id === id)); });
      el.legend.innerHTML = "";
      st.set.classes.forEach(function (c, i) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "legend-chip" + (st.hidden[i] ? " is-off" : "");
        b.setAttribute("aria-pressed", String(!st.hidden[i]));
        b.innerHTML = '<i style="background:' + rgb(c.color) + '"></i>' + c.name;
        b.addEventListener("click", function () { st.hidden[i] = !st.hidden[i]; b.classList.toggle("is-off", !!st.hidden[i]); b.setAttribute("aria-pressed", String(!st.hidden[i])); render(); });
        el.legend.appendChild(b);
      });
      showExample();
    }
    function showFamily(fam) {
      st.fam = fam;
      el.readout.textContent = fam.readout;
      $$(".task-tab", el.tabs).forEach(function (t) { t.classList.toggle("is-active", t.dataset.id === fam.id); t.setAttribute("aria-selected", String(t.dataset.id === fam.id)); });
      el.sets.innerHTML = "";
      fam.sets.forEach(function (id) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "chip"; b.dataset.id = id; b.textContent = HB.sets[id].title;
        b.addEventListener("click", function () { showSet(id); });
        el.sets.appendChild(b);
      });
      showSet(fam.sets[0]);
    }
    HB.families.forEach(function (fam) {
      var t = document.createElement("button");
      t.type = "button"; t.className = "task-tab"; t.dataset.id = fam.id; t.setAttribute("role", "tab"); t.textContent = fam.title;
      t.addEventListener("click", function () { showFamily(fam); });
      el.tabs.appendChild(t);
    });
    function step(d) { var n = st.set.examples.length; st.k = (st.k + d + n) % n; showExample(); }
    $("[data-ex-prev]", root).addEventListener("click", function () { step(-1); });
    $("[data-ex-next]", root).addEventListener("click", function () { step(1); });
    el.opacity.addEventListener("input", function () { el.canvas.style.opacity = el.opacity.value / 100; });
    el.canvas.style.opacity = el.opacity.value / 100;
    // divider drag + hover tooltip
    var dragging = false;
    function pos(e) { var r = el.compare.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; }
    el.compare.addEventListener("pointerdown", function (e) { dragging = true; el.compare.setPointerCapture(e.pointerId); setSplit(pos(e)[0]); });
    el.compare.addEventListener("pointermove", function (e) {
      var p = pos(e);
      if (dragging) setSplit(p[0]);
      if (!st.gt || p[0] < 0 || p[0] >= 1 || p[1] < 0 || p[1] >= 1) { el.tip.hidden = true; return; }
      var i = Math.trunc(p[1] * 224) * 224 + Math.trunc(p[0] * 224), a = st.pr[i], b = st.gt[i], cl = st.set.classes;
      var line = function (tag, v) { return v === 255 ? tag + ": not labelled" : '<i style="background:' + rgb(cl[v].color) + '"></i>' + tag + ": " + cl[v].name; };
      el.tip.innerHTML = line("prediction", a) + "<br>" + line("ground truth", b);
      el.tip.hidden = false;
      var x = e.clientX - p[2].left + 14, y = e.clientY - p[2].top + 14;
      if (x > p[2].width - 170) x -= 190;
      if (y > p[2].height - 50) y -= 60;
      el.tip.style.left = Math.max(4, x) + "px"; el.tip.style.top = Math.max(4, y) + "px";
    });
    function end() { dragging = false; }
    el.compare.addEventListener("pointerup", end); el.compare.addEventListener("pointercancel", end);
    el.compare.addEventListener("pointerleave", function () { el.tip.hidden = true; });
    el.divider.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { setSplit(st.split - 0.05); e.preventDefault(); }
      if (e.key === "ArrowRight") { setSplit(st.split + 0.05); e.preventDefault(); }
    });
    showFamily(HB.families[0]);
    window.HBExplorer = { state: st };
  }

  /* ---------- TLS ---------- */
  function initTLS() {
    var root = $("[data-tls]");
    if (!root || !HB.tls || !HB.tls.slides) return;
    var T = HB.tls, ns = "http://www.w3.org/2000/svg";
    var el = { chips: $("[data-tls-slides]", root), img: $("[data-tls-img]", root), heat: $("[data-tls-heat]", root), dots: $("[data-tls-dots]", root), truth: $("[data-tls-truth]", root),
               count: $("[data-tls-count]", root), pair: $("[data-tls-pair]", root), text: $("[data-tls-detailtext]", root), op: $("[data-tls-opacity]", root) };
    var cur = null;
    function circle(svg, p, r, w, h) {
      var c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", p[1] * w); c.setAttribute("cy", p[0] * h); c.setAttribute("r", r); svg.appendChild(c); return c;
    }
    function detail(sl, d, c) {
      $$("circle", root).forEach(function (q) { q.classList.remove("is-on"); });
      if (c) c.classList.add("is-on");
      el.pair.src = "assets/tasks/tls/" + sl.dir + "/" + d.file;
      el.text.textContent = (d.kind === "det" ? "A detection of the model. " : "An annotated TLS without a detection nearby. ") + "Left: the slide at 4 µm/px, a field of " + (sl.field_um / 1000).toFixed(1) + " mm. Right: the model's dot map for the same field (average over the overlapping windows).";
    }
    function show(k) {
      var sl = T.slides[k]; cur = sl;
      if (typeof resetView === "function") resetView();
      $$(".chip", el.chips).forEach(function (b, i) { b.classList.toggle("is-active", i === k); b.setAttribute("aria-pressed", String(i === k)); });
      el.img.src = "assets/tasks/tls/" + sl.dir + "/slide.webp"; el.heat.src = "assets/tasks/tls/" + sl.dir + "/heat.png";
      el.img.width = sl.width; el.img.height = sl.height;
      el.img.style.aspectRatio = sl.width + " / " + sl.height;      // the overlay stays registered while the new slide loads
      [el.dots, el.truth].forEach(function (svg) { svg.setAttribute("viewBox", "0 0 " + sl.width + " " + sl.height); svg.innerHTML = ""; });
      var find = function (kind, p) { return sl.details.filter(function (d) { return d.kind === kind && Math.abs(d.y - p[0]) < 1e-4 && Math.abs(d.x - p[1]) < 1e-4; })[0]; };
      sl.truth.forEach(function (p) { var c = circle(el.truth, p, 30, sl.width, sl.height), d = find("truth", p); if (d) c.addEventListener("click", function () { detail(sl, d, c); }); else c.style.pointerEvents = "none"; });
      var first = null;
      sl.det.forEach(function (p) { var c = circle(el.dots, p, 19, sl.width, sl.height), d = find("det", p); if (d) { c.addEventListener("click", function () { detail(sl, d, c); }); if (!first) first = [d, c]; } });
      el.count.textContent = sl.organ + ": " + sl.n_det + " detections, " + sl.tp + " inside one of the " + sl.n_truth + " annotated TLS; F1 " + sl.f1.toFixed(2) + " on this slide (paper, all " + 678 + " test slides: ." + String(Math.round(T.f1_all * 1000)) + ").";
      if (first) detail(sl, first[0], first[1]); else if (sl.details[0]) detail(sl, sl.details[0], null);
    }
    T.slides.forEach(function (sl, k) {
      var b = document.createElement("button"); b.type = "button"; b.className = "chip";
      b.textContent = sl.organ.split(" (")[0] + " · F1 " + sl.f1.toFixed(2);
      b.addEventListener("click", function () { show(k); }); el.chips.appendChild(b);
    });
    $$("[data-tls-toggle]", root).forEach(function (cb) {
      cb.addEventListener("change", function () {
        var k = cb.dataset.tlsToggle;
        (k === "heat" ? el.heat : k === "truth" ? el.truth : el.dots).style.display = cb.checked ? "" : "none";
      });
    });
    el.op.addEventListener("input", function () { el.heat.style.opacity = el.op.value / 100; });
    var stage = $("[data-tls-stage]", root), inner = $("[data-tls-inner]", root), V = { z: 1, x: 0, y: 0 }, moved = 0;
    function apply() {
      var w = stage.clientWidth, h = stage.clientHeight;
      V.z = Math.max(1, Math.min(8, V.z));
      V.x = Math.min(0, Math.max(w - w * V.z, V.x)); V.y = Math.min(0, Math.max(h - h * V.z, V.y));
      inner.style.transform = "translate(" + V.x + "px," + V.y + "px) scale(" + V.z + ")";
      if (V.z > 1.5 && cur && el.img.getAttribute("data-hi") !== cur.dir) {          // the 4 um/px image, on demand
        var hi = new Image(), dir = cur.dir;
        hi.onload = function () {
          var swap = function () { if (cur && cur.dir === dir && V.z > 1) { el.img.src = hi.src; el.img.setAttribute("data-hi", dir); } };
          if (hi.decode) hi.decode().then(swap, swap); else swap();
        };
        hi.src = "assets/tasks/tls/" + dir + "/slide_hi.webp"; el.img.setAttribute("data-hi", dir);
      }
    }
    function zoomAt(f, cx, cy) {
      var z0 = V.z, z1 = Math.max(1, Math.min(8, z0 * f));
      V.x = cx - (cx - V.x) * z1 / z0; V.y = cy - (cy - V.y) * z1 / z0; V.z = z1; apply();
    }
    function resetView() { V.z = 1; V.x = V.y = 0; el.img.removeAttribute("data-hi"); apply(); }
    $$("[data-tls-zoom]", root).forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.tlsZoom;
        if (k === "reset") resetView(); else zoomAt(k === "in" ? 1.6 : 1 / 1.6, stage.clientWidth / 2, stage.clientHeight / 2);
      });
    });
    var pts = {}, pinch = 0;
    stage.addEventListener("pointerdown", function (e) {
      moved = 0;
      if (e.target.closest("button")) return;
      pts[e.pointerId] = [e.clientX, e.clientY];
      if (e.pointerType !== "touch") { stage.classList.add("is-active"); }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId]) return;
      var ids = Object.keys(pts), prev = pts[e.pointerId], dx = e.clientX - prev[0], dy = e.clientY - prev[1], r = stage.getBoundingClientRect();
      pts[e.pointerId] = [e.clientX, e.clientY];
      if (ids.length === 1 && e.pointerType !== "touch") {
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) { stage.classList.add("is-dragging"); V.x += dx; V.y += dy; apply(); }
      } else if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        V.x += dx / 2; V.y += dy / 2;
        if (pinch) zoomAt(dist / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); else apply();
        pinch = dist; moved = 9;
      }
    });
    function up(e) { delete pts[e.pointerId]; pinch = 0; stage.classList.remove("is-dragging"); }
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up); stage.addEventListener("pointerleave", up);
    stage.addEventListener("click", function (e) { if (moved > 4 && !e.target.closest("button")) { e.stopPropagation(); e.preventDefault(); } }, true);
    stage.addEventListener("wheel", function (e) {
      if (!stage.classList.contains("is-active") && !e.ctrlKey) return;
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    document.addEventListener("pointerdown", function (e) { if (!stage.contains(e.target)) stage.classList.remove("is-active"); });
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) $("[data-tls-hint]", root).textContent = "Use two fingers to zoom and move, or the buttons; one finger scrolls the page. Zooming in loads the slide at 4 µm/px. Tap a circle to see that spot.";
    // scatter: annotated (x) against detected (y) per slide, square-root axes
    var svg = $("[data-tls-scatter]", root), S = T.scatter, m = 0;
    S.gt.forEach(function (v, i) { m = Math.max(m, v, S.pred[i]); });
    var L = 42, W = 286, f = function (v) { return Math.sqrt(v / m) * W; }, h = "";
    h += '<line class="ax" x1="' + L + '" y1="' + (10 + W) + '" x2="' + (L + W) + '" y2="' + (10 + W) + '"/><line class="ax" x1="' + L + '" y1="10" x2="' + L + '" y2="' + (10 + W) + '"/>';
    h += '<line class="diag" x1="' + L + '" y1="' + (10 + W) + '" x2="' + (L + W) + '" y2="10"/>';
    [0, 5, 20, 50, 100, 200, 400].filter(function (v) { return v <= m; }).forEach(function (v) {
      h += '<text x="' + (L + f(v)) + '" y="' + (26 + W) + '" text-anchor="middle">' + v + '</text><text x="' + (L - 6) + '" y="' + (14 + W - f(v)) + '" text-anchor="end">' + v + "</text>";
    });
    S.gt.forEach(function (v, i) { h += '<circle class="pt" cx="' + (L + f(v)).toFixed(1) + '" cy="' + (10 + W - f(S.pred[i])).toFixed(1) + '" r="3"/>'; });
    T.slides.forEach(function (sl) { h += '<circle class="pick" cx="' + (L + f(sl.n_truth)).toFixed(1) + '" cy="' + (10 + W - f(sl.n_det)).toFixed(1) + '" r="5"/>'; });
    h += '<text x="' + (L + W / 2) + '" y="' + (W + 46) + '" text-anchor="middle">annotated TLS</text><text transform="translate(12 ' + (10 + W / 2) + ') rotate(-90)" text-anchor="middle">detected</text>';
    svg.setAttribute("viewBox", "0 0 " + (L + W + 12) + " " + (W + 54));
    svg.innerHTML = h;
    $("[data-tls-scattertext]", root).textContent = "Each dot is one of the " + T.n_slides + " test slides with saved outputs; the dashed line marks equal counts and the yellow dots are the six slides above. Axes are square-root scaled. The paper reports a Spearman correlation of ." + Math.round(T.spearman * 100) + " between the two counts over the test slides.";
    show(0);
    window.HBTls = { show: show, slides: T.slides.length, view: function () { return { z: V.z, x: V.x, y: V.y, hi: el.img.getAttribute("data-hi") }; }, zoomAt: zoomAt };
  }

  /* ---------- small things ---------- */
  function initMisc() {
    var body = $("[data-credits]");
    HB.credits.forEach(function (c) {
      var tr = document.createElement("tr");
      tr.innerHTML = '<th scope="row"></th><td></td><td></td>';
      tr.children[0].textContent = c.name; tr.children[1].textContent = c.use + " (" + c.n + (c.n === 1 ? " image)" : " images)"); tr.children[2].textContent = c.licence;
      body.appendChild(tr);
    });
    var copy = $("[data-copy-bib]");
    copy.addEventListener("click", function () {
      var text = $("#bibtex").textContent, done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
      else {
        var r = document.createRange(); r.selectNodeContents($("#bibtex"));
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        try { document.execCommand("copy"); done(); } catch (err) { /* selection stays for a manual copy */ }
      }
    });
    var menu = $(".nav-menu");
    if (menu) $$("a", menu).forEach(function (a) { a.addEventListener("click", function () { menu.removeAttribute("open"); }); });
    function swipeHints() {
      $$(".result-table-wrap").forEach(function (w) {
        var h = w.previousElementSibling && w.previousElementSibling.classList.contains("swipe-hint") ? w.previousElementSibling : null;
        if (!h) { h = document.createElement("p"); h.className = "swipe-hint"; h.textContent = "↔ Swipe the table sideways to see all columns"; w.parentNode.insertBefore(h, w); }
        h.classList.toggle("is-on", w.scrollWidth > w.clientWidth + 4);
      });
    }
    swipeHints(); window.addEventListener("resize", swipeHints);
    $$("details.more-table").forEach(function (d) { d.addEventListener("toggle", swipeHints); });
    window.HBSwipeHints = swipeHints;
    var mascot = $("[data-mascot]");
    if (mascot && !reduceMotion) {
      mascot.addEventListener("click", function (e) {
        mascot.classList.remove("is-celebrating"); void mascot.offsetWidth; mascot.classList.add("is-celebrating");
        var cols = ["#6a3fa0", "#d9488f", "#e8a500", "#399951"];
        for (var k = 0; k < 14; k++) {
          var s = document.createElement("span");
          s.className = "banana-confetti"; s.textContent = "✦"; s.style.color = cols[k % cols.length];
          s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px";
          var ang = Math.random() * 6.283, dist = 60 + Math.random() * 120;
          s.style.setProperty("--dx", Math.cos(ang) * dist + "px"); s.style.setProperty("--dy", Math.sin(ang) * dist + "px");
          s.style.setProperty("--rot", Math.random() * 360 + "deg");
          s.addEventListener("animationend", function () { this.remove(); });
          document.body.appendChild(s);
        }
      });
    }
  }

  function boot() {
    [initHero, initTeaser, initT2I, initControls, initViewer, initExplorer, initTLS, initMisc].forEach(function (f) {
      try { f(); } catch (err) { console.error(f.name, err); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
