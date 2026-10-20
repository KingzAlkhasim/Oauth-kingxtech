import { strToU8, type Zippable } from 'fflate';
import { decodeBinaryContent } from './binaryFiles';

export function safeName(value: string, fallback: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return cleaned || fallback;
}

// Turns stored project rows into zip entries. Binary files are stored as base64 with a
// marker prefix; everything else is text.
export function projectFilesToZippable(files: { path: string; content: string | null }[]): Zippable {
  const out: Zippable = {};
  for (const file of files) {
    if (!file.path || file.path.includes('..') || file.path.startsWith('/')) continue;
    let bytes: Uint8Array;
    try {
      const binary = file.content ? decodeBinaryContent(file.content) : null;
      bytes = binary ? new Uint8Array(binary) : strToU8(file.content ?? '');
    } catch {
      bytes = strToU8(file.content ?? '');
    }
    out[file.path] = bytes;
  }
  return out;
}
