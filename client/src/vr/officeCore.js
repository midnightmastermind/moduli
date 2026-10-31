// vr/officeCore.js — what the headset's office shows, as plain functions with no React and no browser: bundled for
// the server (server/generated/officeCore.mjs, `npm run build:office-core`) so the server can answer the control
// panel without the panel loading the whole grid (user, 2026-10-26: "the control panel shouldnt load the entire grid").
export { shelfItems, folderShelfView, albumShelfItems, albumQueue, musicShelfView, showEpisodeItems } from "./shelfItems.js";
export { readOffice } from "./officeConfig.js";
export { decorLibrary } from "./decorLibrary.js";
export { occurrenceDisplayLabel } from "../helpers/occurrenceLabel";
export { nativeOfficeState, bookmarkBar, findBookmarksBoard, findDayPage, findNotesFolder, BOOKMARK_BAR_MAX, planShelfReorder } from "./officeState.js";
export { planFolderDelete } from "../helpers/folderDeletePlan";
