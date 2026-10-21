import { Injectable, inject } from '@angular/core';
import { Supabase } from './supabase';

export type PublishingAssetType =
  | 'copyright-page'
  | 'author-bio'
  | 'book-description'
  | 'amazon-description'
  | 'categories'
  | 'keywords'
  | 'back-cover-copy';

export interface PublishingCategoryScore {
  score: number;
  summary: string;
}

export interface PublishingIssue {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface PublishingAnalysis {
  score: number;
  categories: {
    structure: PublishingCategoryScore;
    formatting: PublishingCategoryScore;
    consistency: PublishingCategoryScore;
    readability: PublishingCategoryScore;
    completeness: PublishingCategoryScore;
  };
  strengths: string[];
  issuesFound: PublishingIssue[];
  recommendations: string[];
}

export interface GeneratedPublishingAsset {
  assetType: PublishingAssetType;
  title: string;
  content: string;
  caveat?: string;
}

@Injectable({ providedIn: 'root' })
export class PublishingAssistantService {
  private readonly supabase = inject(Supabase);
  private readonly functionName = 'publishing-assistant';

  analyzeBook(bookId: string): Promise<PublishingAnalysis> {
    return this.invoke<PublishingAnalysis>({ action: 'analyze', bookId });
  }

  generateAsset(bookId: string, assetType: PublishingAssetType): Promise<GeneratedPublishingAsset> {
    return this.invoke<GeneratedPublishingAsset>({ action: 'asset', bookId, assetType });
  }

  private async invoke<T>(body: Record<string, string>): Promise<T> {
    const { data, error } = await this.supabase.client.functions.invoke(this.functionName, { body });
    if (error) {
      const context = error.context as { json?: () => Promise<{ error?: string }> } | undefined;
      const response = await context?.json?.().catch(() => null);
      throw new Error(response?.error || error.message || 'The publishing assistant could not complete this request.');
    }
    if (!data || typeof data !== 'object') throw new Error('The publishing assistant returned an empty response.');
    return data as T;
  }
}