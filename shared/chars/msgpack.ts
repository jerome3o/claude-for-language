/**
 * A minimal MessagePack decoder — just enough for wordfreq's `*.msgpack.gz` word lists
 * (arrays, maps, strings, ints, floats, nil / booleans), so the dictionary build script
 * needs no extra dependency. Throws on anything it doesn't know (ext types, bin).
 */
export function decodeMsgpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8 = new TextDecoder('utf-8');
  let pos = 0;

  const str = (len: number): string => {
    const s = utf8.decode(bytes.subarray(pos, pos + len));
    pos += len;
    return s;
  };
  const arr = (len: number): unknown[] => {
    const out: unknown[] = new Array(len);
    for (let i = 0; i < len; i++) out[i] = read();
    return out;
  };
  const map = (len: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const k = read();
      out[String(k)] = read();
    }
    return out;
  };

  function read(): unknown {
    if (pos >= bytes.length) throw new Error('msgpack: unexpected end of data');
    const b = bytes[pos++];
    if (b <= 0x7f) return b;
    if (b >= 0xe0) return b - 0x100;
    if ((b & 0xf0) === 0x80) return map(b & 0x0f);
    if ((b & 0xf0) === 0x90) return arr(b & 0x0f);
    if ((b & 0xe0) === 0xa0) return str(b & 0x1f);
    let v: unknown;
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: v = view.getFloat32(pos); pos += 4; return v;
      case 0xcb: v = view.getFloat64(pos); pos += 8; return v;
      case 0xcc: return bytes[pos++];
      case 0xcd: v = view.getUint16(pos); pos += 2; return v;
      case 0xce: v = view.getUint32(pos); pos += 4; return v;
      case 0xd0: v = view.getInt8(pos); pos += 1; return v;
      case 0xd1: v = view.getInt16(pos); pos += 2; return v;
      case 0xd2: v = view.getInt32(pos); pos += 4; return v;
      case 0xd9: { const n = bytes[pos++]; return str(n); }
      case 0xda: { const n = view.getUint16(pos); pos += 2; return str(n); }
      case 0xdb: { const n = view.getUint32(pos); pos += 4; return str(n); }
      case 0xdc: { const n = view.getUint16(pos); pos += 2; return arr(n); }
      case 0xdd: { const n = view.getUint32(pos); pos += 4; return arr(n); }
      case 0xde: { const n = view.getUint16(pos); pos += 2; return map(n); }
      case 0xdf: { const n = view.getUint32(pos); pos += 4; return map(n); }
      default: throw new Error(`msgpack: unsupported type 0x${b.toString(16)}`);
    }
  }
  return read();
}
