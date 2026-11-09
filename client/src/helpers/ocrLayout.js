// The OCR layout rules live in server/utils/ocrLayout.js so the server's import eval and the client's
// OCR Reader / OCR Magic views run the same code (the client already imports server utils this way).
export * from "../../../server/utils/ocrLayout.js";
