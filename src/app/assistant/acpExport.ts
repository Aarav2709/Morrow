import { markdownToDoc } from '../../core/markdown/parse';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { safeFileName } from '../../core/portability';
import { livePages } from '../../core/tree';
import { storeFiles } from '../platform/attachments';
import { desktop } from '../platform/desktop';
import { newId } from '../platform/files';
import type { Preferences } from '../platform/preferences';
import { openPage } from '../router';
import { getState, runAll } from '../workspace';

export interface ExportableAttachment {
  name: string;
  mimeType: string;
  kind: 'image' | 'audio';
  base64: string;
}

export type ExportableItem =
  | {
      kind: 'user';
      text: string;
      attachments?: ExportableAttachment[];
      mentions?: string[];
    }
  | { kind: 'assistant'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'plan'; entries: Array<{ content: string; status: string; priority?: string }> }
  | {
      kind: 'tool';
      title: string;
      toolKind?: string;
      status: string;
      output?: string;
      diff?: { path: string; oldText: string; newText: string };
      terminalOutput?: string;
      exitCode?: number | null;
    }
  | { kind: 'note'; text: string };

export interface ExportableSession {
  id: string;
  title: string;
  agentName: string;
  cwd: string;
  createdAt: number;
  items: ExportableItem[];
}

export function formatExportFilename(template: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const replaced = (template || 'agent_client_{date}_{time}')
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time);
  return safeFileName(replaced) || `agent_client_${date}_${time}`;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function saveMediaAttachment(
  att: ExportableAttachment,
  location: 'attachments' | 'export-folder' | 'custom',
  exportFolder: string,
  customPath: string,
): Promise<string> {
  const bytes = base64ToUint8Array(att.base64);
  const cleanName = safeFileName(att.name || (att.kind === 'image' ? 'image.png' : 'audio.webm'));
  const fileName = `${Date.now().toString(36)}-${cleanName}`;

  if (location === 'attachments') {
    const file = new File([bytes.slice().buffer as ArrayBuffer], cleanName, { type: att.mimeType });
    const stored = await storeFiles([file]);
    if (stored[0]) return `![[${stored[0].name}]]`;
  }

  const folder =
    location === 'custom' && customPath.trim()
      ? customPath
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '')
      : exportFolder
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '');
  const relPath = folder ? `${folder}/${fileName}` : fileName;
  if (desktop?.vault?.createFile) {
    await desktop.vault.createFile(relPath, bytes.slice().buffer as ArrayBuffer);
    return `![[${relPath}]]`;
  }
  return `\`[${att.kind}: ${cleanName}]\``;
}

function ensureFolderPage(folderPath: string): PageId | null {
  const segments = folderPath
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let parentId: PageId | null = null;
  for (const name of segments) {
    const state = getState();
    const existing = livePages(state.pages).find(
      (p) => p.parentId === parentId && displayTitle(p).toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const id = newId();
    const res = runAll([
      {
        type: 'page.create',
        id,
        parentId,
        title: name,
        kind: 'page',
        now: Date.now(),
      },
    ]);
    if (!res.ok) return parentId;
    parentId = id;
  }
  return parentId;
}

export async function renderSessionMarkdown(session: ExportableSession, prefs: Preferences): Promise<string> {
  const lines: string[] = [];
  lines.push(`**Agent:** ${session.agentName}`);
  lines.push(`**Working directory:** \`${session.cwd}\``);
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const item of session.items) {
    if (item.kind === 'user') {
      lines.push('## You');
      lines.push('');
      if (item.mentions && item.mentions.length > 0) {
        lines.push(`> Context: ${item.mentions.map((m) => `[[${m}]]`).join(', ')}`);
        lines.push('');
      }
      lines.push(item.text);
      if (item.attachments && item.attachments.length > 0) {
        lines.push('');
        for (const att of item.attachments) {
          if (att.kind === 'image' && !prefs.acpExportIncludeImages) continue;
          if (att.kind === 'audio' && !prefs.acpExportIncludeAudio) continue;
          const loc = att.kind === 'image' ? prefs.acpExportImageLocation : prefs.acpExportAudioLocation;
          const custom =
            att.kind === 'image' ? prefs.acpExportImageCustomPath : prefs.acpExportAudioCustomPath;
          const link = await saveMediaAttachment(att, loc, prefs.acpExportFolder, custom);
          lines.push(link);
        }
      }
      lines.push('');
    } else if (item.kind === 'assistant') {
      lines.push(`## ${session.agentName}`);
      lines.push('');
      lines.push(item.text);
      lines.push('');
    } else if (item.kind === 'thought') {
      lines.push('<details>');
      lines.push('<summary>Thought</summary>');
      lines.push('');
      lines.push(item.text);
      lines.push('');
      lines.push('</details>');
      lines.push('');
    } else if (item.kind === 'plan') {
      lines.push('### Plan');
      lines.push('');
      for (const entry of item.entries) {
        const mark = entry.status === 'completed' ? 'x' : ' ';
        lines.push(`- [${mark}] ${entry.content}`);
      }
      lines.push('');
    } else if (item.kind === 'tool') {
      lines.push(`> **Tool:** ${item.title} (${item.status})`);
      if (item.diff) {
        lines.push('');
        lines.push('```diff');
        lines.push(`--- ${item.diff.path}`);
        lines.push(`+++ ${item.diff.path}`);
        for (const line of item.diff.oldText.split('\n')) lines.push(`-${line}`);
        for (const line of item.diff.newText.split('\n')) lines.push(`+${line}`);
        lines.push('```');
      }
      if (item.terminalOutput) {
        lines.push('');
        lines.push('```text');
        lines.push(item.terminalOutput.trimEnd());
        lines.push('```');
      } else if (item.output) {
        lines.push('');
        lines.push('```text');
        lines.push(item.output.slice(0, 4000));
        lines.push('```');
      }
      lines.push('');
    } else if (item.kind === 'note') {
      lines.push(`> ${item.text}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function exportSessionToNote(
  session: ExportableSession,
  prefs: Preferences,
  options: { open?: boolean } = {},
): Promise<PageId | null> {
  if (session.items.length === 0) return null;
  const parentId = prefs.acpExportFolder.trim() ? ensureFolderPage(prefs.acpExportFolder) : null;
  const title = formatExportFilename(prefs.acpExportFilename, new Date());
  const markdown = await renderSessionMarkdown(session, prefs);
  const doc = markdownToDoc(markdown);
  const id = newId();
  const now = Date.now();
  const tag = prefs.acpExportTag.trim().replace(/^#/, '');

  const commands = [
    {
      type: 'page.create' as const,
      id,
      parentId,
      title,
      kind: 'page' as const,
      now,
    },
    {
      type: 'page.setDoc' as const,
      id,
      doc,
      now,
    },
    ...(tag
      ? [
          {
            type: 'page.setTags' as const,
            id,
            tags: [tag],
            now,
          },
        ]
      : []),
  ];

  const res = runAll(commands);
  if (!res.ok) return null;
  if (options.open ?? prefs.acpOpenAfterExport) openPage(id);
  return id;
}
