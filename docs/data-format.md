# Morrow's data format

A Morrow vault is an ordinary folder of Markdown files. Every page is a file you
can open, edit, move, sync or version with any other tool, and Morrow picks up
those changes while it runs. This document describes exactly what Morrow reads
and writes, so the folder stays useful with or without Morrow. Every 2.x release
will keep reading this format.

## Pages and folders

| On disk                         | In Morrow                                                    |
| ------------------------------- | ------------------------------------------------------------ |
| `Garden.md`                     | a page called Garden                                         |
| `Garden/Raised beds.md`         | a subpage of Garden                                          |
| `Recipes/` without `Recipes.md` | a page called Recipes that holds its subpages, with no text of its own |
| `Board.canvas`                  | a canvas, in the open [JSON Canvas](https://jsoncanvas.org) format |
| `Journal/2026-10-15.md`         | the daily note for 15 October 2026, inside the journal       |
| `.trash/`                       | pages in Morrow's trash, with their subpages                 |
| `attachments/`                  | images and files added in Morrow                             |
| `.morrow/`                      | Morrow's own bookkeeping, described below                    |

A page's title is its file name. When a title uses characters file systems do
not allow, such as `/` or `:`, the file gets a safe name and the full title is
kept in the frontmatter. Two pages with the same name in one folder are told
apart as `Name.md` and `Name 2.md`.

Folders and files whose names start with a dot, other than `.trash`, belong to
other tools (`.git`, `.obsidian` and so on) and are never read or changed.

## Text

The body of a page is CommonMark with the extensions most note apps share:

- GitHub tables, task lists (`- [ ]`, `- [x]`) and `~~strikethrough~~`
- `[[Wiki links]]`, with `[[Page|shown text]]`, `[[Page#Heading]]` and
  `![[embeds]]`. A link names a page by its file name, or by its path inside the
  vault when two pages share a name, the same way Obsidian does.
- Callouts: `> [!note]`, `> [!tip]+ Title`, `> [!warning]- Folded`. Any callout
  type is kept as written.
- `==highlights==`, `<u>underline</u>`
- Maths: `$inline$` and `$$` blocks, written in LaTeX
- Toggles as `<details><summary>Title</summary> ... </details>`
- Fenced code blocks with a language, which Morrow highlights
- `#tags` anywhere in the text
- Images as `![alt](attachments/photo.png)`, paths relative to the page

HTML and any Markdown Morrow does not show as a block, such as footnotes or
comments, is kept exactly as written.

**Morrow only rewrites a file when you change that page in Morrow.** A file you
never edit in Morrow is never reformatted. When a page is renamed or moved,
Morrow updates the `[[links]]` that point at it in other files, and changes
nothing else in them. When a file changed on disk while Morrow was saving its
own edit to it, Morrow saves its version and keeps the other one in the page's
history, so no edit is lost.

## Frontmatter

Metadata lives in YAML frontmatter at the top of a page. Morrow reads and writes
only these keys and leaves every other key exactly where it was:

```yaml
---
title: "Q3: plans"   # only when the title differs from the file name
icon: 🌱
tags: [garden, project/outdoors]
kind: database       # journal, templates or database, absent for ordinary pages
---
```

`tag` is read as a synonym for `tags`. `aliases` are read so `[[links]]` to any
alias find the page, and are never changed.

## Databases

A database is a page with `kind: database`. Its subpages are its rows. The
database page holds its properties and views:

```yaml
---
kind: database
database:
  properties:
    - id: 3f2a
      name: Status
      type: select       # text, number, select, multiSelect, date, checkbox or url
      options:
        - { id: 9c1e, name: Reading, color: blue }
  views:
    - id: 77b0
      name: Board
      type: board        # table, board, calendar, list or gallery
      groupBy: 3f2a
      filters: [{ id: f1, prop: 3f2a, op: isNot, value: 9c1e }]
      sorts: [{ prop: title, dir: asc }]
---
```

Each row keeps its values as readable frontmatter keys named after the
properties, so they also work as Obsidian properties or Dataview fields:

```yaml
---
Status: Reading
Pages: 272
Started: 2026-10-01
---
```

Select values are written by name. A name Morrow has not seen before, for
example one typed in another app, becomes a new option.

## Canvases

`.canvas` files follow JSON Canvas 1.0. Cards that point at a page use the
page's path, and Morrow keeps those paths current when pages move.

## The .morrow folder

| File                     | What it holds                                                                 |
| ------------------------ | ----------------------------------------------------------------------------- |
| `workspace.json`         | an id for each page, its creation time, sidebar order and favourite status, and where trashed pages came from |
| `recent.json`            | when pages were last opened, for the home screen and search                   |
| `history/<page id>.json` | earlier versions of each page, at most one every ten minutes and fifty per page |

Deleting the `.morrow` folder loses only order, favourites, recent pages and
history. Every page and its text stay as they are. You may want to keep
`history/` out of version control.

## Deleting

Moving a page to the trash moves its files into `.trash`. Deleting a page
forever moves its files to the system trash, never straight off the disk.
Morrow never empties either trash on its own.

## The browser version

The web version cannot reach a folder, so it keeps pages in the browser's own
storage. Settings can export everything as a folder of Markdown files in the
format above, and backups move between the two versions.

## Backups

A backup is one JSON file:

```json
{
  "format": "morrow-backup",
  "schemaVersion": 3,
  "exportedAt": "2026-10-15T09:00:00.000Z",
  "pages": [{ "id": "…", "parentId": null, "title": "…", "kind": "page", "…": "…" }],
  "docs": { "<page id>": { "type": "doc", "content": [] } },
  "files": [{ "id": "…", "name": "photo.png", "type": "image/png", "size": 1234, "data": "<base64>" }]
}
```

`docs` are ProseMirror documents. Restoring a backup only ever adds pages, it
never overwrites ones that exist.
