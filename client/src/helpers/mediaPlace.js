// helpers/mediaPlace.js
// ============================================================
// Where a video or audio file was left, so it opens there again (user, 2026-10-18: "make files have
// an autosave place (so video time for videos, books page, audio time, etc)"). Books already keep
// `meta.readingPosition` (BookReader); media keeps `meta.playbackPosition = { time, duration, at }` on
// the FILE's module, so every placement of the file and every device shares one place.
// ============================================================

/** Seconds below which there is nothing worth resuming. */
export const RESUME_MIN_S = 3;
/** Seconds from the end that count as finished (the next open starts over). */
export const FINISHED_WITHIN_S = 5;
/** How far the playhead has to move before the place is written again. */
export const SAVE_EVERY_S = 5;

export function makePlaybackPosition({ time, duration, now = Date.now() }) {
  const pos = { time: Math.max(0, Math.round(Number(time) * 10) / 10), at: new Date(now).toISOString() };
  if (Number.isFinite(duration) && duration > 0) pos.duration = Math.round(duration * 10) / 10;
  return pos;
}

/** The time to start from, or null (nothing saved, barely started, or finished). */
export function resumeTimeFor(saved, duration) {
  const t = Number(saved?.time);
  if (!Number.isFinite(t) || t < RESUME_MIN_S) return null;
  const d = Number.isFinite(duration) && duration > 0 ? duration : Number(saved?.duration);
  if (Number.isFinite(d) && d > 0 && t >= d - FINISHED_WITHIN_S) return null;
  if (Number.isFinite(duration) && duration > 0 && t > duration) return null;
  return t;
}

/** Whether `time` is far enough from the last written place to write again. */
export function movedEnough(lastTime, time, every = SAVE_EVERY_S) {
  if (!Number.isFinite(time)) return false;
  if (!Number.isFinite(lastTime)) return true;
  return Math.abs(time - lastTime) >= every;
}
