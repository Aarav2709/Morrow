# Morrow

Morrow is a free, open source, local first workspace for your notes, databases
and ideas. Every page is a plain Markdown file in a folder you choose. No
account, no subscription, no cloud and no AI. Just a calm place to write and
think, on your own computer.

![Morrow showing a project page with a checklist and a table](ss.png)

## Why Morrow

- **Yours.** Your notes are a folder of Markdown files. Open them in any app,
  sync them with Syncthing, iCloud, Dropbox or git, and keep them forever. Edits
  made elsewhere show up in Morrow straight away. Nothing is sent anywhere: no
  accounts, no telemetry, no ads. It works with the network cable unplugged.
- **Calm.** A focused writing surface with careful typography, and only the
  features that earn their place.
- **Trustworthy.** Morrow only rewrites a file you changed in Morrow. Every
  change is saved as you type, failed writes are retried, earlier versions of
  every page are kept, a file changed elsewhere while you were editing is kept
  in page history, and deleted pages go to the system trash.
- **Compatible.** Wiki links, callouts, tags, properties, maths and canvases use
  the same formats as Obsidian, so an existing vault opens as it is. Notion
  exports, databases included, import in one step.
- **Everything built in.** Databases, canvases, graph, sync, encryption and
  flashcards come with Morrow, with nothing to install or configure.
- **AI free, by design.** Morrow does not have AI features and will not add them.

## Features

- **Pages** in a sidebar tree with icons, drag and drop, favourites and a trash
- **A rich editor**: headings, lists, checklists, quotes, callouts with titles
  and folding, toggles, tables, columns, a table of contents, highlights, maths,
  syntax highlighted code, Mermaid diagrams, images, and audio, video and PDF
  files that play right on the page
- **Date mentions**: type `@` for `@today`, `@friday` or any day, linked to that
  day's note
- **Links**: `[[` to link pages, with aliases and headings, live titles,
  backlinks, links to pages that do not exist yet, and links that follow renames
- **Databases**: table, board, calendar, list and gallery views of pages, with
  text, number, select, multi-select, date, checkbox, link, relation and
  formula properties, filters, sorts and grouping, checklist progress on cards,
  and inline databases shown inside any page. Row values are readable
  frontmatter, relations are `[[links]]`.
- **Canvases**: an infinite whiteboard of cards, pages, images and groups joined
  by arrows, with a pen, highlighter and eraser for freehand drawing, saved as
  open JSON Canvas files
- **Graph**: every page and link as a network, or the neighbourhood of one page
- **Tags** from properties or `#tags` in text, with nested tags and a tag index
- **Templates** with `{{date}}`, `{{time}}` and `{{title}}`, and a daily note
  template
- **Daily notes**, and a Tasks view that gathers every checklist item
- **Search** across every page, with `#tag` filters, and a command palette
- **Vaults**: open any folder, switch between folders, keep work and home apart
- **Sync between your computers** on the same network: pair once with a code,
  no server, no account, every transfer encrypted, both versions kept when a
  page changed on both
- **Encrypted pages**: lock any page with a password, AES-256 on disk, never a
  plain copy in history or backups
- **Flashcards**: write `question :: answer` anywhere and review with spaced
  repetition
- **Embedded pages** with `![[Page]]`, kept live as the other page changes
- **Quick capture** from any app with Ctrl/Cmd + Alt + M, straight into today's
  note
- **Colour**: eight accent themes, coloured text and highlights, page covers,
  coloured tags and icons, and a home page with your writing streak, "On this
  day" and a page to rediscover
- **Publish** a page or the whole vault as a static website, free
- Page history with a view of what changed since each version
- **Tabs**: Ctrl/Cmd + T, Ctrl/Cmd + W, Ctrl + Tab, and Ctrl/Cmd + click to open
  any page in a new tab
- **Export as PDF**, and **edit as Markdown** to work on a page's source directly
- **Custom CSS** kept in the vault as `.morrow/style.css`
- A full emoji picker for page icons, drawn the same on every system
- Find and replace, Markdown shortcuts, Markdown paste, an outline of each page, focus mode
- Import from Notion (pages and databases) or any folder of Markdown files,
  export to Markdown, full backups
- Light and dark themes, a choice of sans, serif or mono writing fonts
- A detailed guide on first run that shows every feature working
- Keyboard first: press Ctrl/Cmd + / to see every shortcut

