import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BookExportService, type PdfPageFormat } from '../../../core/services/book-export.service';
import { Supabase } from '../../../core/services/supabase';

type ExportFormat = 'epub' | 'pdf' | 'kindle';

interface ExportBookOption {
  id: string;
  title: string;
}

interface ExportHistoryItem {
  id: string;
  book_id: string;
  format: string;
  template_used: string;
  version: number;
  file_url: string;
  file_size: number;
  status: string;
  created_at: string;
  generation_time_ms: number;
  bookTitle: string;
}

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  selector: 'app-export-center',
  styleUrl: './export-center.scss',
  templateUrl: './export-center.html',
})
export class ExportCenter implements OnInit {
  private readonly supabase = inject(Supabase);
  private readonly bookExport = inject(BookExportService);

  protected readonly books = signal<ExportBookOption[]>([]);
  protected readonly exports = signal<ExportHistoryItem[]>([]);
  protected readonly exportFormat = signal<ExportFormat>('epub');
  protected readonly selectedBookId = signal('');
  protected readonly pdfPageFormat = signal<PdfPageFormat>('a4');
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly downloadingExportId = signal('');
  protected readonly notice = signal('');
  protected readonly errorMessage = signal('');

  ngOnInit(): void {
    void this.loadData();
  }

  protected async selectFormat(format: ExportFormat): Promise<void> {
    this.exportFormat.set(format);
    this.notice.set('');
    this.errorMessage.set('');
    try {
      await this.loadExports();
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : `Unable to load ${format} export history.`);
    }
  }

  protected get formatTitle(): string {
    switch (this.exportFormat()) {
      case 'pdf': return 'Export a PDF';
      case 'kindle': return 'Export a Kindle Package';
      default: return 'Export an EPUB';
    }
  }

  protected get exportButtonLabel(): string {
    switch (this.exportFormat()) {
      case 'pdf': return 'Export PDF';
      case 'kindle': return 'Coming Soon';
      default: return 'Export EPUB';
    }
  }

  protected get historyTitle(): string {
    const format = this.exportFormat();
    return `Recent ${format === 'kindle' ? 'Kindle' : format.toUpperCase()} Exports`;
  }

  protected get formatName(): string {
    const format = this.exportFormat();
    return format === 'kindle' ? 'Kindle package' : format.toUpperCase();
  }

  protected async createExport(): Promise<void> {
    const bookId = this.selectedBookId();
    const format = this.exportFormat();
    if (!bookId || this.exporting() || format === 'kindle') return;

    this.exporting.set(true);
    this.errorMessage.set('');
    this.notice.set(`Generating your ${format.toUpperCase()}…`);
    try {
      const generated = format === 'pdf'
        ? await this.bookExport.exportPdf(bookId, this.pdfPageFormat())
        : await this.bookExport.exportEpub(bookId);
      this.notice.set(`${generated.fileName} is ready to download.`);
      await this.loadExports();
    } catch (error: unknown) {
      this.notice.set('');
      this.errorMessage.set(error instanceof Error ? error.message : `Unable to create this ${format.toUpperCase()}.`);
    } finally {
      this.exporting.set(false);
    }
  }

  protected async download(item: ExportHistoryItem): Promise<void> {
    if (this.downloadingExportId()) return;
    this.downloadingExportId.set(item.id);
    this.errorMessage.set('');
    try {
      const fileName = `${this.fileSlug(item.bookTitle)}-v${item.version}.${item.format}`;
      if (item.format === 'pdf') await this.bookExport.downloadPdf(item.file_url, fileName);
      else await this.bookExport.downloadEpub(item.file_url, fileName);
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : `Unable to download this ${item.format.toUpperCase()}.`);
    } finally {
      this.downloadingExportId.set('');
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      let user;
      try {
        user = await this.supabase.getCurrentUser();
        this.logQueryResult('auth.getUser()', user, null);
      } catch (error: unknown) {
        this.logQueryResult('auth.getUser()', null, error);
        throw error;
      }
      if (!user?.id) throw new Error('Sign in to access your exports.');

      const { data: books, error: booksError } = await this.supabase.client
        .from('books')
        .select('id, title')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      this.logQueryResult('books selector query', books, booksError);
      if (booksError) throw booksError;

      this.books.set((books ?? []) as ExportBookOption[]);
      this.selectedBookId.set((books ?? [])[0]?.id ?? '');
      await this.loadExports();
    } catch (error: unknown) {
      this.errorMessage.set(`Export Workspace Error:\n${this.getDetailedError(error)}`);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadExports(): Promise<void> {
    const user = this.supabase.currentUser();
    if (!user?.id) return;

    const ownedBookIds = this.books().map((book) => book.id);
    if (ownedBookIds.length === 0) {
      this.exports.set([]);
      return;
    }

    const { data, error } = await this.supabase.client
      .from('exports')
      .select('id, book_id, format, template_used, version, file_url, file_size, status, created_at, generation_time_ms')
      .in('book_id', ownedBookIds)
      .eq('format', this.exportFormat())
      .order('created_at', { ascending: false });
    this.logQueryResult('exports history query', data, error);
    if (error) throw error;
    const titles = new Map(this.books().map((book) => [book.id, book.title]));
    this.exports.set((data ?? []).map((item) => ({
      ...item,
      bookTitle: titles.get(item.book_id) ?? 'Untitled book',
    })) as ExportHistoryItem[]);
  }

  private fileSlug(value: string): string {
    return value.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'book';
  }

  private logQueryResult(queryName: string, result: unknown, error: unknown): void {
    console.group(`[Export Center] ${queryName}`);
    console.log('Query result:', result);
    if (error) {
      const supabaseError = error as {
        code?: unknown;
        message?: unknown;
        details?: unknown;
        hint?: unknown;
      };
      console.error('Query error:', error);
      console.error('error.code:', supabaseError.code);
      console.error('error.message:', supabaseError.message);
      console.error('error.details:', supabaseError.details);
      console.error('error.hint:', supabaseError.hint);
    } else {
      console.log('Query error: none');
    }
    console.groupEnd();
  }

  private getDetailedError(error: unknown): string {
    if (error && typeof error === 'object') {
      const supabaseError = error as {
        code?: unknown;
        message?: unknown;
        details?: unknown;
        hint?: unknown;
      };
      const fields = [
        ['message', supabaseError.message],
        ['code', supabaseError.code],
        ['details', supabaseError.details],
        ['hint', supabaseError.hint],
      ].filter((entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || typeof entry[1] === 'number',
      );
      if (fields.length) return fields.map(([label, value]) => `${label}: ${value}`).join('\n');
    }
    return error instanceof Error ? error.message : String(error);
  }
}
