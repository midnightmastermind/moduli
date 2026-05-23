// helpers/uploadWithProgress.js
// XMLHttpRequest-backed upload that surfaces byte-level progress + supports
// AbortSignal cancellation. fetch() can't do either uniformly across browsers,
// so the file-drop flow uses this when it needs progress + cancel
// (file/artifact audit gaps #7 + #8).
//
// uploadFileWithProgress({ url, formData, onProgress, signal })
//   → Promise<JSON-parsed response>
//
// onProgress receives a number in [0..1] (lengthComputable progress events
// only — uploads without Content-Length never tick, which is fine for our
// FormData uploads since FormData always knows its size).
//
// signal: standard AbortSignal. If pre-aborted, the promise rejects
// immediately with a DOMException("aborted","AbortError"). Otherwise an
// abort during flight cancels the XHR and rejects with the same error.

export function uploadFileWithProgress({ url, formData, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (typeof onProgress === "function") {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(xhr.statusText || `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    const onAbort = () => xhr.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    xhr.send(formData);
  });
}

// Module-level registry of in-flight uploads keyed by the placeholder
// occurrence id. Lets the placeholder card find + invoke the AbortController
// without having to thread refs through React props.
const inFlightByOccurrenceId = new Map();

export function registerUpload(occurrenceId, controller) {
  if (!occurrenceId || !controller) return;
  inFlightByOccurrenceId.set(occurrenceId, controller);
}

export function clearUpload(occurrenceId) {
  if (!occurrenceId) return;
  inFlightByOccurrenceId.delete(occurrenceId);
}

export function getUploadController(occurrenceId) {
  return inFlightByOccurrenceId.get(occurrenceId) || null;
}
