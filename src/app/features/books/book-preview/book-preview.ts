import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BookExportService, type PdfPageFormat } from '../../../core/services/book-export.service';
import { FormatterBookInput, FormatterChapterInput, FormatterService, FormattedPreview } from '../../../core/services/formatter.service';
import { Supabase } from '../../../core/services/supabase';

type PreviewState = 'loading' | 'ready' | 'error';

interface BookRow extends FormatterBookInput {}
interface ChapterRow extends FormatterChapterInput {}

@Component({
  standalone: true,
  imports: [RouterLink, UpperCasePipe],
  selector: 'app-book-preview',
  styleUrl: './book-preview.scss',
  templateUrl: './book-preview.html',
})
export class BookPreview implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(Supabase);
  private readonly formatter = inject(FormatterService);
  private readonly bookExport = inject(BookExportService);

  protected readonly state = signal<PreviewState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly preview = signal<FormattedPreview | null>(null);
  protected readonly activeChapterId = signal('');
  protected readonly activeChapter = computed(() => this.preview()?.chapters.find((chapter) => chapter.id === this.activeChapterId()) ?? null);
  protected readonly exportingPdf = signal(false);
  protected readonly pdfDownload = signal<{ fileUrl: string; fileName: string } | null>(null);
  protected readonly pdfError = signal('');
  protected readonly pdfPageFormat = signal<PdfPageFormat>('a4');

  ngOnInit(): void {
    void this.loadPreview();
  }

  protected scrollToChapter(chapterId: string): void {
    this.activeChapterId.set(chapterId);
    document.getElementById(`chapter-${chapterId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected async createPdf(): Promise<void> {
    const bookId = this.preview()?.book.id;
    if (!bookId || this.exportingPdf()) return;
    this.exportingPdf.set(true);
    this.pdfError.set('');
    this.pdfDownload.set(null);
    try {
      const generated = await this.bookExport.exportPdf(bookId, this.pdfPageFormat());
      this.pdfDownload.set({ fileUrl: generated.fileUrl, fileName: generated.fileName });
    } catch (error: unknown) {
      this.pdfError.set(error instanceof Error ? error.message : 'Unable to export this book as PDF.');
    } finally {
      this.exportingPdf.set(false);
    }
  }

  protected async downloadPdf(): Promise<void> {
    const pdf = this.pdfDownload();
    if (!pdf) return;
    try {
      await this.bookExport.downloadPdf(pdf.fileUrl, pdf.fileName);
    } catch (error: unknown) {
      this.pdfError.set(error instanceof Error ? error.message : 'Unable to download this PDF.');
    }
  }

  private async loadPreview(): Promise<void> {
    this.state.set('loading');
    this.errorMessage.set('');

    try {
      const bookId = this.route.snapshot.paramMap.get('id');
      if (!bookId) throw new Error('The preview URL is missing a book ID.');

      const user = await this.supabase.getCurrentUser();
      if (!user?.id) throw new Error('Sign in to preview this book.');

      const { data: book, error: bookError } = await this.supabase.client
        .from('books')
        .select('id, title, author_name, template, total_words, source_format')
        .eq('id', bookId)
        .eq('user_id', user.id)
        .single();
      if (bookError) throw bookError;
      if (!book) throw new Error('This book could not be found in your library.');

      const { data: chapters, error: chaptersError } = await this.supabase.client
        .from('chapters')
        .select('id, position, title, content, word_count')
        .eq('book_id', book.id)
        .order('position', { ascending: true });
      if (chaptersError) throw chaptersError;

      const formatted = this.formatter.formatBook(book as BookRow, (chapters ?? []) as ChapterRow[]);
      if (formatted.chapters.length === 0) throw new Error('This book does not have any chapters to preview yet.');

      this.preview.set(formatted);
      this.activeChapterId.set(formatted.chapters[0]?.id ?? '');
      this.state.set('ready');
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Unable to load this book preview.');
      this.state.set('error');
    }
  }
}
