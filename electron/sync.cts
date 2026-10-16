// sync between your own computers on the same network: no server, no account, every request encrypted
import { app } from 'electron';
import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import type { Socket } from 'node:dgram';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import { currentVault, isSyncedPath, syncedFileBase64, vaultIdentity, vaultManifest } from './vault.cjs';

const PORT = 47610;
const DISCOVERY_PORT = 47611;
const BROADCAST_MS = 4000;
const ONLINE_MS = 15_000;
const MAX_SKEW_MS = 5 * 60 * 1000;
const PAIRING_MS = 10 * 60 * 1000;
const MAX_BODY = 300 * 1024 * 1024;
const ID = /^[\w-]{8,64}$/;

interface Peer {
  id: string;
  name: string;
  // base64 shared secret agreed when the two computers were paired
  secret: string;
  address?: string;
  port?: number;
  lastSync?: number;
}

interface SyncConfig {
  deviceId: string;
  name: string;
  enabled: boolean;
  peers: Peer[];
}

interface Seen {
  id: string;
  address: string;
  port: number;
  at: number;
  // set while that computer is waiting to be paired
  pairingName: string | null;
}

export type SyncEvent =
  | { type: 'pull-requested'; peerId: string }
  | { type: 'paired'; peerId: string; name: string }
  | { type: 'changed' };

let config: SyncConfig | null = null;
let server: Server | null = null;
let socket: Socket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let notify: (event: SyncEvent) => void = () => {};
const seen = new Map<string, Seen>();
// when each paired computer last answered or asked something, networks that block broadcasts still work
const contact = new Map<string, number>();
const nonces = new Map<string, number>();
let pairing: { code: string; key: Buffer; expires: number; attempts: number } | null = null;
let listeningPort = PORT;

const configFile = () => path.join(app.getPath('userData'), 'sync.json');

async function loadConfig(): Promise<SyncConfig> {
  if (config) return config;
  try {
    const raw = JSON.parse(await readFile(configFile(), 'utf8')) as Partial<SyncConfig>;
    config = {
      deviceId: typeof raw.deviceId === 'string' && ID.test(raw.deviceId) ? raw.deviceId : randomUUID(),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 60) : hostname(),
      enabled: raw.enabled === true,
      peers: Array.isArray(raw.peers)
        ? raw.peers.filter((peer) => peer && ID.test(peer.id) && typeof peer.secret === 'string')
        : [],
    };
  } catch {
    config = { deviceId: randomUUID(), name: hostname(), enabled: false, peers: [] };
  }
  return config;
}

