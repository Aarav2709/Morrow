// a page as a word document: the files of a .docx, written from the page's blocks. headings, lists, tasks,
// quotes, code, tables, pictures, links and the usual text formatting come through as word's own
import type { DocMark, DocNode } from './model';

export interface DocxPicture {
  data: Uint8Array;
  // png, jpeg or gif, the kinds word shows
  extension: 'png' | 'jpeg' | 'gif';
  width: number;
  height: number;
}

export interface DocxOptions {
  title: string;
  // a picture in the vault by its file id, with its size in pixels, or null to leave it out
  picture: (fileId: string) => DocxPicture | null;
  // a linked page's title
  titleOf: (id: string) => string | null;
}

const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // characters xml can't hold at all
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const HIGHLIGHTS: Record<string, string> = {
  yellow: 'yellow',
  green: 'green',
  blue: 'cyan',
  pink: 'magenta',
  red: 'red',
  purple: 'magenta',
  orange: 'yellow',
  gray: 'lightGray',
  brown: 'darkYellow',
};
const COLOURS: Record<string, string> = {
  gray: '787774',
  brown: '9F6B53',
  orange: 'D9730D',
  yellow: 'CB912F',
  green: '448361',
  blue: '337EA9',
  purple: '9065B0',
  pink: 'C14C8A',
  red: 'D44C47',
};

const EMU_PER_PIXEL = 9525;
// the widest a picture is on an a4 page with its margins, in pixels
const MAX_PICTURE_WIDTH = 600;

