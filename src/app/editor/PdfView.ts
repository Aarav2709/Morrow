// a pdf shown by morrow itself rather than the system's viewer, which differs on every system and can't be
// added to. text can be highlighted, and the highlights are saved into the pdf as ordinary pdf highlights, so
// other apps show them too. this module, and pdf.js with it, only loads once a page shows a pdf
import { AnnotationEditorType, getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { t } from '../i18n';
import { getSession } from '../workspace';
import { toast } from '../ui';

GlobalWorkerOptions.workerSrc = workerUrl;

// highlights are saved a moment after the last change, not after every stroke
const SAVE_DELAY_MS = 1500;
const HIGHLIGHT_COLORS = 'yellow=#FFF06A,green=#7CEBA5,blue=#8FD3FF,pink=#FFB3D9,red=#FF8A80';

// pdf.js fetches its own translations by default. morrow keeps everything on the computer, so the few words
// highlighting shows, the names of its buttons and colours, come from morrow's own translations
type Label = { name: () => string; as: 'label' | 'text' };
const LABELS: Record<string, Label> = {
  'pdfjs-highlight-floating-button1': { name: () => t('editor.pdf.highlight'), as: 'label' },
  'pdfjs-highlight-floating-button-label': { name: () => t('editor.pdf.highlight'), as: 'text' },
  'pdfjs-editor-highlight-editor': { name: () => t('editor.pdf.highlight'), as: 'label' },
  'pdfjs-editor-remove-highlight-button': { name: () => t('editor.pdf.removeHighlight'), as: 'label' },
  'pdfjs-editor-colorpicker-button': { name: () => t('editor.pdf.colour'), as: 'label' },
  'pdfjs-editor-colorpicker-dropdown': { name: () => t('editor.pdf.colour'), as: 'label' },
  'pdfjs-editor-colorpicker-yellow': { name: () => t('editor.pdf.yellow'), as: 'label' },
  'pdfjs-editor-colorpicker-green': { name: () => t('editor.pdf.green'), as: 'label' },
  'pdfjs-editor-colorpicker-blue': { name: () => t('editor.pdf.blue'), as: 'label' },
  'pdfjs-editor-colorpicker-pink': { name: () => t('editor.pdf.pink'), as: 'label' },
  'pdfjs-editor-colorpicker-red': { name: () => t('editor.pdf.red'), as: 'label' },
  'pdfjs-editor-highlight-added-alert': { name: () => t('editor.pdf.added'), as: 'text' },
};

function label(element: Element) {
  const found = LABELS[element.getAttribute('data-l10n-id') ?? ''];
  if (!found) return;
  const name = found.name();
  if (found.as === 'text') element.textContent = name;
  else {
    element.setAttribute('aria-label', name);
    element.setAttribute('title', name);
  }
}

function labelAll(root: Element) {
  if (root.hasAttribute('data-l10n-id')) label(root);
  for (const element of root.querySelectorAll('[data-l10n-id]')) label(element);
}

const morrowL10n = {
  getLanguage: () => document.documentElement.lang || 'en',
  getDirection: () => 'ltr',
  get: async (ids: string | string[]) => {
    const one = (id: string) => LABELS[id]?.name() ?? '';
    return Array.isArray(ids) ? ids.map(one) : one(ids);
  },
  translate: async (element: Element) => labelAll(element),
  translateOnce: async (element: Element) => labelAll(element),
  destroy: async () => {},
  pause: () => {},
  resume: () => {},
};

export interface PdfViewHandle {
  // saves what is left to save and lets the pdf go
  destroy(): Promise<void>;
}

export async function mountPdf(
  shell: HTMLElement,
  fileId: string,
  editable: boolean,
): Promise<PdfViewHandle> {
  const session = getSession();
  const stored = await session.getFile(fileId);
  if (!stored) throw new Error('missing');
  // character maps, standard fonts and picture decoders are files of morrow's own, read only when a pdf needs
  // them, see pdfjsData in vite.config.ts. the worker resolves them from its own address, so they are whole urls
  const dataUrl = (folder: string) => new URL(`pdfjs/${folder}/`, document.baseURI).href;
  const loading = getDocument({
    // pdf.js takes the bytes it is given to its worker, the copy keeps the stored ones intact
    data: new Uint8Array(stored.data.slice(0)),
    enableXfa: false,
    cMapUrl: dataUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dataUrl('standard_fonts'),
    wasmUrl: dataUrl('wasm'),
  });
  const pdf: PDFDocumentProxy = await loading.promise;

  const bar = document.createElement('div');
  bar.className = 'pdf-bar';
  const frame = document.createElement('div');
  frame.className = 'pdf-frame';
  const container = document.createElement('div');
  container.className = 'pdf-scroll';
  const viewerElement = document.createElement('div');
  viewerElement.className = 'pdfViewer';
  container.append(viewerElement);
  frame.append(container);
  shell.prepend(bar, frame);
  // pdf.js names some buttons as it makes them and some only later, so anything new in the frame is named
  const labeller = new MutationObserver((records) => {
    for (const record of records)
      for (const added of record.addedNodes) if (added instanceof Element) labelAll(added);
  });
  labeller.observe(frame, { childList: true, subtree: true });

  // highlights need a pdf that can be written back, which a page only being read can't do
  const canHighlight = editable && session.canReplaceFiles;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const viewer = new PDFViewer({
    container,
    viewer: viewerElement,
    eventBus,
    linkService,
    l10n: morrowL10n as never,
    annotationEditorMode: canHighlight ? AnnotationEditorType.NONE : AnnotationEditorType.DISABLE,
    annotationEditorHighlightColors: HIGHLIGHT_COLORS,
    // text selected without turning highlighting on offers a highlight button beside it. pdf.js reads this
    // option but leaves it out of its types
    ...({ enableHighlightFloatingButton: canHighlight } as object),
  });
  linkService.setViewer(viewer);
  // the pages fit the block's width. a block not yet in the window, or on a page being left, has none, and
  // fitting to that fails, so it waits until it has one
  const fit = () => {
    if (viewer.pagesCount && container.offsetParent && container.clientWidth > 0)
      viewer.currentScaleValue = 'page-width';
  };
  eventBus.on('pagesinit', fit);
  viewer.setDocument(pdf);
  linkService.setDocument(pdf, null);
  // and again when the window or a split pane changes its width
  const resize = new ResizeObserver(fit);
  resize.observe(container);

  // saving: the pdf with its highlights written over the stored one
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let dirty = false;
  const status = document.createElement('span');
  status.className = 'pdf-status';
  const save = async () => {
    timer = null;
    if (saving) await saving;
    if (!dirty) return;
    dirty = false;
    status.textContent = t('editor.pdf.saving');
    saving = (async () => {
      // cleared before saving, so a highlight made while this save runs is noticed and saved after it
      pdf.annotationStorage.resetModified();
      // the pdf as it was opened, plus every highlight there is now. with none left, as after the only one is
      // deleted, that is the pdf as it was opened
      const bytes = pdf.annotationStorage.size > 0 ? await pdf.saveDocument() : await pdf.getData();
      const result = await session.replaceFile(fileId, bytes.slice().buffer);
      if (result.ok) {
        status.textContent = t('editor.pdf.saved');
      } else {
        dirty = true;
        status.textContent = '';
        toast(result.error, { tone: 'error' });
      }
    })().finally(() => (saving = null));
    await saving;
  };
  const changed = () => {
    dirty = true;
    status.textContent = t('editor.pdf.edited');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  if (canHighlight) {
    const storage = pdf.annotationStorage as unknown as {
      onSetModified: () => void;
      remove(key: string): void;
      has(key: string): boolean;
    };
    storage.onSetModified = changed;
    // pdf.js counts a new highlight deleted again as no change at all, but it may already be in the saved pdf
    const remove = storage.remove.bind(storage);
    storage.remove = (key) => {
      const had = storage.has(key);
      remove(key);
      if (had) changed();
    };
    const highlight = document.createElement('button');
    highlight.type = 'button';
    highlight.className = 'button small pdf-highlight';
    highlight.setAttribute('aria-pressed', 'false');
    highlight.textContent = t('editor.pdf.highlight');
    highlight.title = t('editor.pdf.highlightHelp');
    highlight.addEventListener('click', () => {
      const on = highlight.getAttribute('aria-pressed') !== 'true';
      viewer.annotationEditorMode = {
        mode: on ? AnnotationEditorType.HIGHLIGHT : AnnotationEditorType.NONE,
      };
    });
    // pdf.js changes mode itself too: the button beside selected text turns highlighting on, and escape or
    // clicking an existing highlight asks for a mode. its own viewer app answers these, here morrow does
    eventBus.on('showannotationeditorui', ({ mode }: { mode: number }) => {
      viewer.annotationEditorMode = { mode };
    });
    eventBus.on('switchannotationeditormode', (request: { mode: number }) => {
      viewer.annotationEditorMode = request;
    });
    eventBus.on('annotationeditormodechanged', ({ mode }: { mode: number }) => {
      const on = mode === AnnotationEditorType.HIGHLIGHT;
      highlight.setAttribute('aria-pressed', String(on));
      shell.classList.toggle('is-highlighting', on);
    });
    bar.append(highlight);
  }
  bar.append(status);

  return {
    async destroy() {
      resize.disconnect();
      labeller.disconnect();
      if (timer) {
        clearTimeout(timer);
        await save().catch(() => undefined);
      } else if (saving) await saving;
      // a viewer let go of before its first page was read would report the pdf as broken
      await viewer.firstPagePromise?.catch(() => undefined);
      // the viewer listens to the whole window for text being selected, which has to stop with it
      viewer.setDocument(null as never);
      linkService.setDocument(null, null);
      await loading.destroy();
    },
  };
}
