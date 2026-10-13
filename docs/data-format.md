# Morrow data format

This describes how Morrow stores your work and the backup file it writes. From
1.0 on, the format is a promise: every 1.x release can open data and backups
written by any earlier release, including 0.1 and 0.2. Breaking changes need a
new major version and an automatic migration.

## Where it lives

The desktop app keeps everything in an IndexedDB database named `morrow` inside
its data folder: `%APPDATA%\Morrow` on Windows, `~/Library/Application Support/Morrow`
on macOS and `~/.config/Morrow` on Linux. Automatic backups are written to the
`Backups` folder next to it.

## Database, version 2

| Store     | Key     | Value                                                          |
| --------- | ------- | -------------------------------------------------------------- |
| `pages`   | page id | Page metadata, see below                                       |
| `docs`    | page id | `{ id, doc }`, the page content as a document tree             |
| `files`   | file id | `{ id, name, type, size, createdAt, data }`, data is raw bytes |
| `history` | id      | `{ id, pageId, title, doc, createdAt }`, one saved version     |
| `meta`    | name    | `schemaVersion` (2) and `initialized`                          |

Version 1 (Morrow 0.1) had only `pages`, `docs` and `meta`. Opening it adds the
two new stores and changes nothing else.

### Page metadata

| Field                    | Type              | Meaning                                             |
| ------------------------ | ----------------- | --------------------------------------------------- |
| `id`                     | string            | Letters, digits, `-` and `_`, at most 64 characters |
| `parentId`               | string or null    | Parent page, null at the top level                  |
| `title`                  | string            | At most 500 characters, no line breaks              |
| `icon`                   | string or null    | One emoji                                           |
| `kind`                   | `page`, `journal` | `journal` holds daily notes                         |
| `order`                  | number            | Position among siblings                             |
| `createdAt`, `updatedAt` | number            | Milliseconds since 1970                             |
| `trashedAt`              | number or null    | Set on the page that was moved to the trash         |
| `favorite`               | boolean           |                                                     |
| `dailyDate`              | string or null    | `YYYY-MM-DD` for daily notes                        |
| `lastOpenedAt`           | number or null    |                                                     |

Missing optional fields are filled with safe defaults when read. A record
without a usable id is skipped and reported, never deleted.

### Documents

Page content is a JSON tree compatible with ProseMirror:
`{ type, attrs?, content?, marks?, text? }`, with `type: "doc"` at the root.

Block types: `paragraph`, `heading` (`level` 1 to 3), `bulletList`,
`orderedList` (`start`), `listItem`, `taskList`, `taskItem` (`checked`),
`blockquote`, `codeBlock` (`language`), `horizontalRule`, `table`, `tableRow`,
`tableHeader`, `tableCell`, `image` (`fileId`, `alt`), `fileAttachment`
(`fileId`, `name`, `size`), `callout` (`tone`: `note`, `tip` or `warning`),
`details` (`open`) containing `detailsSummary` and `detailsContent`.

Inline types: `text`, `hardBreak`, `pageLink` (`id`, `label`). Marks: `bold`,
`italic`, `underline`, `strike`, `code`, `link` (`href`).

A document containing a type this version does not know is kept as it is and
opened read only, so content from a newer version is never overwritten.

### History

A version of a page is saved at most every ten minutes while it is edited,
and before a restore. Each page keeps its 50 newest versions.

## Backup file

A backup is one JSON file:

```json
{
  "format": "morrow-backup",
  "schemaVersion": 2,
  "exportedAt": "2026-10-13T18:00:00.000Z",
  "pages": [{ "id": "…", "title": "…" }],
  "docs": { "page id": { "type": "doc", "content": [] } },
  "files": [
    { "id": "…", "name": "photo.png", "type": "image/png", "size": 1024, "createdAt": 0, "data": "base64" }
  ]
}
```

`files` holds every file used by a page or a saved version. Version 1 backups
have no `files` field and are still accepted. Page history itself is not part of
a backup.

Restoring only adds: a page whose id already exists with the same title and
edit time is skipped, and one that differs is added as a copy named
"(restored)". Files are written before the pages that use them.

## Markdown export

Markdown export is for reading your notes elsewhere, not for full round trips.
Pages become CommonMark with GitHub tables, task lists and strikethrough.
Underline is `<u>`, page links are `[[Title]]`, callouts use GitHub alerts
(`> [!NOTE]`), toggles use `<details>` and images and files are written to an
`attachments` folder and linked relatively.
