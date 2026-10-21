import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { PublishingAssistantService } from '../../../core/services/publishing-assistant.service';
import { PublishingAssistant } from './publishing-assistant';

describe('PublishingAssistant', () => {
  const analyzeBook = vi.fn();
  const generateAsset = vi.fn();

  beforeEach(async () => {
    analyzeBook.mockReset();
    generateAsset.mockReset();
    await TestBed.configureTestingModule({
      imports: [PublishingAssistant],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'book-123' } } } },
        { provide: PublishingAssistantService, useValue: { analyzeBook, generateAsset } },
      ],
    }).compileComponents();
  });

  it('requires consent before analyzing manuscript content', async () => {
    const fixture = TestBed.createComponent(PublishingAssistant);
    const component = fixture.componentInstance as unknown as { analyzeBook(): Promise<void>; errorMessage: () => string };

    await component.analyzeBook();

    expect(analyzeBook).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('Confirm manuscript sharing');
  });

  it('requests analysis only after the user opts in', async () => {
    analyzeBook.mockResolvedValue({ score: 80, categories: {}, strengths: [], issuesFound: [], recommendations: [] });
    const fixture = TestBed.createComponent(PublishingAssistant);
    const component = fixture.componentInstance as unknown as {
      consent: { (): boolean; set(value: boolean): void };
      analyzeBook(): Promise<void>;
      analysis: () => unknown;
    };
    component.consent.set(true);

    await component.analyzeBook();

    expect(analyzeBook).toHaveBeenCalledWith('book-123');
    expect(component.analysis()).toBeTruthy();
    expect(component.consent()).toBe(false);
  });

  it('requests only the selected optional asset', async () => {
    generateAsset.mockResolvedValue({ assetType: 'book-description', title: 'Book Description', content: 'Draft copy.' });
    const fixture = TestBed.createComponent(PublishingAssistant);
    const component = fixture.componentInstance as unknown as {
      consent: { (): boolean; set(value: boolean): void };
      generateAsset(): Promise<void>;
      generatedAssets: () => Array<{ content: string }>;
    };
    component.consent.set(true);

    await component.generateAsset();

    expect(generateAsset).toHaveBeenCalledWith('book-123', 'book-description');
    expect(component.generatedAssets()[0]?.content).toBe('Draft copy.');
    expect(component.consent()).toBe(false);
  });
});