// password protected pages: the whole page file is encrypted, only the settings needed to decrypt it stay readable
import { isRecord } from './doc';
import { splitFrontmatter } from './vault/frontmatter';

export const CIPHER = 'aes-256-gcm';
const KDF = 'pbkdf2-sha256';
export const ITERATIONS = 600_000;
const MARKER = 'morrow-encrypted';

export interface PageKey {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
}

const subtle = () => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Encryption is not available here.');
  return api;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = ITERATIONS,
): Promise<PageKey> {
  const material = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, salt, iterations };
}

export async function newPageKey(password: string): Promise<PageKey> {
  return deriveKey(password, globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

export interface EncryptedHeader {
  salt: Uint8Array;
  iv: Uint8Array;
  iterations: number;
  body: string;
}

// reads the plain settings at the top of an encrypted page, null for an ordinary page
export function readEncrypted(text: string): EncryptedHeader | null {
  // most pages are not encrypted, a quick look spares parsing their frontmatter twice on every load
  if (!text.includes(MARKER)) return null;
  const split = splitFrontmatter(text);
  const data = split.data;
  if (!data || !isRecord(data) || data[MARKER] !== CIPHER) return null;
  try {
    const iterations =
      typeof data.iterations === 'number' && data.iterations >= 100_000 ? data.iterations : ITERATIONS;
    return {
      salt: fromBase64(String(data.salt ?? '')),
      iv: fromBase64(String(data.iv ?? '')),
      iterations,
      body: split.body.trim(),
    };
  } catch {
    return null;
  }
}

export function isEncryptedText(text: string): boolean {
  return readEncrypted(text) !== null;
}

// the file that goes to disk: settings to decrypt it, then the encrypted page as base64
export async function encryptPage(plain: string, pageKey: PageKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      pageKey.key,
      new TextEncoder().encode(plain),
    ),
  );
  const lines = toBase64(cipher).match(/.{1,76}/g) ?? [''];
  return [
    '---',
    `${MARKER}: ${CIPHER}`,
    `kdf: ${KDF}`,
    `iterations: ${pageKey.iterations}`,
    `salt: ${toBase64(pageKey.salt)}`,
    `iv: ${toBase64(iv)}`,
    '---',
    'This page is encrypted with a password in Morrow.',
    '',
    ...lines,
    '',
  ].join('\n');
}

// null when the password is wrong or the file was changed
export async function decryptPage(
  text: string,
  password: string,
): Promise<{ plain: string; pageKey: PageKey } | null> {
  const header = readEncrypted(text);
  if (!header) return null;
  const pageKey = await deriveKey(password, header.salt, header.iterations);
  const body = header.body
    .split('\n')
    .filter((line) => /^[A-Za-z0-9+/=]+$/.test(line.trim()))
    .join('');
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: header.iv as BufferSource },
      pageKey.key,
      fromBase64(body) as BufferSource,
    );
    return { plain: new TextDecoder().decode(plain), pageKey };
  } catch {
    return null;
  }
}
