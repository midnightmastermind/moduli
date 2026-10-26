// The record player opens a song as …/embed/track/<id>#autoplay: press Spotify's play button once it is there, so
// the next song of an album starts by itself. (The app allows autoplay on its browser screens.)
(function () {
  if (!/autoplay/.test(location.hash)) return;
  var tries = 0;
  var t = setInterval(function () {
    var b = document.querySelector('[data-testid="play-pause-button"]')
      || document.querySelector('button[aria-label="Play"]')
      || document.querySelector('button[title="Play"]');
    if (b) {
      clearInterval(t);
      var label = (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase();
      if (label.indexOf("pause") < 0) b.click();
    }
    if (++tries > 60) clearInterval(t);
  }, 250);
})();
