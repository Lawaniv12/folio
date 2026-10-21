import { Injectable, inject } from '@angular/core';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { FormatterService, type FormatterBookInput, type FormatterChapterInput, type FormattedPreview } from './formatter.service';
import { Storage } from './storage';
import { Supabase } from './supabase';

export interface ExportBookRow extends FormatterBookInput {
  user_id: string;
}

export interface ExportChapterRow extends FormatterChapterInput {
  book_id: string;
}

export interface ExportRecordInsert {
  book_id: string;
  format: 'epub' | 'pdf';
  template_used: string;
  version: number;
  file_url: string;
  file_size: number;
  status: 'completed';
  generation_time_ms: number;
}

export interface GeneratedEpub {
  exportId: string;
  bookId: string;
  fileName: string;
  version: number;
  fileUrl: string;
  fileSize: number;
  generationTimeMs: number;
  preview: FormattedPreview;
}

export type PdfPageFormat = 'a4' | 'letter';

export interface GeneratedPdf extends Omit<GeneratedEpub, 'preview'> {
  pageFormat: PdfPageFormat;
  preview: FormattedPreview;
}

export class BookExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BookExportError';
  }
}

@Injectable({ providedIn: 'root' })
export class BookExportService {
  private readonly supabase = inject(Supabase);
  private readonly storage = inject(Storage);
  private readonly formatter = inject(FormatterService);
  private readonly exportBucket = 'exports';

  async exportEpub(bookId: string): Promise<GeneratedEpub> {
    const { userId, book, formatted } = await this.loadFormattedBook(bookId);
    const version = await this.nextVersion(book.id, 'epub');

    const generationStartedAt = performance.now();
    const epubBlob = await this.createEpub(formatted);
    const generationTimeMs = Math.max(0, Math.round(performance.now() - generationStartedAt));
    const fileName = `${this.fileSlug(formatted.book.title)}.epub`;
    const filePath = `${userId}/${book.id}/${crypto.randomUUID()}-${fileName}`;
    const file = new File([epubBlob], fileName, { type: 'application/epub+zip' });

    await this.storage.uploadFile(this.exportBucket, filePath, file);
    const fileUrl = this.storage.getPublicUrl(this.exportBucket, filePath);
    try {
      const exportId = await this.insertExportRecord({
        bookId: book.id,
        format: 'epub',
        templateUsed: book.template,
        version,
        fileUrl,
        fileSize: epubBlob.size,
        generationTimeMs,
      });

      return {
        exportId,
        bookId: book.id,
        fileName,
        version,
        fileUrl,
        fileSize: epubBlob.size,
        generationTimeMs,
        preview: formatted,
      };
    } catch (error: unknown) {
      try {
        await this.storage.deleteFile(this.exportBucket, filePath);
      } catch {
        // Preserve the database error; file cleanup is best-effort.
      }
      if (error instanceof BookExportError) throw error;
      throw new BookExportError(`The EPUB was created but its export record could not be saved: ${this.errorMessage(error)}`, { cause: error });
    }
  }

  async exportPdf(bookId: string, pageFormat: PdfPageFormat = 'a4'): Promise<GeneratedPdf> {
    const { userId, book, formatted } = await this.loadFormattedBook(bookId);
    const version = await this.nextVersion(book.id, 'pdf');
    const generationStartedAt = performance.now();

    let pdfBlob: Blob;
    try {
      pdfBlob = this.createPdf(formatted, pageFormat);
    } catch (error: unknown) {
      throw new BookExportError(`Unable to generate the PDF: ${this.errorMessage(error)}`, { cause: error });
    }
    const generationTimeMs = Math.max(0, Math.round(performance.now() - generationStartedAt));
    const fileName = `${this.fileSlug(formatted.book.title)}-v${version}.pdf`;
    const filePath = `${userId}/${book.id}/${crypto.randomUUID()}-${fileName}`;

    try {
      await this.storage.uploadFile(this.exportBucket, filePath, new File([pdfBlob], fileName, { type: 'application/pdf' }));
    } catch (error: unknown) {
      throw new BookExportError(`Unable to upload the generated PDF: ${this.errorMessage(error)}`, { cause: error });
    }

    const fileUrl = this.storage.getPublicUrl(this.exportBucket, filePath);
    try {
      const exportId = await this.insertExportRecord({
        bookId: book.id,
        format: 'pdf',
        templateUsed: book.template,
        version,
        fileUrl,
        fileSize: pdfBlob.size,
        generationTimeMs,
      });

      return { exportId, bookId: book.id, fileName, version, fileUrl, fileSize: pdfBlob.size, generationTimeMs, pageFormat, preview: formatted };
    } catch (error: unknown) {
      try {
        await this.storage.deleteFile(this.exportBucket, filePath);
      } catch {
        // Preserve the export-record error; uploaded-file cleanup is best-effort.
      }
      throw new BookExportError(`The PDF was uploaded but its export record could not be saved: ${this.errorMessage(error)}`, { cause: error });
    }
  }

