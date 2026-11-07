import { TextDecoder } from "node:util";

export function decodeProjectText(bytes: Buffer): string | null {
  let encoding = "utf-8";
  let offset = 0;
  if (bytes[0] === 255 && bytes[1] === 254) { encoding = "utf-16le"; offset = 2; }
  else if (bytes[0] === 254 && bytes[1] === 255) { encoding = "utf-16be"; offset = 2; }
  else if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) offset = 3;
  if (offset === 0 && bytes.includes(0)) return null;
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)); }
  catch {
    if (offset !== 0) throw new Error("INVALID_TEXT_ENCODING");
    return null;
  }
}
