// Diagnostic (2026-10-27): Remote Desktop in a headset browser screen freezes and its cursor sits off the picture.
// Every second, logs (to the headset log, through Gecko's console in debug builds): how many animation frames the page
// drew, each <video>'s decoded/dropped frame counts and time, the remote picture's box and the remote cursor's box.
// A picture that stops while frames and the cursor keep going = the video stream stalled; frames stopping = the page
// itself was paused.
(function () {
  var raf = 0;
  (function tick() { raf++; requestAnimationFrame(tick); })();
  function box(e) { var r = e.getBoundingClientRect(); return Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height); }
  var lastV = {};
  function report() {
    var vids = Array.prototype.slice.call(document.querySelectorAll("video")).map(function (v, i) {
      var q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      var tot = q ? q.totalVideoFrames : -1, prev = lastV[i] == null ? tot : lastV[i]; lastV[i] = tot;
      return "v" + i + "[" + box(v) + " " + v.videoWidth + "x" + v.videoHeight + " rs=" + v.readyState + (v.paused ? " PAUSED" : "") +
        " t=" + v.currentTime.toFixed(1) + " frames+" + (tot - prev) + (q ? " dropped=" + q.droppedVideoFrames : "") + "]";
    });
    var cans = Array.prototype.slice.call(document.querySelectorAll("canvas")).filter(function (c) { var r = c.getBoundingClientRect(); return r.width > 0; })
      .map(function (c) { return "c[" + box(c) + "]"; });
    console.log("moduli-pagesize raf+" + raf + " inner=" + innerWidth + "x" + innerHeight + " vis=" + document.visibilityState + " " + vids.join(" ") + " " + cans.join(" "));
    raf = 0;
  }
  setInterval(report, 1000);
})();
