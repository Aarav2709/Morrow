# Morrow

Morrow is a free, open source, local first workspace for your notes, ideas and
projects. No account, no subscription, no cloud and no AI. Just a calm place to
write and think, on your own computer.

![Morrow showing a project page with a checklist and a table](ss.png)

## Why Morrow

- **Yours.** Pages live on your computer. Nothing is sent anywhere: no accounts,
  no telemetry, no ads. It works with the network cable unplugged.
- **Calm.** A focused writing surface with careful typography, and only the
  features that earn their place.
- **Trustworthy.** Every change is saved automatically and the status is always
  visible. Failed writes are kept and retried, earlier versions of every page
  are kept, content Morrow cannot read is protected instead of overwritten, and
  the trash never empties itself.
- **Portable.** Export a page or the whole workspace as plain Markdown, save a
  full backup in one file and restore it on any computer.
- **AI free, by design.** Morrow does not have AI features and will not add them.

## Features

- Nested pages in a sidebar tree, with icons, drag and drop, favourites and a trash
- A rich text editor: headings, bold, italic, underline, strikethrough, code,
  bulleted, numbered and nested lists, checklists, quotes, callouts, toggles,
  code blocks, dividers, links and tables
- Images and file attachments: paste, drop or insert them, stored on your computer
- Page history: Morrow keeps earlier versions of every page and restores any of them
- Find and replace in a page, search across every page, and a command palette
- `/` to insert any block, Markdown shortcuts as you type, Markdown paste
- `[[` to link pages, with titles that stay current and backlinks on every page
- Daily notes, and a Tasks view that gathers every checklist item
- Import from Notion or any folder of Markdown files (a zip export works as is)
- Markdown export with attachments, full backups, automatic rolling backups
- Light and dark themes, a choice of serif, sans or mono writing fonts
- A native desktop window with the system's own window controls
- Optional update checks, off until you turn them on
- Keyboard first: press Ctrl/Cmd + / to see every shortcut

## Status

Version **1.0.0**. Everything listed above is built and tested on Windows. The
macOS and Linux builds are produced by the release workflow but have not yet
been tried on real machines, and builds are not code signed yet.

## Coming from Notion

In Notion, open Settings, Export, choose **Markdown & CSV** and include
subpages. In Morrow, choose **Import** in the sidebar and pick the zip file.
Pages keep their nesting, links between pages and images, databases become
tables, and Notion's callouts become Morrow callouts. The same works for an
Obsidian vault or any folder of Markdown files zipped up.

## Build and run

You need [Node.js](https://nodejs.org) 20.19 or newer.

```sh
git clone https://github.com/Aarav2709/Morrow.git
cd Morrow
npm install
npm run dev        # opens the desktop app with live reload
```

| Command           | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `npm run dev`     | Desktop app with live reload                           |
| `npm run dev:web` | The interface in your browser at http://localhost:5173 |
| `npm run build`   | Builds the interface and the desktop shell             |
| `npm start`       | Runs the built desktop app                             |
| `npm run dist`    | Builds installers for your platform into `release/`    |
| `npm test`        | Runs the unit and storage tests                        |
| `npm run check`   | Type check, lint, tests and build together             |

On Windows `npm run dist` produces `Morrow-Setup-<version>.exe` and a portable
`.exe`. Pushing a tag such as `v1.0.0` builds Windows, macOS and Linux versions
on GitHub and attaches them to a release; installed copies can then update
themselves if the person allows it. Builds are signed automatically once the
signing secrets (`CSC_LINK` and `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for macOS) are added to the
repository. Until then Windows SmartScreen and macOS Gatekeeper warn the first
time Morrow is opened.

## Where your data lives

Everything is stored in Morrow's data folder: `%APPDATA%\Morrow` on Windows,
`~/Library/Application Support/Morrow` on macOS and `~/.config/Morrow` on Linux.
Settings has a button that opens it. Automatic backups are kept in the `Backups`
folder inside it. Backups are a single readable JSON file that includes your
images and files, and Markdown exports are plain text that opens in any editor.
The format is documented in [docs/data-format.md](docs/data-format.md), and
every 1.x release will keep reading it.

## Licence

Morrow is licensed under the [Apache License 2.0](LICENSE). The licences of the
open source packages it bundles are written to `THIRD_PARTY_LICENSES.txt` in
every build.