export function docToDocx(doc: DocNode, options: DocxOptions): Record<string, Uint8Array | string> {
  const links: string[] = [];
  const pictures: Array<{ name: string; picture: DocxPicture }> = [];
  const relationOfLink = (href: string) => {
    let index = links.indexOf(href);
    if (index === -1) index = links.push(href) - 1;
    return `rLink${index + 1}`;
  };

  const runProperties = (marks: DocMark[] = []) => {
    const parts: string[] = [];
    for (const mark of marks) {
      if (mark.type === 'bold') parts.push('<w:b/>');
      if (mark.type === 'italic') parts.push('<w:i/>');
      if (mark.type === 'underline') parts.push('<w:u w:val="single"/>');
      if (mark.type === 'strike') parts.push('<w:strike/>');
      if (mark.type === 'code')
        parts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F1F1EF"/>');
      if (mark.type === 'highlight')
        parts.push(`<w:highlight w:val="${HIGHLIGHTS[String(mark.attrs?.color ?? 'yellow')] ?? 'yellow'}"/>`);
      if (mark.type === 'textColor' && COLOURS[String(mark.attrs?.color ?? '')])
        parts.push(`<w:color w:val="${COLOURS[String(mark.attrs!.color)]}"/>`);
      if (mark.type === 'link') parts.push('<w:rStyle w:val="Hyperlink"/>');
    }
    return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
  };

  const textRun = (text: string, marks: DocMark[] = []) =>
    text ? `<w:r>${runProperties(marks)}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>` : '';

  const inline = (nodes: DocNode[] = []): string =>
    nodes
      .map((node) => {
        if (node.type === 'text') {
          const link = node.marks?.find((mark) => mark.type === 'link');
          const run = textRun(node.text ?? '', node.marks);
          const href = String(link?.attrs?.href ?? '');
          return link && /^(https?:|mailto:)/i.test(href)
            ? `<w:hyperlink r:id="${relationOfLink(href)}">${run}</w:hyperlink>`
            : run;
        }
        if (node.type === 'hardBreak') return '<w:r><w:br/></w:r>';
        if (node.type === 'pageLink') {
          const id = typeof node.attrs?.id === 'string' ? node.attrs.id : null;
          return textRun(
            String(node.attrs?.alias ?? (id ? options.titleOf(id) : null) ?? node.attrs?.label ?? ''),
          );
        }
        if (node.type === 'linkMention') {
          const href = String(node.attrs?.href ?? '');
          const run = textRun(String(node.attrs?.title || href), [{ type: 'link' }]);
          return /^https?:/i.test(href)
            ? `<w:hyperlink r:id="${relationOfLink(href)}">${run}</w:hyperlink>`
            : run;
        }
        if (node.type === 'dateMention') return textRun(String(node.attrs?.date ?? ''));
        if (node.type === 'inlineMath') return textRun(String(node.attrs?.latex ?? ''), [{ type: 'italic' }]);
        return inline(node.content);
      })
      .join('');

  const paragraph = (content: string, style?: string, extra = '') =>
    `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${content}</w:p>`;

  const align = (node: DocNode) =>
    node.attrs?.align === 'center' || node.attrs?.align === 'right' || node.attrs?.align === 'justify'
      ? `<w:jc w:val="${node.attrs.align === 'justify' ? 'both' : node.attrs.align}"/>`
      : '';

  const picture = (node: DocNode): string => {
    const fileId = typeof node.attrs?.fileId === 'string' ? node.attrs.fileId : null;
    const found = fileId ? options.picture(fileId) : null;
    if (!found) {
      const src = String(node.attrs?.src ?? '');
      return /^https?:/i.test(src)
        ? paragraph(
            `<w:hyperlink r:id="${relationOfLink(src)}">${textRun(String(node.attrs?.alt || src), [{ type: 'link' }])}</w:hyperlink>`,
          )
        : '';
    }
    const index = pictures.push({ name: `image${pictures.length + 1}.${found.extension}`, picture: found });
    const shown = typeof node.attrs?.width === 'number' ? node.attrs.width : found.width;
    const width = Math.max(1, Math.min(shown, MAX_PICTURE_WIDTH));
    const height = Math.max(1, Math.round((found.height * width) / Math.max(1, found.width)));
    const cx = width * EMU_PER_PIXEL;
    const cy = height * EMU_PER_PIXEL;
    const alt = escape(String(node.attrs?.alt ?? ''));
    return paragraph(
      `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="Picture ${index}" descr="${alt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${index}" name="${pictures[index - 1]!.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rPicture${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
      undefined,
      node.attrs?.align === 'left'
        ? ''
        : node.attrs?.align === 'right'
          ? '<w:jc w:val="right"/>'
          : '<w:jc w:val="center"/>',
    );
  };

  // lists number by word's own lists: 1 for bullets, each numbered list a numbering of its own so it starts
  // from its own first number, each level indented further
  const numberedLists: number[] = [];
  const list = (node: DocNode, level: number, inherited?: number): string => {
    let numId = inherited ?? 1;
    if (node.type === 'orderedList' && inherited === undefined) {
      numId = 3 + numberedLists.length;
      numberedLists.push(typeof node.attrs?.start === 'number' ? Math.max(0, node.attrs.start) : 1);
    }
    return (node.content ?? [])
      .map((item) => {
        const numbered = node.type === 'orderedList';
        const task = node.type === 'taskList';
        const box = task ? (item.attrs?.checked === true ? '☒ ' : '☐ ') : '';
        return (item.content ?? [])
          .map((child, index) => {
            if (['bulletList', 'orderedList', 'taskList'].includes(child.type))
              return list(child, level + 1, child.type === 'orderedList' && numbered ? numId : undefined);
            if (index > 0 || child.type !== 'paragraph') return block(child);
            return paragraph(
              textRun(box) + inline(child.content),
              'ListParagraph',
              task
                ? `<w:ind w:left="${360 * (level + 1)}"/>`
                : `<w:numPr><w:ilvl w:val="${Math.min(level, 8)}"/><w:numId w:val="${numbered ? numId : 1}"/></w:numPr>`,
            );
          })
          .join('');
      })
      .join('');
  };

  const table = (node: DocNode): string => {
    const rows = (node.content ?? [])
      .map(
        (row) =>
          `<w:tr>${(row.content ?? [])
            .map((cell) => {
              const inner = (cell.content ?? []).map(block).join('') || '<w:p/>';
              const header = cell.type === 'tableHeader' ? '<w:shd w:val="clear" w:fill="F1F1EF"/>' : '';
              return `<w:tc><w:tcPr>${header}</w:tcPr>${inner}</w:tc>`;
            })
            .join('')}</w:tr>`,
      )
      .join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${rows}</w:tbl><w:p/>`;
  };

  function block(node: DocNode): string {
    switch (node.type) {
      case 'paragraph':
        return paragraph(inline(node.content), undefined, align(node));
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
        return paragraph(inline(node.content), `Heading${level}`, align(node));
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return list(node, 0);
      case 'blockquote':
        return (node.content ?? [])
          .map((child) =>
            child.type === 'paragraph' ? paragraph(inline(child.content), 'Quote') : block(child),
          )
          .join('');
      case 'callout':
        return (node.content ?? [])
          .map((child) =>
            child.type === 'paragraph' ? paragraph(inline(child.content), 'Callout') : block(child),
          )
          .join('');
      case 'codeBlock': {
        const lines = (node.content ?? [])
          .map((child) => child.text ?? '')
          .join('')
          .split('\n');
        return lines.map((line) => paragraph(textRun(line), 'Code')).join('');
      }
      case 'blockMath':
        return paragraph(
          textRun(String(node.attrs?.latex ?? ''), [{ type: 'italic' }]),
          undefined,
          '<w:jc w:val="center"/>',
        );
      case 'horizontalRule':
        return paragraph(
          '',
          undefined,
          '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D9D9D9"/></w:pBdr>',
        );
      case 'table':
        return table(node);
      case 'image':
        return picture(node);
      case 'details': {
        // a toggle's title in bold, with what it holds under it
        const [summary, ...rest] = node.content ?? [];
        const bold = (summary?.content ?? []).map((child) =>
          child.type === 'text' ? { ...child, marks: [...(child.marks ?? []), { type: 'bold' }] } : child,
        );
        return paragraph(inline(bold), undefined, '<w:keepNext/>') + rest.map(block).join('');
      }
      case 'bookmark':
      case 'webEmbed': {
        const href = String(node.attrs?.href ?? node.attrs?.src ?? '');
        const title = String(node.attrs?.title || href);
        const link = /^https?:/i.test(href)
          ? `<w:hyperlink r:id="${relationOfLink(href)}">${textRun(title, [{ type: 'link' }])}</w:hyperlink>`
          : textRun(title);
        const description = node.attrs?.description
          ? paragraph(textRun(String(node.attrs.description), [{ type: 'italic' }]))
          : '';
        return paragraph(link) + description;
      }
      case 'tableOfContents':
      case 'rawBlock':
      case 'fileAttachment':
        return node.type === 'fileAttachment' ? paragraph(textRun(String(node.attrs?.name ?? 'file'))) : '';
      default:
        return (node.content ?? []).map(block).join('');
    }
  }

  const body = [paragraph(textRun(options.title), 'Title'), ...(doc.content ?? []).map(block)].join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const relationships = [
    '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    ...links.map(
      (href, index) =>
        `<Relationship Id="rLink${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(href)}" TargetMode="External"/>`,
    ),
    ...pictures.map(
      ({ name }, index) =>
        `<Relationship Id="rPicture${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
    ),
  ];

  const files: Record<string, Uint8Array | string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(options.title)}</dc:title><dc:creator>Morrow</dc:creator></cp:coreProperties>`,
    'word/document.xml': document,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING.replace(
      '</w:numbering>',
      `${numberedLists
        .map(
          (start, index) =>
            `<w:num w:numId="${3 + index}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`,
        )
        .join('')}</w:numbering>`,
    ),
  };
  for (const { name, picture: found } of pictures) files[`word/media/${name}`] = found.data;
  return files;
}

const heading = (level: number, size: number) =>
  `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}${heading(4, 24)}${heading(5, 22)}${heading(6, 22)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D9D9D9"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F1F1EF"/><w:ind w:left="120" w:right="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:fill="F7F6F3"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;

const levels = (numbered: boolean) =>
  Array.from({ length: 9 }, (_, level) => {
    const format = numbered ? ['decimal', 'lowerLetter', 'lowerRoman'][level % 3] : 'bullet';
    const text = numbered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3];
    return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  }).join('');

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
