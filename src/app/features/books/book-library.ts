import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Supabase } from '../../core/services/supabase';

interface LibraryBook {
  id: string;
  title: string;
  author_name: string;
  total_words: number;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-book-library',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './book-library.html',
  styleUrl: './book-library.scss',
})
export class BookLibrary implements OnInit {
  private readonly supabase = inject(Supabase);
  protected readonly profile = this.supabase.studioProfile;

  protected readonly query = signal('');
  protected readonly filter = signal('All books');
  protected readonly books = signal<LibraryBook[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly statuses = computed(() => ['All books', ...new Set(this.books().map((book) => book.status).filter(Boolean))]);
  protected readonly filteredBooks = computed(() => this.books().filter((book) => {
    const matchesQuery = `${book.title} ${book.author_name} ${book.status}`.toLowerCase().includes(this.query().trim().toLowerCase());
    return matchesQuery && (this.filter() === 'All books' || book.status === this.filter());
  }));

  ngOnInit(): void {
    void this.loadBooks();
  }

  protected async reloadBooks(): Promise<void> {
    await this.loadBooks();
  }

  private async loadBooks(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const user = await this.supabase.getCurrentUser();
      if (!user?.id) throw new Error('Sign in to view your books.');

      const { data, error } = await this.supabase.client
        .from('books')
        .select('id, title, author_name, total_words, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      this.books.set((data ?? []) as LibraryBook[]);
    } catch (error: unknown) {
      this.books.set([]);
      this.errorMessage.set(error instanceof Error ? error.message : 'Unable to load your books. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
