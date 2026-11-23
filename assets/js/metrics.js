/* Segmentation scores on label maps (Uint8Array, one class index per pixel; 255 in the ground truth = not labelled).
   mIoU / mean Dice: per class, averaged over the classes that occur in the ground truth or in the answer.
   fg: Dice of "any class other than 0"; acc: share of labelled pixels with the same class. */
(function (root) {
  "use strict";
  function score(gt, answer) {
    var n = gt.length, g = new Float64Array(256), p = new Float64Array(256), both = new Float64Array(256);
    var labelled = 0, same = 0, fgG = 0, fgP = 0, fgBoth = 0;
    for (var i = 0; i < n; i++) {
      var a = gt[i];
      if (a === 255) continue;
      var b = answer[i];
      labelled++;
      g[a]++; p[b]++;
      if (a === b) { both[a]++; same++; }
      if (a > 0) fgG++;
      if (b > 0) fgP++;
      if (a > 0 && b > 0) fgBoth++;
    }
    var perClass = [], sumIoU = 0, sumDice = 0;
    for (var c = 0; c < 256; c++) {
      if (g[c] + p[c] === 0) continue;
      var union = g[c] + p[c] - both[c];
      var iou = both[c] / union, dice = 2 * both[c] / (g[c] + p[c]);
      perClass.push({ c: c, iou: iou, dice: dice, gt: g[c], answer: p[c] });
      sumIoU += iou; sumDice += dice;
    }
    var k = perClass.length;
    return {
      miou: k ? sumIoU / k : 1,
      dice: k ? sumDice / k : 1,
      fg: fgG + fgP ? 2 * fgBoth / (fgG + fgP) : 1,
      acc: labelled ? same / labelled : 1,
      labelled: labelled,
      perClass: perClass
    };
  }
  /* 8-connected components of "label > 0" (ground-truth pixels with 255 never count). Returns {map: Int32Array, n}. */
  function components(lab, mask, w, h) {
    var map = new Int32Array(w * h), n = 0, stack = [];
    for (var s = 0; s < w * h; s++) {
      if (map[s] || !(lab[s] > 0) || (mask && mask[s] === 255) || lab[s] === 255) continue;
      n++; map[s] = n; stack.push(s);
      while (stack.length) {
        var i = stack.pop(), x = i % w, y = (i - x) / w;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          var j = yy * w + xx;
          if (map[j] || !(lab[j] > 0) || lab[j] === 255 || (mask && mask[j] === 255)) continue;
          map[j] = n; stack.push(j);
        }
      }
    }
    return { map: map, n: n };
  }
  /* Binary panoptic quality: instances are connected regions; a pair matches when its IoU exceeds 0.5.
     null when neither map has an instance. */
  function bpq(gt, answer, w, h) {
    var G = components(gt, gt, w, h), P = components(answer, gt, w, h);
    if (!G.n && !P.n) return null;
    var ag = new Float64Array(G.n + 1), ap = new Float64Array(P.n + 1), inter = {};
    for (var i = 0; i < w * h; i++) {
      var a = G.map[i], b = P.map[i];
      ag[a]++; ap[b]++;
      if (a && b) { var key = a * (P.n + 1) + b; inter[key] = (inter[key] || 0) + 1; }
    }
    var tp = 0, sum = 0;
    Object.keys(inter).forEach(function (key) {
      var a = Math.trunc(key / (P.n + 1)), b = key % (P.n + 1), iou = inter[key] / (ag[a] + ap[b] - inter[key]);
      if (iou > 0.5) { tp++; sum += iou; }
    });
    return sum / (tp + 0.5 * (P.n - tp) + 0.5 * (G.n - tp));
  }
  var api = { score: score, bpq: bpq, components: components };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HBMetrics = api;
})(typeof window !== "undefined" ? window : this);