async function saveConfig(): Promise<void> {
  if (!config) return;
  const file = configFile();
  await writeFile(`${file}.tmp`, JSON.stringify(config, null, 1), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

// ---- encryption: aes-256-gcm with a key only the two paired computers know

function peerKey(peer: Peer): Buffer {
  const ids = [config!.deviceId, peer.id].sort().join('|');
  return Buffer.from(hkdfSync('sha256', Buffer.from(peer.secret, 'base64'), 'morrow-sync-v1', ids, 32));
}

function pairingKey(code: string, deviceId: string): Buffer {
  const normal = code.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return pbkdf2Sync(normal, `morrow-pair:${deviceId}`, 200_000, 32, 'sha256');
}

function seal(key: Buffer, payload: unknown): { iv: string; data: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = JSON.stringify({ ts: Date.now(), nonce: randomBytes(12).toString('base64'), payload });
  const data = Buffer.concat([cipher.update(body, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString('base64'), data: data.toString('base64') };
}

// throws when the message was not made with this key, is old, or was seen before
function open(key: Buffer, envelope: { iv?: unknown; data?: unknown }): unknown {
  if (typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') throw new Error('Bad message.');
  const data = Buffer.from(envelope.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(data.subarray(data.length - 16));
  const text = Buffer.concat([
    decipher.update(data.subarray(0, data.length - 16)),
    decipher.final(),
  ]).toString('utf8');
  const message = JSON.parse(text) as { ts: number; nonce: string; payload: unknown };
  if (Math.abs(Date.now() - message.ts) > MAX_SKEW_MS) throw new Error('Message too old, check both clocks.');
  if (nonces.has(message.nonce)) throw new Error('Message replayed.');
  nonces.set(message.nonce, Date.now());
  for (const [nonce, at] of nonces) if (Date.now() - at > MAX_SKEW_MS * 2) nonces.delete(nonce);
  return message.payload;
}

// ---- the server other paired computers talk to

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const cfg = await loadConfig();
  if (request.method === 'GET' && request.url === '/morrow/v1/id') {
    // only says who it is while it is waiting to be paired
    if (!pairing) return reply(response, 404, {});
    return reply(response, 200, { id: cfg.deviceId, name: cfg.name });
  }
  if (request.method !== 'POST' || request.url !== '/morrow/v1') return reply(response, 404, {});
  let body: { from?: unknown; pair?: unknown; iv?: unknown; data?: unknown };
  try {
    body = JSON.parse(await readBody(request)) as typeof body;
  } catch {
    return reply(response, 400, {});
  }

  if (body.pair === true) {
    if (!pairing || Date.now() > pairing.expires)
      return reply(response, 403, { error: 'This computer is not waiting to pair.' });
    if (++pairing.attempts > 5) {
      pairing = null;
      return reply(response, 403, { error: 'Too many tries, start pairing again.' });
    }
    try {
      const payload = open(pairing.key, body) as {
        deviceId?: unknown;
        name?: unknown;
        secret?: unknown;
        port?: unknown;
      };
      if (
        typeof payload.deviceId !== 'string' ||
        !ID.test(payload.deviceId) ||
        typeof payload.secret !== 'string'
      )
        throw new Error('Bad pairing.');
      const peer: Peer = {
        id: payload.deviceId,
        name: typeof payload.name === 'string' ? payload.name.slice(0, 60) : 'Computer',
        secret: payload.secret,
        address: request.socket.remoteAddress?.replace(/^::ffff:/, ''),
        ...(typeof payload.port === 'number' ? { port: payload.port } : {}),
      };
      contact.set(peer.id, Date.now());
      cfg.peers = [...cfg.peers.filter((item) => item.id !== peer.id), peer];
      await saveConfig();
      const key = pairing.key;
      pairing = null;
      notify({ type: 'paired', peerId: peer.id, name: peer.name });
      return reply(response, 200, seal(key, { deviceId: cfg.deviceId, name: cfg.name }));
    } catch {
      return reply(response, 403, { error: 'That code is not right.' });
    }
  }

  const peer = cfg.peers.find((item) => item.id === body.from);
  if (!peer || !cfg.enabled) return reply(response, 403, {});
  const key = peerKey(peer);
  let payload: { op?: unknown; vaultId?: unknown; path?: unknown; port?: unknown };
  try {
    payload = open(key, body) as typeof payload;
  } catch {
    return reply(response, 403, {});
  }
  // the address the request came from, and the port the other computer listens on
  const address = request.socket.remoteAddress?.replace(/^::ffff:/, '');
  if (address) peer.address = address;
  if (typeof payload.port === 'number' && payload.port > 0 && payload.port < 65536) peer.port = payload.port;
  contact.set(peer.id, Date.now());
  const send = (value: unknown) => reply(response, 200, seal(key, value));
  try {
    switch (payload.op) {
      case 'hello': {
        const vault = currentVault() ? await vaultIdentity() : null;
        return send({
          deviceId: cfg.deviceId,
          name: cfg.name,
          vaultId: vault?.id ?? null,
          vaultName: vault?.name ?? null,
        });
      }
      case 'manifest': {
        const vault = await vaultIdentity();
        if (payload.vaultId !== vault.id) return send({ error: 'different vault' });
        return send({ manifest: await vaultManifest() });
      }
      case 'get': {
        const vault = await vaultIdentity();
        if (payload.vaultId !== vault.id || typeof payload.path !== 'string' || !isSyncedPath(payload.path))
          return send({ error: 'not allowed' });
        return send({ data: await syncedFileBase64(payload.path) });
      }
      case 'pull':
        // the other computer has changes, this one fetches them
        notify({ type: 'pull-requested', peerId: peer.id });
        return send({ ok: true });
      default:
        return send({ error: 'unknown' });
    }
  } catch (error) {
    return send({ error: error instanceof Error ? error.message : 'failed' });
  }
}

async function startServer(): Promise<void> {
  if (server) return;
  for (const port of [PORT, PORT + 2, PORT + 3, 0]) {
    const candidate = createServer(
      (request, response) => void handle(request, response).catch(() => reply(response, 500, {})),
    );
    const ok = await new Promise<boolean>((resolve) => {
      candidate.once('error', () => resolve(false));
      candidate.listen(port, '0.0.0.0', () => resolve(true));
    });
    if (ok) {
      server = candidate;
      const address = candidate.address();
      listeningPort = typeof address === 'object' && address ? address.port : port;
      return;
    }
  }
}

function stopServer(): void {
  server?.close();
  server = null;
}

// ---- finding each other on the network

function broadcastAddresses(): string[] {
  const result = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const ip = item.address.split('.').map(Number);
      const mask = item.netmask.split('.').map(Number);
      result.add(ip.map((part, i) => (part | (~mask[i]! & 255)) >>> 0).join('.'));
    }
  }
  return [...result];
}

function announce(): void {
  if (!socket || !config) return;
  // a name is only shared while this computer is waiting to be paired
  const message = Buffer.from(
    JSON.stringify({
      app: 'morrow-sync',
      v: 1,
      id: config.deviceId,
      port: listeningPort,
      pairing: pairing ? config.name : null,
    }),
  );
  for (const address of broadcastAddresses()) socket.send(message, DISCOVERY_PORT, address, () => undefined);
}

function startDiscovery(): void {
  if (socket) return;
  socket = createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', () => undefined);
  socket.on('message', (raw, info) => {
    try {
      const message = JSON.parse(raw.toString('utf8')) as {
        app?: unknown;
        id?: unknown;
        port?: unknown;
        pairing?: unknown;
      };
      if (message.app !== 'morrow-sync' || typeof message.id !== 'string' || !ID.test(message.id)) return;
      if (message.id === config?.deviceId) return;
      seen.set(message.id, {
        id: message.id,
        address: info.address,
        port: typeof message.port === 'number' ? message.port : PORT,
        at: Date.now(),
        pairingName: typeof message.pairing === 'string' ? message.pairing.slice(0, 60) : null,
      });
    } catch {
      // not for us
    }
  });
  socket.bind(DISCOVERY_PORT, () => {
    socket?.setBroadcast(true);
    announce();
  });
  timer = setInterval(announce, BROADCAST_MS);
}

function stopDiscovery(): void {
  if (timer) clearInterval(timer);
  timer = null;
  socket?.close();
  socket = null;
}

async function refreshServices(): Promise<void> {
  const cfg = await loadConfig();
  if (cfg.enabled || pairing) {
    await startServer();
    startDiscovery();
  } else {
    stopServer();
    stopDiscovery();
  }
}

function listeningPortAfterStart(): number {
  return listeningPort;
}

// ---- what the app asks for

export async function initSync(onEvent: (event: SyncEvent) => void): Promise<void> {
  notify = onEvent;
  await loadConfig();
  await refreshServices();
}

export async function syncStatus() {
  const cfg = await loadConfig();
  const now = Date.now();
  return {
    enabled: cfg.enabled,
    name: cfg.name,
    deviceId: cfg.deviceId,
    pairingCode: pairing && pairing.expires > now ? pairing.code : null,
    peers: cfg.peers.map((peer) => {
      const found = seen.get(peer.id);
      const recent = (contact.get(peer.id) ?? 0) > now - 3 * 60 * 1000;
      return {
        id: peer.id,
        name: peer.name,
        online: (!!found && now - found.at < ONLINE_MS) || recent,
        // worth trying even when broadcasts do not get through, as long as it was reached before
        reachable: (!!found && now - found.at < ONLINE_MS) || !!peer.address,
        lastSync: peer.lastSync ?? null,
      };
    }),
    waiting: [...seen.values()]
      .filter(
        (item) =>
          item.pairingName && now - item.at < ONLINE_MS && !cfg.peers.some((peer) => peer.id === item.id),
      )
      .map((item) => ({ id: item.id, name: item.pairingName!, address: item.address, port: item.port })),
  };
}

export async function setSyncEnabled(enabled: boolean): Promise<void> {
  const cfg = await loadConfig();
  cfg.enabled = enabled === true;
  await saveConfig();
  await refreshServices();
}

export async function setDeviceName(name: string): Promise<void> {
  const cfg = await loadConfig();
  const clean = String(name).trim().slice(0, 60);
  if (!clean) return;
  cfg.name = clean;
  await saveConfig();
}

// shows a code the other computer types in, valid for ten minutes
export async function startPairing(): Promise<string> {
  const cfg = await loadConfig();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = randomBytes(16);
  const raw = [...bytes].map((byte) => alphabet[byte % 32]).join('');
  const code = raw.match(/.{4}/g)!.join('-');
  pairing = { code, key: pairingKey(code, cfg.deviceId), expires: Date.now() + PAIRING_MS, attempts: 0 };
  await refreshServices();
  announce();
  return code;
}

export async function stopPairing(): Promise<void> {
  pairing = null;
  await refreshServices();
}

export async function pairWith(
  target: { id?: string; address: string; port?: number },
  code: string,
): Promise<{ ok: boolean; error?: string; name?: string }> {
  const cfg = await loadConfig();
  const port = target.port ?? PORT;
  let id = target.id;
  try {
    if (!id) {
      const answer = await fetch(`http://${target.address}:${port}/morrow/v1/id`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!answer.ok) return { ok: false, error: 'That computer is not waiting to pair.' };
      id = ((await answer.json()) as { id?: string }).id;
    }
    if (!id || !ID.test(id)) return { ok: false, error: 'That computer did not answer.' };
    // this computer starts listening first, so the other one learns where to reach it
    cfg.enabled = true;
    await refreshServices();
    const key = pairingKey(code, id);
    const secret = randomBytes(32).toString('base64');
    const response = await fetch(`http://${target.address}:${port}/morrow/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pair: true,
        ...seal(key, { deviceId: cfg.deviceId, name: cfg.name, secret, port: listeningPortAfterStart() }),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await response.json()) as { error?: string; iv?: string; data?: string };
    if (!response.ok) return { ok: false, error: body.error ?? 'Pairing failed.' };
    const other = open(key, body) as { deviceId: string; name: string };
    if (other.deviceId !== id) return { ok: false, error: 'Pairing failed.' };
    cfg.peers = [
      ...cfg.peers.filter((peer) => peer.id !== id),
      { id, name: other.name, secret, address: target.address, port },
    ];
    contact.set(id, Date.now());
    await saveConfig();
    return { ok: true, name: other.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Pairing failed.' };
  }
}

export async function forgetPeer(id: string): Promise<void> {
  const cfg = await loadConfig();
  cfg.peers = cfg.peers.filter((peer) => peer.id !== id);
  await saveConfig();
}

// one encrypted request to a paired computer
export async function requestPeer(peerId: string, payload: Record<string, unknown>): Promise<unknown> {
  const cfg = await loadConfig();
  const peer = cfg.peers.find((item) => item.id === peerId);
  if (!peer) throw new Error('That computer is not paired.');
  const found = seen.get(peer.id);
  const address = found?.address ?? peer.address;
  const port = found?.port ?? peer.port ?? PORT;
  if (!address) throw new Error(`${peer.name} has not been seen on this network.`);
  const key = peerKey(peer);
  const response = await fetch(`http://${address}:${port}/morrow/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.deviceId, ...seal(key, { ...payload, port: listeningPort }) }),
    signal: AbortSignal.timeout(payload.op === 'get' ? 120_000 : 30_000),
  });
  if (!response.ok) throw new Error(`${peer.name} refused the request. Is sync turned on there?`);
  const result = open(key, (await response.json()) as { iv?: unknown; data?: unknown });
  contact.set(peer.id, Date.now());
  if (address !== peer.address || port !== peer.port) {
    peer.address = address;
    peer.port = port;
    await saveConfig();
  }
  return result;
}

export async function markSynced(peerId: string): Promise<void> {
  const cfg = await loadConfig();
  const peer = cfg.peers.find((item) => item.id === peerId);
  if (!peer) return;
  peer.lastSync = Date.now();
  await saveConfig();
  notify({ type: 'changed' });
}

export function closeSync(): void {
  stopServer();
  stopDiscovery();
}
