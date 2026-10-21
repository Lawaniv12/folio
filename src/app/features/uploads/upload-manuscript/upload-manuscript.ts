import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { BookImportService } from '../../../core/services/book-import.service';
import { Storage } from '../../../core/services/storage';
import { Supabase } from '../../../core/services/supabase';

type ImportState = 'idle' | 'uploading' | 'importing' | 'success' | 'error';
const manuscriptBucket = 'uploads';

@Component({
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  selector: 'app-upload-manuscript',
  styleUrl: './upload-manuscript.scss',
  templateUrl: './upload-manuscript.html',
})
export class UploadManuscript {
  private readonly router = inject(Router);
  private readonly supabase = inject(Supabase);
  private readonly storage = inject(Storage);
  private readonly bookImport = inject(BookImportService);

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly title = signal('');
  protected readonly author = signal('');
  protected readonly state = signal<ImportState>('idle');
  protected readonly progress = signal(0);
  protected readonly message = signal('');
  protected readonly isBusy = computed(() => this.state() === 'uploading' || this.state() === 'importing');

  protected onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      this.setError('Choose a Microsoft Word DOCX manuscript.');
      this.selectedFile.set(null);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      this.setError('This file is larger than the 50 MB upload limit.');
      this.selectedFile.set(null);
      return;
    }
    if (file.size === 0) {
      this.setError('This DOCX file is empty. Choose another manuscript.');
      this.selectedFile.set(null);
      return;
    }
    this.state.set('idle');
    this.message.set('');
    this.progress.set(0);
    this.selectedFile.set(file);
    if (!this.title()) this.title.set(file.name.replace(/\.docx$/i, '').replace(/[_-]/g, ' '));
  }

  protected async prepareBook(): Promise<void> {
    const file = this.selectedFile();
    if (!file) {
      this.setError('Add your DOCX manuscript file to continue.');
      return;
    }
    if (this.isBusy()) return;

    let uploadedPath: string | null = null;
    let importerOwnsUpload = false;
    let progressTimer: number | undefined;

    try {
      this.message.set('Checking your studio session…');
      this.state.set('uploading');
      this.progress.set(5);
      const user = await this.supabase.getCurrentUser();
      if (!user) throw new Error('Sign in to your studio before uploading a manuscript.');

      const path = `${user.id}/${crypto.randomUUID()}-${this.safeFileName(file.name)}`;
      uploadedPath = path;
      this.message.set('Uploading your manuscript…');
      progressTimer = window.setInterval(() => this.progress.update((value) => Math.min(value + 2, 55)), 180);
      console.group('UPLOAD DEBUG');

      console.log('Bucket:', 'uploads');
      console.log('Path:', path);
      console.log('File Name:', file.name);
      console.log('File Type:', file.type);
      console.log('File Size:', file.size);

      console.groupEnd();
      await this.storage.uploadFile(manuscriptBucket, path, file);
      window.clearInterval(progressTimer);
      progressTimer = undefined;
      this.progress.set(62);

      const publicUrl = this.storage.getPublicUrl(manuscriptBucket, path);
      this.state.set('importing');
      this.message.set('Reading chapters and creating your book…');
      progressTimer = window.setInterval(() => this.progress.update((value) => Math.min(value + 1, 94)), 450);
      importerOwnsUpload = true;

      const bookId = await this.bookImport.importDocx(file, {
        authorName: this.author().trim() || undefined,
        title: this.title().trim() || undefined,
        uploadedSource: { bucket: manuscriptBucket, path, publicUrl },
      });

      window.clearInterval(progressTimer);
      progressTimer = undefined;
      uploadedPath = null;
      this.progress.set(100);
      this.state.set('success');
      this.message.set('Import complete. Opening your new book…');
      await this.router.navigate(['/books', bookId], { state: { importedBook: true } });
    } catch (error: unknown) {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      if (uploadedPath && !importerOwnsUpload) {
        try {
          await this.storage.deleteFile(manuscriptBucket, uploadedPath);
        } catch {
          // Keep the original upload error visible; cleanup is best-effort.
        }
      }
      this.setError(error instanceof Error ? error.message : 'Something went wrong while importing your manuscript.');
    }
  }

  private setError(message: string): void {
    this.state.set('error');
    this.progress.set(0);
    this.message.set(message);
  }

  private safeFileName(fileName: string): string {
    return fileName.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'manuscript.docx';
  }
}