  async downloadPdf(fileUrl: string, fileName: string): Promise<void> {
    await this.downloadFile(fileUrl, fileName, 'PDF');
  }

  private async loadFormattedBook(bookId: string): Promise<{ userId: string; book: ExportBookRow; formatted: FormattedPreview }> {
    const user = await this.supabase.getCurrentUser();
    if (!user?.id) throw new BookExportError('Sign in before exporting a book.');

    const { data: book, error: bookError } = await this.supabase.client
      .from('books')
      .select('id, user_id, title, author_name, template, total_words, source_format')
      .eq('id', bookId)
      .eq('user_id', user.id)
      .single();
    if (bookError) throw new BookExportError(`Could not load this book: ${bookError.message}`, { cause: bookError });
    if (!book) throw new BookExportError('This book could not be found in your library.');

    const { data: chapters, error: chaptersError } = await this.supabase.client
      .from('chapters')
      .select('id, book_id, position, title, content, word_count')
      .eq('book_id', book.id)
      .order('position', { ascending: true });
    if (chaptersError) throw new BookExportError(`Could not load book chapters: ${chaptersError.message}`, { cause: chaptersError });
    if (!chapters?.length) throw new BookExportError('Add at least one chapter before exporting this book.');
    if (!book.title?.trim()) throw new BookExportError('Add a book title before exporting.');
    if (!chapters.some((chapter) => typeof chapter.content === 'string' && chapter.content.trim())) {
      throw new BookExportError('This manuscript is empty. Add chapter text before exporting.');
    }

    return {
      userId: user.id,
      book: book as ExportBookRow,
      formatted: this.formatter.formatBook(book as ExportBookRow, chapters as ExportChapterRow[]),
    };
  }

  private async nextVersion(bookId: string, format: 'epub' | 'pdf'): Promise<number> {
    const { data, error } = await this.supabase.client
      .from('exports')
      .select('version')
      .eq('book_id', bookId)
      .eq('format', format)
      .order('version', { ascending: false })
      .limit(1);
    if (error) throw new BookExportError(`Could not determine the next ${format.toUpperCase()} version: ${error.message}`, { cause: error });
    return Math.max(0, Number(data?.[0]?.version) || 0) + 1;
  }

  private async insertExportRecord(input: {
    bookId: string;
    format: 'epub' | 'pdf';
    templateUsed: string;
    version: number;
    fileUrl: string;
    fileSize: number;
    generationTimeMs: number;
  }): Promise<string> {
    const exportRecord: ExportRecordInsert = {
      book_id: input.bookId,
      format: input.format,
      template_used: input.templateUsed,
      version: input.version,
      file_url: input.fileUrl,
      file_size: input.fileSize,
      status: 'completed',
      generation_time_ms: input.generationTimeMs,
    };
    const { data, error } = await this.supabase.client.from('exports').insert(exportRecord).select('id').single();
    if (error) throw error;
    if (!data?.id) throw new BookExportError('The exports table did not return the new export ID.');
    return String(data.id);
  }

  async downloadEpub(fileUrl: string, fileName: string): Promise<void> {
    await this.downloadFile(fileUrl, fileName, 'EPUB');
  }

  private async downloadFile(fileUrl: string, fileName: string, format: string): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    if (!user?.id) throw new BookExportError(`Sign in before downloading an ${format} export.`);
    const filePath = this.getObjectPath(fileUrl);
    if (!filePath.startsWith(`${user.id}/`)) throw new BookExportError('You do not have access to this export.');

