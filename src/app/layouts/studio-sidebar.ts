import { Component, computed, inject, Injector, input, OnInit, output, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import type { Supabase } from '../core/services/supabase';

@Component({
  selector: 'app-studio-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './studio-sidebar.html',
  styleUrl: './studio-sidebar.scss',
})
export class StudioSidebar implements OnInit {
  private readonly injector = inject(Injector);
  private readonly supabase = signal<Supabase | null>(null);
  private readonly router = inject(Router);

  readonly open = input(false);
  readonly closeMenu = output<void>();
  protected readonly profile = computed(() => this.supabase()?.studioProfile() ?? {
    displayName: 'Author',
    initials: 'AU',
    publisherName: 'My Publishing Studio',
    authorName: 'Author',
    email: '',
  });
  protected readonly logoutError = signal('');
  protected readonly isSigningOut = signal(false);
  protected readonly workspaceInitials = computed(() => this.profile().publisherName
    .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase() ?? '').join('') || 'MS');

  async ngOnInit(): Promise<void> {
    const { Supabase } = await import('../core/services/supabase');
    const service = this.injector.get(Supabase);
    this.supabase.set(service);
    await service.getCurrentUser();
  }

  protected readonly items = [
    { label: 'Dashboard', path: '/dashboard', icon: 'grid' },
    { label: 'My Books', path: '/books', icon: 'book' },
    { label: 'Upload', path: '/upload', icon: 'upload' },
    { label: 'Exports', path: '/exports', icon: 'file' },
    { label: 'Settings', path: '/settings', icon: 'settings' },
  ];

  protected async signOut(): Promise<void> {
    if (this.isSigningOut()) return;
    this.isSigningOut.set(true);
    this.logoutError.set('');
    try {
      const service = this.supabase();
      if (!service) throw new Error('Account profile is still loading. Please try again.');
      await service.signOut();
      this.closeMenu.emit();
      await this.router.navigate(['/login']);
    } catch (error: unknown) {
      this.logoutError.set(error instanceof Error ? error.message : 'Unable to sign out. Please try again.');
    } finally {
      this.isSigningOut.set(false);
    }
  }
}
