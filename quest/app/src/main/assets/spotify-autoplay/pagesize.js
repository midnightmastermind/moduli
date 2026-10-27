// Diagnostic (2026-10-27): Remote Desktop in a headset browser screen is cut off at the bottom and right even with
// "Scale to fit" on. Logs the page's window and the size/position of the remote picture (its largest video/canvas),
// to the headset log through Gecko's console output (debug builds).
(function () {
  function box(e) { var r = e.getBoundingClientRect(); return e.tagName + "[" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + "]" + (e.videoWidth ? " src=" + e.videoWidth + "x" + e.videoHeight : "") + (e.width && e.tagName === "CANVAS" ? " buf=" + e.width + "x" + e.height : ""); }
  function report(why) {
    var els = Array.prototype.slice.call(document.querySelectorAll("video,canvas"));
    els.sort(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
    var vv = window.visualViewport;
    console.log("moduli-pagesize " + why + " inner=" + innerWidth + "x" + innerHeight + " dpr=" + devicePixelRatio +
      (vv ? " visual=" + Math.round(vv.width) + "x" + Math.round(vv.height) + "@" + vv.scale.toFixed(2) : "") +
      " scroll=" + scrollX + "," + scrollY + " doc=" + document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight +
      " media=" + els.slice(0, 3).map(box).join(" "));
  }
  window.addEventListener("resize", function () { report("resize"); });
  setInterval(function () { report("tick"); }, 4000);
})();
