import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function decodeBase64Utf8(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8');
}

function decodeTextChunk(bytes: Uint8Array, compressionFlag: number): string {
  if (compressionFlag === 0) {
    return new TextDecoder().decode(bytes);
  }
  return new TextDecoder().decode(inflateSync(bytes));
}

function readNullTerminated(bytes: Uint8Array, start: number): { value: string; next: number } {
  const end = bytes.indexOf(0, start);
  if (end < 0) {
    return { value: new TextDecoder().decode(bytes.slice(start)), next: bytes.length };
  }
  return {
    value: new TextDecoder().decode(bytes.slice(start, end)),
    next: end + 1,
  };
}

export function readPngTextChunks(bytes: Uint8Array): Record<string, string> {
  if (!isPngBytes(bytes)) {
    throw new Error('Not a valid PNG image');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text: Record<string, string> = {};
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    const data = bytes.slice(dataStart, dataEnd);

    if (type === 'tEXt') {
      const keywordEnd = data.indexOf(0);
      if (keywordEnd >= 0) {
        const keyword = new TextDecoder().decode(data.slice(0, keywordEnd));
        const value = new TextDecoder().decode(data.slice(keywordEnd + 1));
        text[keyword] = value;
      }
    } else if (type === 'iTXt') {
      const keyword = readNullTerminated(data, 0);
      let cursor = keyword.next;
      if (cursor + 1 < data.length) {
        const compressionFlag = data[cursor];
        cursor += 2; // compression flag + compression method
        const language = readNullTerminated(data, cursor);
        cursor = language.next;
        const translatedKeyword = readNullTerminated(data, cursor);
        cursor = translatedKeyword.next;
        const textBytes = data.slice(cursor);
        text[keyword.value] = decodeTextChunk(textBytes, compressionFlag);
      }
    }

    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  return text;
}

function decodeCharacterCardPayload(encoded: string): unknown {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error('No character card data found in PNG');
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as unknown;
  }

  const json = decodeBase64Utf8(trimmed);
  return JSON.parse(json) as unknown;
}

export function decodeCharacterCardJsonFromPng(bytes: Uint8Array): unknown {
  const chunks = readPngTextChunks(bytes);
  const encoded = chunks.chara ?? chunks.ccv3 ?? chunks.ccv2 ?? chunks.ccv;
  if (!encoded?.trim()) {
    throw new Error('No character card data found in PNG');
  }

  return decodeCharacterCardPayload(encoded);
}