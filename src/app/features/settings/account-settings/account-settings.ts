import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Supabase } from '../../../core/services/supabase';

@Component({
  standalone: true,
  imports: [FormsModule],
  selector: 'app-account-settings',
  styleUrl: './account-settings.scss',
  templateUrl: './account-settings.html',
})
export class AccountSettings implements OnInit {
  private readonly supabase = inject(Supabase);
  protected readonly profile = this.supabase.studioProfile;

  protected readonly saved = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  protected readonly emailUpdates = signal(true);
  protected readonly exportNotices = signal(true);
  protected readonly productNews = signal(false);
  protected displayName = '';
  protected email = '';
  protected imprint = '';
  protected defaultAuthor = '';
  protected language = 'English (US)';

  protected get initials(): string {
    return this.profile().initials;
  }

  async ngOnInit(): Promise<void> {
    try {
      const user = await this.supabase.getCurrentUser();
      if (!user) return;
      const metadata = user.user_metadata;
      const profile = this.profile();
      this.displayName = profile.displayName;
      this.email = profile.email;
      this.imprint = this.metadataString(metadata['publisher_name']);
      this.defaultAuthor = profile.authorName;
      const proofingLanguage = metadata['proofing_language'];
      this.language = typeof proofingLanguage === 'string' && proofingLanguage.trim()
        ? proofingLanguage.trim()
        : 'English (US)';
      this.emailUpdates.set(metadata['email_updates'] !== false);
      this.exportNotices.set(metadata['export_notices'] !== false);
      this.productNews.set(metadata['product_news'] === true);
    } catch (error: unknown) {
      this.saveError.set(error instanceof Error ? error.message : 'Unable to load your account profile.');
    }
  }

  protected async saveSettings(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set('');

    try {
      await this.supabase.updateUserMetadata({
          display_name: this.displayName.trim(),
          full_name: this.displayName.trim(),
          author_name: this.defaultAuthor.trim(),
          publisher_name: this.imprint.trim(),
          proofing_language: this.language,
          email_updates: this.emailUpdates(),
          export_notices: this.exportNotices(),
          product_news: this.productNews(),
      });

      this.displayName = this.displayName.trim();
      this.defaultAuthor = this.defaultAuthor.trim();
      this.imprint = this.imprint.trim();
      this.saved.set(true);
      window.setTimeout(() => this.saved.set(false), 4000);
    } catch (error: unknown) {
      this.saveError.set(error instanceof Error ? error.message : 'Unable to save your profile. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  private metadataString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
