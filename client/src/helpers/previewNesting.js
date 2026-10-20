// helpers/previewNesting.js
//
// True inside a preview card's body. A preview of a FOLDER page draws that
// folder's cards, and each card used to mount its own live preview — which,
// for a sub-folder, drew ITS cards' previews, and so on all the way down. A
// nested card is shown at a few pixels wide, so it gets its cover, its file,
// or its type icon instead of another live page render.
import { createContext } from "react";

export const PreviewNestingContext = createContext(false);