## Status

Version **1.0.0**. Pages are files in a folder you choose. Earlier builds kept
them inside the app; the first time this version opens it offers to copy those
pages into the folder and leaves the original copy untouched. The macOS and Linux builds
are produced by the release workflow but have not yet been tried on real
machines, and builds are not code signed yet.

## Coming from Obsidian

Choose **Open a folder** and pick your vault. Morrow reads it as it is: folders,
wiki links, embeds, callouts, tags, properties, aliases, maths and canvases.
Nothing in `.obsidian` is touched, and files you do not edit in Morrow are never
rewritten.

## Coming from Notion

In Notion, open Settings, Export, choose **Markdown & CSV** and include
subpages. In Morrow, choose **Import** in the sidebar and pick the zip file.
Pages keep their nesting, links between pages and images, databases become
Morrow databases with their properties, and Notion's callouts become Morrow
callouts.

## Build and run

You need [Node.js](https://nodejs.org) 20.19 or newer.

```sh
git clone https://github.com/Aarav2709/Morrow.git
cd Morrow
npm install
npm run dev        # opens the desktop app with live reload
```

| Command         | What it does                                        |
| --------------- | --------------------------------------------------- |
| `npm run dev`   | Desktop app with live reload                        |
| `npm run build` | Builds the interface and the desktop shell          |
| `npm start`     | Runs the built desktop app                          |
| `npm run dist`  | Builds installers for your platform into `release/` |
| `npm test`      | Runs the unit and storage tests                     |
| `npm run check` | Type check, lint, tests and build together          |

On Windows `npm run dist` produces `Morrow-Setup-<version>.exe` and a portable
`.exe`. Pushing a tag such as `v1.0.0` builds Windows, macOS and Linux versions
on GitHub and attaches them to a release. Morrow never checks for updates on
its own; new versions are downloaded from the releases page. Builds are signed automatically once the
signing secrets (`CSC_LINK` and `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for macOS) are added to the
repository. Until then Windows SmartScreen and macOS Gatekeeper warn the first
time Morrow is opened.

## Signing builds for free

Unsigned builds work, but Windows SmartScreen and macOS Gatekeeper warn the
first time they open. What it costs to remove those warnings:

| Platform | Free option                                             | Notes                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | [SignPath Foundation](https://signpath.org)             | Free code signing for open source projects with an OSI licence (Morrow's Apache 2.0 qualifies). Apply with the public repository; once accepted, the release workflow uploads the built `.exe` to SignPath's GitHub action and gets it back signed. The publisher shown is "SignPath Foundation". |
| Windows  | [Microsoft Store](https://storedeveloper.microsoft.com) | Registration is free for individual developers since September 2025. Add an `appx` target to electron-builder and submit the package; Microsoft signs what it publishes, so Store installs never show SmartScreen.                                                                                |
| macOS    | none                                                    | Apple requires a paid Developer Program membership ($99 a year) for a Developer ID certificate and notarisation. Without it, people open Morrow once from **System Settings → Privacy & Security → Open Anyway**, or run `xattr -cr /Applications/Morrow.app`.                                    |
| Linux    | not needed                                              | AppImage, deb and rpm packages are not signed by convention. Publishing a `SHA256SUMS` file with each release, signed with your GPG key, lets people check their download.                                                                                                                        |

With a certificate, signing is already wired up: add `CSC_LINK` and
`CSC_KEY_PASSWORD` (and `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID` for macOS) as repository secrets and the release workflow signs
everything it builds.

## Where your data lives

In the folder you chose, as Markdown files: one file per page, subpages in a
folder named after their page, canvases as `.canvas` files, images and files in
`attachments/`, trashed pages in `.trash/`. Metadata lives in frontmatter, and
database rows keep their values as readable properties. Morrow's own small
`.morrow` folder in the vault remembers page order, favourites and page history;
deleting it never touches a page. Morrow's settings and automatic backups live
in `%APPDATA%\Morrow` on Windows, `~/Library/Application Support/Morrow` on
macOS and `~/.config/Morrow` on Linux.

## Licence

Morrow is licensed under the [Apache License 2.0](LICENSE). The licences of the
open source packages it bundles are written to `THIRD_PARTY_LICENSES.txt` in
every build.
