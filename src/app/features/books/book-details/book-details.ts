import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BookExportService, type PdfPageFormat } from '../../../core/services/book-export.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  selector: 'app-book-details',
  styleUrl: './book-details.scss',
  templateUrl: './book-details.html',
})
export class BookDetails {
  private readonly route = inject(ActivatedRoute);
  private readonly bookExport = inject(BookExportService);
  protected readonly bookId = this.route.snapshot.paramMap.get('bookId') ?? '';
  protected readonly importSucceeded = signal(this.readNavigationState());
  protected readonly exportingPdf = signal(false);
  protected readonly pdfDownload = signal<{ fileUrl: string; fileName: string } | null>(null);
  protected readonly pdfError = signal('');
  protected readonly pdfPageFormat = signal<PdfPageFormat>('a4');

  protected async createPdf(): Promise<void> {
    if (!this.bookId || this.exportingPdf()) return;
    this.exportingPdf.set(true);
    this.pdfError.set('');
    this.pdfDownload.set(null);
    try {
      const generated = await this.bookExport.exportPdf(this.bookId, this.pdfPageFormat());
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

  private readNavigationState(): boolean {
    if (typeof window === 'undefined') return false;
    return (window.history.state as { importedBook?: unknown }).importedBook === true;
  }
}
