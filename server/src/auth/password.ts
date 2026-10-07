import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// stored as scrypt$N$r$p$salt$hash (base64), so the cost can be raised later and old hashes still verify
const N = 2 ** 16;
const R = 8;
const P = 1;
const KEYLEN = 64;
const maxmem = (n: number, r: number) => 128 * n * r * 2;

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200; // scrypt is slow on purpose: don't let a request make it chew on megabytes

/** Why a password is not acceptable, or null. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Parool puudub.';
  if (pw.length < MIN_PASSWORD) return `Parool peab olema vähemalt ${MIN_PASSWORD} märki.`;
  if (pw.length > MAX_PASSWORD) return `Parool on liiga pikk (kuni ${MAX_PASSWORD} märki).`;
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash || pw.length > MAX_PASSWORD) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: +n, r: +r, p: +p, maxmem: maxmem(+n, +r),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// verified against when the user name is unknown, so a login takes as long either way
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(18).toString('base64')));
