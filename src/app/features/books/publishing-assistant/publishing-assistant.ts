import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  PublishingAssistantService,
  type GeneratedPublishingAsset,
  type PublishingAnalysis,
  type PublishingAssetType,
} from '../../../core/services/publishing-assistant.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  selector: 'app-publishing-assistant',
  styleUrl: './publishing-assistant.scss',
  templateUrl: './publishing-assistant.html',
})
export class PublishingAssistant {
  private readonly route = inject(ActivatedRoute);
  private readonly assistant = inject(PublishingAssistantService);
  protected readonly bookId = this.route.snapshot.paramMap.get('bookId') ?? '';
  protected readonly consent = signal(false);
  protected readonly analysis = signal<PublishingAnalysis | null>(null);
  protected readonly generatedAssets = signal<GeneratedPublishingAsset[]>([]);
  protected readonly analyzing = signal(false);
  protected readonly generatingAsset = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly notice = signal('');
  protected readonly selectedAsset = signal<PublishingAssetType>('book-description');
  protected readonly scoreTone = computed(() => {
    const score = this.analysis()?.score ?? 0;
    return score >= 80 ? 'strong' : score >= 60 ? 'developing' : 'needs-work';
  });

  protected readonly categories: Array<{ key: keyof PublishingAnalysis['categories']; label: string }> = [
    { key: 'structure', label: 'Structure' },
    { key: 'formatting', label: 'Formatting' },
    { key: 'consistency', label: 'Consistency' },
    { key: 'readability', label: 'Readability' },
    { key: 'completeness', label: 'Completeness' },
  ];

  protected readonly assets: Array<{ value: PublishingAssetType; label: string; description: string }> = [
    { value: 'copyright-page', label: 'Copyright Page', description: 'A publication-ready copyright-page draft with placeholders for legal details.' },
    { value: 'author-bio', label: 'Author Bio', description: 'A concise author bio; unknown personal facts will be left as placeholders.' },
    { value: 'book-description', label: 'Book Description', description: 'A reader-facing summary grounded in the supplied manuscript.' },
    { value: 'amazon-description', label: 'Amazon Description', description: 'A storefront description with clear hooks and scannable formatting.' },
    { value: 'categories', label: 'Categories', description: 'Suggested bookstore categories for author review.' },
    { value: 'keywords', label: 'Keywords', description: 'Discoverability keyword phrases; suggestions only, not guaranteed rankings.' },
    { value: 'back-cover-copy', label: 'Back Cover Copy', description: 'Short promotional copy grounded in the book’s content.' },
  ];

  protected get selectedAssetDescription(): string {
    return this.assets.find((asset) => asset.value === this.selectedAsset())?.description ?? '';
  }

  protected setConsent(event: Event): void {
    this.consent.set((event.target as HTMLInputElement).checked);
  }

  protected setAsset(event: Event): void {
    this.selectedAsset.set((event.target as HTMLSelectElement).value as PublishingAssetType);
  }

  protected async analyzeBook(): Promise<void> {
    if (!this.canSend() || this.analyzing()) return;
    this.analyzing.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    try {
      this.analysis.set(await this.assistant.analyzeBook(this.bookId));
    } catch (error: unknown) {
      this.errorMessage.set(this.message(error));
    } finally {
      this.analyzing.set(false);
      this.consent.set(false);
    }
  }

  protected async generateAsset(): Promise<void> {
    if (!this.canSend() || this.generatingAsset()) return;
    this.generatingAsset.set(true);
    this.errorMessage.set('');
    this.notice.set('');
    try {
      const asset = await this.assistant.generateAsset(this.bookId, this.selectedAsset());
      this.generatedAssets.update((assets) => [asset, ...assets.filter((item) => item.assetType !== asset.assetType)]);
    } catch (error: unknown) {
      this.errorMessage.set(this.message(error));
    } finally {
      this.generatingAsset.set(false);
      this.consent.set(false);
    }
  }

  protected async copyAsset(content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      this.notice.set('Draft copied to clipboard.');
    } catch {
      this.notice.set('Clipboard access is unavailable. Select and copy the draft text.');
    }
  }

  private canSend(): boolean {
    if (!this.bookId) {
      this.errorMessage.set('This page is missing a book ID. Return to your library and open the assistant from a book.');
      return false;
    }
    if (!this.consent()) {
      this.errorMessage.set('Confirm manuscript sharing before sending a request to the AI publishing assistant.');
      return false;
    }
    return true;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'The publishing assistant could not complete this request.';
  }
}