    const { data, error } = await this.supabase.client.storage.from(this.exportBucket).download(filePath);
    if (error) throw new BookExportError(`Unable to download the ${format}: ${error.message}`, { cause: error });
    const objectUrl = URL.createObjectURL(data);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = fileName;
    downloadLink.click();
    URL.revokeObjectURL(objectUrl);
  }

  private getObjectPath(fileUrl: string): string {
    let url: URL;
    try {
      url = new URL(fileUrl);
    } catch (error: unknown) {
      throw new BookExportError('This export has an invalid file URL.', { cause: error });
    }

    const marker = `/storage/v1/object/public/${this.exportBucket}/`;
    const signedMarker = `/storage/v1/object/sign/${this.exportBucket}/`;
    const markerIndex = url.pathname.indexOf(marker);
    const signedMarkerIndex = url.pathname.indexOf(signedMarker);
    const start = markerIndex >= 0 ? markerIndex + marker.length
      : signedMarkerIndex >= 0 ? signedMarkerIndex + signedMarker.length
        : -1;
    if (start < 0) throw new BookExportError('The export URL does not point to the exports storage bucket.');
    return decodeURIComponent(url.pathname.slice(start));
  }

  private createPdf(preview: FormattedPreview, pageFormat: PdfPageFormat): Blob {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: pageFormat, compress: true });
    const { presentation } = preview;
    const { typography, colors } = presentation;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = typography.pageMarginMm;
    const bodyWidth = pageWidth - margin * 2;
    const bottomLimit = pageHeight - margin - 10;
    const pageTitles = new Map<number, string>();
    const chapterFirstPages = new Map<string, number>();
    const tocRows: Array<{ page: number; y: number }> = [];
    const rgb = (hex: string): [number, number, number] => [
      Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16),
    ];
    const textColor = (hex: string) => pdf.setTextColor(...rgb(hex));
    const divider = (y: number, width = 22) => {
      pdf.setDrawColor(...rgb(colors.accent));
      pdf.setLineWidth(0.3);
      pdf.line(pageWidth / 2 - width / 2, y, pageWidth / 2 + width / 2, y);
    };
    const addPage = (runningTitle: string) => {
      pdf.addPage();
      pageTitles.set(pdf.getNumberOfPages(), runningTitle);
    };

    pdf.setProperties({ title: presentation.titlePage.title, author: presentation.titlePage.author, subject: 'Print-ready formatted ebook PDF', creator: 'Folio Author Studio' });

    // Title page: same ornament, overline, title, rule, author and imprint as Preview.
    pdf.setDrawColor(...rgb(colors.rule));
    pdf.setLineWidth(0.3);
    pdf.rect(12, 12, pageWidth - 24, pageHeight - 24);
    pdf.setFont('times', 'normal');
    textColor(colors.accent);
    pdf.setFontSize(9);
    let y = pageHeight * 0.24;
    pdf.line(pageWidth / 2 - 20, y, pageWidth / 2 - 4, y);
    pdf.text(presentation.titlePage.ornament, pageWidth / 2, y + 1, { align: 'center' });
    pdf.line(pageWidth / 2 + 4, y, pageWidth / 2 + 20, y);
    y += 14;
    pdf.setFontSize(8);
    pdf.text(presentation.titlePage.overline, pageWidth / 2, y, { align: 'center' });
    pdf.setFont('times', 'bold');
    textColor(colors.ink);
    pdf.setFontSize(typography.titleFontPt);
    const titleLines = pdf.splitTextToSize(presentation.titlePage.title, bodyWidth - 12) as string[];
    y = Math.max(pageHeight * 0.42, y + 30);
    pdf.text(titleLines, pageWidth / 2, y, { align: 'center' });
    y += titleLines.length * 12 + 14;
    divider(y, 27);
    pdf.setFont('times', 'italic');
    pdf.setFontSize(16);
    pdf.text(presentation.titlePage.author, pageWidth / 2, y + 13, { align: 'center' });
    textColor(colors.muted);
    pdf.setFont('times', 'normal');
    pdf.setFontSize(8);
    pdf.text(presentation.titlePage.imprint, pageWidth / 2, pageHeight - 29, { align: 'center' });
    pageTitles.set(1, '');

    // Copyright page.
    addPage('');
    y = pageHeight - 48;
    pdf.setFont('times', 'normal');
    pdf.setFontSize(10);
    textColor(colors.muted);
    pdf.text(presentation.copyrightPage.copyrightLine, margin, y);
    pdf.text(presentation.copyrightPage.rightsLine, margin, y + 6);

    // Contents page using the shared contents labels and TOC model.
    addPage(presentation.titlePage.title);
    y = 31;
    textColor(colors.accent);
    pdf.setFont('times', 'normal');
    pdf.setFontSize(8);
    pdf.text(presentation.contentsPage.overline, pageWidth / 2, y, { align: 'center' });
    y += 12;
    textColor(colors.ink);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(typography.contentsTitleFontPt);
    pdf.text(presentation.contentsPage.title, pageWidth / 2, y, { align: 'center' });
    divider(y + 9, 18);
    y += 24;
    for (const chapter of presentation.tableOfContents) {
      pdf.setFont('times', 'normal');
      pdf.setFontSize(typography.tocFontPt);
      textColor(colors.ink);
      const label = chapter.chapterLabel ? `${chapter.chapterLabel}  ` : '';
      const lines = pdf.splitTextToSize(chapter.title || '', bodyWidth - 14 - (chapter.chapterLabel ? 30 : 0)) as string[];
      for (const [lineIndex, line] of lines.entries()) {
        if (y + 6 > bottomLimit) {
          addPage(presentation.titlePage.title);
          y = 31;
        }
        let textStart = margin;
        if (lineIndex === 0 && label) {
          pdf.setFont('helvetica', 'bold');
          textColor(colors.accent);
          pdf.setFontSize(7);
          pdf.text(label, margin, y);
          textStart += pdf.getTextWidth(label) + 1;
          pdf.setFont('times', 'normal');
          pdf.setFontSize(typography.tocFontPt);
          textColor(colors.ink);
        }
        pdf.text(line, textStart, y);
        if (lineIndex === lines.length - 1) {
          const number = String(chapter.firstPage);
          const start = textStart + pdf.getTextWidth(line) + 3;
          const end = pageWidth - margin - pdf.getTextWidth(number) - 2;
          pdf.setDrawColor(...rgb(colors.rule));
          for (let x = start; x < end; x += 2) pdf.circle(x, y - 0.7, 0.16, 'F');
          textColor(colors.muted);
          pdf.text(number, pageWidth - margin, y, { align: 'right' });
          tocRows.push({ page: pdf.getNumberOfPages(), y });
        }
        y += 6;
      }
      y += 2;
    }

    // Chapters are emitted in the same canonical section order as Preview/EPUB.
    for (const chapter of presentation.sections.flatMap((section) => section.chapters)) {
      const displayTitle = chapter.title || chapter.chapterLabel || presentation.titlePage.title;
      addPage(displayTitle);
      chapterFirstPages.set(chapter.id, pdf.getNumberOfPages());
      y = margin + 18;
      pdf.setFont('times', 'normal');
      if (chapter.chapterLabel) {
        textColor(colors.accent);
        pdf.setFontSize(typography.chapterLabelFontPt);
        pdf.text(chapter.chapterLabel, pageWidth / 2, y, { align: 'center' });
        y += 10;
      }
      textColor(colors.ink);
      pdf.setFont('times', 'bold');
      pdf.setFontSize(typography.chapterTitleFontPt);
      if (chapter.title) {
        const headingLines = pdf.splitTextToSize(chapter.title, bodyWidth - 8) as string[];
        pdf.text(headingLines, pageWidth / 2, y, { align: 'center' });
        y += headingLines.length * 10 + 8;
      }
      divider(y, 18);
      y += 13;
      pdf.setFont('times', 'normal');
      pdf.setFontSize(typography.bodyFontPt);
      textColor(colors.ink);
      const paragraphIndentMm = typography.bodyFontPt * 1.4 * 25.4 / 72;
      for (const paragraph of chapter.paragraphs) {
        const lines = pdf.splitTextToSize(paragraph, bodyWidth - paragraphIndentMm) as string[];
        let offset = 0;
        while (offset < lines.length) {
          const count = Math.floor((bottomLimit - y - typography.paragraphSpacingMm) / typography.bodyLineHeightMm);
          if (count < 1) {
            addPage(displayTitle);
            y = margin + 18;
            pdf.setFont('times', 'normal');
            pdf.setFontSize(typography.bodyFontPt);
            textColor(colors.ink);
            continue;
          }
          const segment = lines.slice(offset, offset + count);
          segment.forEach((line, lineIndex) => {
            const indent = offset === 0 && lineIndex === 0 ? paragraphIndentMm : 0;
            pdf.text(line, margin + indent, y + lineIndex * typography.bodyLineHeightMm);
          });
          y += segment.length * typography.bodyLineHeightMm;
          offset += segment.length;
          if (offset < lines.length) {
            addPage(displayTitle);
            y = margin + 18;
            pdf.setFont('times', 'normal');
            pdf.setFontSize(typography.bodyFontPt);
            textColor(colors.ink);
          }
        }
        y += typography.paragraphSpacingMm;
      }
    }

    // Replace estimated contents numbers with actual chapter-start page numbers.
    presentation.tableOfContents.forEach((chapter, index) => {
      const row = tocRows[index];
      const actualPage = chapterFirstPages.get(chapter.id);
      if (!row || !actualPage) return;
      pdf.setPage(row.page);
      pdf.setFillColor(...rgb(colors.paper));
      pdf.rect(pageWidth - margin - 14, row.y - 4, 14, 6, 'F');
      textColor(colors.muted);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(typography.tocFontPt);
      pdf.text(String(actualPage), pageWidth - margin, row.y, { align: 'right' });
    });

    // Running headers and page numbers are applied after pagination is complete.
    for (let page = 2; page <= pdf.getNumberOfPages(); page += 1) {
      pdf.setPage(page);
      textColor(colors.muted);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(typography.runningHeaderFontPt);
      pdf.text(pageTitles.get(page) || presentation.titlePage.title, pageWidth / 2, 13, { align: 'center' });
      pdf.setDrawColor(...rgb(colors.rule));
      pdf.setLineWidth(0.2);
      pdf.line(margin, 17, pageWidth - margin, 17);
      pdf.setFontSize(typography.footerFontPt);
      const runningTitle = pageTitles.get(page);
      if (runningTitle) pdf.text(runningTitle, margin, pageHeight - 12, { maxWidth: bodyWidth - 15 });
      pdf.text(String(page), pageWidth - margin, pageHeight - 12, { align: 'right' });
    }
    return pdf.output('blob');
  }

  private async createEpub(preview: FormattedPreview): Promise<Blob> {
    const zip = new JSZip();
    const presentation = preview.presentation;
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF')?.file('container.xml', this.containerXml());

    const bookFolder = zip.folder('OEBPS');
    if (!bookFolder) throw new BookExportError('Unable to initialize the EPUB package.');

    const chapterFiles = presentation.chapters.map((_chapter, index) => `chapter-${index + 1}.xhtml`);
    bookFolder.file('nav.xhtml', this.navigationDocument(preview));
    bookFolder.file('content.opf', this.packageDocument(preview, chapterFiles));
    bookFolder.file('styles.css', this.epubStyles(preview));
    bookFolder.file('title.xhtml', this.titleDocument(preview));
    bookFolder.file('toc.xhtml', this.tocDocument(preview));
    presentation.chapters.forEach((chapter, index) => bookFolder.file(chapterFiles[index], this.chapterDocument(chapter.chapterLabel, chapter.title, chapter.paragraphs)));

    return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  private containerXml(): string {
    return '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  }

  private packageDocument(preview: FormattedPreview, chapterFiles: string[]): string {
    const identifier = this.escapeXml(`urn:uuid:${crypto.randomUUID()}`);
    const title = this.escapeXml(preview.book.title);
    const author = this.escapeXml(preview.book.author_name);
    const chapterManifest = chapterFiles.map((file, index) => `<item id="chapter-${index + 1}" href="${file}" media-type="application/xhtml+xml"/>`).join('');
    const chapterSpine = chapterFiles.map((_file, index) => `<itemref idref="chapter-${index + 1}"/>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="toc.xhtml" media-type="application/xhtml+xml"/><item id="styles" href="styles.css" media-type="text/css"/>${chapterManifest}</manifest><spine><itemref idref="title"/><itemref idref="toc"/>${chapterSpine}</spine></package>`;
  }

  private navigationDocument(preview: FormattedPreview): string {
    const entries = preview.presentation.tableOfContents.map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml">${this.escapeXml([chapter.chapterLabel, chapter.title].filter(Boolean).join(' ') || 'Untitled section')}</a></li>`).join('');
    return this.xhtmlDocument(preview.presentation.titlePage.title, `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>${this.escapeXml(preview.presentation.contentsPage.title)}</h1><ol>${entries}</ol></nav>`);
  }

  private titleDocument(preview: FormattedPreview): string {
    const title = preview.presentation.titlePage;
    return this.xhtmlDocument(title.title, `<section class="title-page"><p class="overline">${this.escapeXml(title.overline)}</p><h1>${this.escapeXml(title.title)}</h1><div class="title-rule">${this.escapeXml(title.ornament)}</div><p class="author">${this.escapeXml(title.author)}</p><p class="imprint">${this.escapeXml(title.imprint)}</p></section>`);
  }

  private tocDocument(preview: FormattedPreview): string {
    const entries = preview.presentation.tableOfContents.map((chapter, index) => `<li><a href="chapter-${index + 1}.xhtml"><span>${this.escapeXml(chapter.chapterLabel ?? '')}</span><span>${this.escapeXml(chapter.title || 'Untitled section')}</span></a></li>`).join('');
    return this.xhtmlDocument(preview.presentation.contentsPage.title, `<section class="toc"><p class="overline">${this.escapeXml(preview.presentation.contentsPage.overline)}</p><h1>${this.escapeXml(preview.presentation.contentsPage.title)}</h1><ol>${entries}</ol></section>`);
  }

  private chapterDocument(chapterLabel: string | null, title: string, paragraphs: string[]): string {
    const label = chapterLabel ? `<p class="chapter-label">${this.escapeXml(chapterLabel)}</p>` : '';
    const body = paragraphs.map((paragraph) => `<p>${this.escapeXml(paragraph)}</p>`).join('');
    return this.xhtmlDocument(title, `<section class="chapter">${label}<h1>${this.escapeXml(title)}</h1>${body}</section>`);
  }

  private xhtmlDocument(title: string, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><meta charset="UTF-8"/><title>${this.escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`;
  }

  private epubStyles(preview: FormattedPreview): string {
    const { typography, colors } = preview.presentation;
    const margin = typography.pageMarginMm / 5;
    return `body{font-family:${typography.bodyFontFamily};font-size:${typography.bodyFontPt}pt;line-height:${typography.bodyLineHeightMm / typography.bodyFontPt};color:${colors.ink};background:${colors.paper};margin:${margin}%;}h1{text-align:center;font-family:${typography.headingFontFamily};font-size:${typography.chapterTitleFontPt}pt;font-weight:normal;line-height:1.2;margin:2em 0;color:${colors.ink};}.overline,.chapter-label{color:${colors.accent};text-align:center;text-indent:0;font:small sans-serif;letter-spacing:.14em;}.title-page{display:flex;min-height:80vh;flex-direction:column;justify-content:center;text-align:center;break-after:page;}.title-page .overline,.title-page .author,.title-page .imprint{text-indent:0;}.title-page .author{font-style:italic;font-size:1.25em;}.title-page .imprint{font-size:small;color:${colors.muted};}.title-rule{text-align:center;color:${colors.accent};margin:1em 0;border-top:1px solid ${colors.rule};padding-top:.5em;}.toc{break-after:page;}.toc h1{font-size:${typography.contentsTitleFontPt}pt;}.toc ol{list-style:none;padding:0;}.toc li{margin:1em 0;border-bottom:1px dotted ${colors.rule};}.toc li a{display:flex;gap:1em;color:inherit;text-decoration:none;}.toc li a span:first-child{font-size:small;color:${colors.accent};}.toc li a span:last-child{flex:1;}p{text-indent:1.4em;margin:.6em 0;line-height:${typography.bodyLineHeightMm / typography.bodyFontPt};}.chapter{break-before:page;}.chapter-label{text-indent:0;}`;
  }

  private fileSlug(title: string): string {
    return title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'book';
  }

  private escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : 'An unexpected error occurred';
  }
}
