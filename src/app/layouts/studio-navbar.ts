import { Component, computed, inject, Injector, OnInit, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Supabase } from '../core/services/supabase';

@Component({
  selector: 'app-studio-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './studio-navbar.html',
  styleUrl: './studio-navbar.scss',
})
export class StudioNavbar implements OnInit {
  private readonly injector = inject(Injector);
  private readonly supabase = signal<Supabase | null>(null);
  protected readonly profile = computed(() => this.supabase()?.studioProfile() ?? {
    displayName: 'Author',
    initials: 'AU',
    publisherName: 'My Publishing Studio',
    authorName: 'Author',
    email: '',
  });
  readonly menuClick = output<void>();

  async ngOnInit(): Promise<void> {
    const { Supabase } = await import('../core/services/supabase');
    const service = this.injector.get(Supabase);
    this.supabase.set(service);
    await service.getCurrentUser();
  }
}
