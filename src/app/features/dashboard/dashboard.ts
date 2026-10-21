import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Supabase } from '../../core/services/supabase';

interface RecentBook {
  id: string;
  title: string;
  author_name: string;
  total_words: number;
  status: string;
  created_at: string;
}

@Component({
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink],
  selector: 'app-dashboard',
  styleUrl: './dashboard.scss',
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit {
  private readonly supabase = inject(Supabase);
  protected readonly profile = this.supabase.studioProfile;

  protected readonly books = signal<RecentBook[]>([]);
  protected readonly recentBooks = computed(() => this.books().slice(0, 4));
  protected readonly loadingBooks = signal(true);
  protected readonly bookError = signal('');

  ngOnInit(): void {
    void this.loadBooks();
  }

  private async loadBooks(): Promise<void> {
    try {
      const user = await this.supabase.getCurrentUser();
      if (!user?.id) throw new Error('Sign in to view your studio books.');
      const { data, error } = await this.supabase.client
        .from('books')
        .select('id, title, author_name, total_words, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      this.books.set((data ?? []) as RecentBook[]);
    } catch (error: unknown) {
      this.bookError.set(error instanceof Error ? error.message : 'Unable to load your books.');
    } finally {
      this.loadingBooks.set(false);
    }
  }
}
