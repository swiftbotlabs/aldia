// EIP-55 address checksums, so a mistyped address is refused before it becomes a landlord who can never be paid.
// Keccak-256 (the original padding Ethereum uses, not SHA3-256), on 32-bit halves of each 64-bit lane.
const RC = [
  [0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808a, 0x80000000], [0x80008000, 0x80000000],
  [0x0000808b, 0x00000000], [0x80000001, 0x00000000], [0x80008081, 0x80000000], [0x00008009, 0x80000000],
  [0x0000008a, 0x00000000], [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000a, 0x00000000],
  [0x8000808b, 0x00000000], [0x0000008b, 0x80000000], [0x00008089, 0x80000000], [0x00008003, 0x80000000],
  [0x00008002, 0x80000000], [0x00000080, 0x80000000], [0x0000800a, 0x00000000], [0x8000000a, 0x80000000],
  [0x80008081, 0x80000000], [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function rotl(lo, hi, n) {
  if (n === 0) return [lo, hi];
  if (n === 32) return [hi, lo];
  if (n < 32) return [((lo << n) | (hi >>> (32 - n))) >>> 0, ((hi << n) | (lo >>> (32 - n))) >>> 0];
  const m = n - 32;
  return [((hi << m) | (lo >>> (32 - m))) >>> 0, ((lo << m) | (hi >>> (32 - m))) >>> 0];
}

function permute(s) {
  const c = new Uint32Array(10);
  const b = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      c[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      c[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const p = (x + 4) % 5;
      const [rl, rh] = rotl(c[2 * ((x + 1) % 5)], c[2 * ((x + 1) % 5) + 1], 1);
      const dl = c[2 * p] ^ rl;
      const dh = c[2 * p + 1] ^ rh;
      for (let y = 0; y < 5; y++) {
        s[2 * (x + 5 * y)] ^= dl;
        s[2 * (x + 5 * y) + 1] ^= dh;
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        const [l, h] = rotl(s[2 * i], s[2 * i + 1], ROT[i]);
        b[2 * j] = l;
        b[2 * j + 1] = h;
      }
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const i = x + 5 * y;
        const i1 = ((x + 1) % 5) + 5 * y;
        const i2 = ((x + 2) % 5) + 5 * y;
        s[2 * i] = b[2 * i] ^ (~b[2 * i1] & b[2 * i2]);
        s[2 * i + 1] = b[2 * i + 1] ^ (~b[2 * i1 + 1] & b[2 * i2 + 1]);
      }
    }
    s[0] ^= RC[round][0];
    s[1] ^= RC[round][1];
  }
}

export function keccak256(bytes) {
  const rate = 136;
  const s = new Uint32Array(50);
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let k = 0; k < rate; k++) {
      const lane = k >> 3;
      const shift = (k & 3) * 8;
      s[2 * lane + ((k & 4) ? 1 : 0)] ^= padded[off + k] << shift;
    }
    permute(s);
  }
  const out = new Uint8Array(32);
  for (let k = 0; k < 32; k++) out[k] = (s[2 * (k >> 3) + ((k & 4) ? 1 : 0)] >>> ((k & 3) * 8)) & 0xff;
  return out;
}

export const hex = (u8) => [...u8].map((x) => x.toString(16).padStart(2, "0")).join("");

export function toChecksum(address) {
  const a = address.toLowerCase().replace(/^0x/, "");
  const h = hex(keccak256(new TextEncoder().encode(a)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}

// All-lowercase and all-uppercase addresses carry no checksum and pass; mixed case must match EIP-55 exactly.
export function checksumOk(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksum(address) === address;
}
