import { Injectable } from '@angular/core';

export interface FormatterBookInput {
  id: string;
  title: string;
  author_name: string;
  template: string;
  total_words: number;
  source_format: string;
}

export interface FormatterChapterInput {
  id: string;
  position: number;
  title: string;
  content: string;
  word_count: number;
}

export interface FormattedChapter {
  id: string;
  position: number;
  section: 'front-matter' | 'main-content' | 'back-matter';
  chapterLabel: string | null;
  title: string;
  paragraphs: string[];
  wordCount: number;
  estimatedPages: number;
  firstPage: number;
}

export interface FormattedBookSection {
  type: FormattedChapter['section'];
  label: string;
  chapters: FormattedChapter[];
}

export interface BookPresentationModel {
  titlePage: {
    title: string;
    author: string;
    overline: string;
    imprint: string;
    ornament: string;
  };
  copyrightPage: {
    copyrightLine: string;
    rightsLine: string;
  };
  contentsPage: {
    overline: string;
    title: string;
  };
  sections: FormattedBookSection[];
  chapters: FormattedChapter[];
  tableOfContents: Array<Pick<FormattedChapter, 'id' | 'position' | 'chapterLabel' | 'title' | 'firstPage'>>;
  typography: {
    pageMarginMm: number;
    bodyFontPt: number;
    bodyLineHeightMm: number;
    chapterTitleFontPt: number;
    chapterLabelFontPt: number;
    paragraphSpacingMm: number;
    titleFontPt: number;
    contentsTitleFontPt: number;
    tocFontPt: number;
    runningHeaderFontPt: number;
    footerFontPt: number;
    bodyFontFamily: string;
    headingFontFamily: string;
  };
  colors: {
    paper: string;
    ink: string;
    muted: string;
    accent: string;
    rule: string;
  };
}

export interface FormattedPreview {
  book: FormatterBookInput;
  chapters: FormattedChapter[];
  presentation: BookPresentationModel;
  tableOfContents: Array<Pick<FormattedChapter, 'id' | 'position' | 'chapterLabel' | 'title' | 'firstPage'>>;
  totalWords: number;
  estimatedPages: number;
}

@Injectable({ providedIn: 'root' })
export class FormatterService {
  private readonly wordsPerPage = 250;

  formatBook(book: FormatterBookInput, chapters: FormatterChapterInput[]): FormattedPreview {
    let nextChapterNumber = 1;
    const usedChapterLabels = new Set<string>();
    const normalizedChapters = [...chapters]
      .sort((first, second) => first.position - second.position)
      .map((chapter) => {
        const paragraphs = this.normalizeSpacing(chapter.content);
        const wordCount = this.calculateWordCount(paragraphs.join(' '));
        const estimatedPages = Math.max(1, Math.ceil(wordCount / this.wordsPerPage));
        const section = this.classifySection(chapter.title);
        let chapterNumber = 0;
        let duplicateExplicitNumber = false;
        if (section === 'main-content') {
          const explicitNumber = chapter.title.match(/^(?:chapter|chap\.?)\s+(\d+|[ivxlcdm]+)/i)?.[1]?.toLocaleUpperCase();
          const explicitLabel = explicitNumber ? `CHAPTER ${explicitNumber}` : null;
          if (explicitLabel && !usedChapterLabels.has(explicitLabel)) {
            usedChapterLabels.add(explicitLabel);
            chapterNumber = Number.parseInt(explicitNumber!, 10) || 0;
            if (chapterNumber) nextChapterNumber = Math.max(nextChapterNumber, chapterNumber + 1);
          } else {
            duplicateExplicitNumber = Boolean(explicitLabel);
            while (usedChapterLabels.has(`CHAPTER ${nextChapterNumber}`)) nextChapterNumber += 1;
            chapterNumber = nextChapterNumber++;
            usedChapterLabels.add(`CHAPTER ${chapterNumber}`);
          }
        }
        const displayHeading = this.formatChapterHeading(chapter.title, chapterNumber, section, duplicateExplicitNumber);
        return {
          id: chapter.id,
          position: chapter.position,
          section,
          chapterLabel: displayHeading.chapterLabel,
          title: displayHeading.title,
          paragraphs,
          wordCount,
          estimatedPages,
          firstPage: 0,
        };
      });

    const sectionOrder: FormattedChapter['section'][] = ['front-matter', 'main-content', 'back-matter'];
    const orderedChapters = normalizedChapters.sort((first, second) =>
      sectionOrder.indexOf(first.section) - sectionOrder.indexOf(second.section) || first.position - second.position,
    );

    let nextPage = 4;
    const formattedChapters = orderedChapters.map((chapter) => {
      const formattedChapter = { ...chapter, firstPage: nextPage };
      nextPage += chapter.estimatedPages;
      return formattedChapter;
    });

    const normalizedBook = { ...book, title: this.normalizeHeading(book.title, 0) };
    const tableOfContents = formattedChapters.map(({ id, position, chapterLabel, title, firstPage }) => ({ id, position, chapterLabel, title, firstPage }));
    const sections: FormattedBookSection[] = sectionOrder
      .map((type) => ({
        type,
        label: type === 'front-matter' ? 'Front Matter' : type === 'back-matter' ? 'Back Matter' : 'Chapters',
        chapters: formattedChapters.filter((chapter) => chapter.section === type),
      }))
      .filter((section) => section.chapters.length > 0);
    const totalWords = formattedChapters.reduce((total, chapter) => total + chapter.wordCount, 0);
    const estimatedPages = formattedChapters.reduce((total, chapter) => total + chapter.estimatedPages, 3);
    const presentation: BookPresentationModel = {
      titlePage: {
        title: normalizedBook.title,
        author: normalizedBook.author_name,
        overline: 'A FOLIO READER EDITION',
        imprint: 'FOLIO · AUTHOR STUDIO',
        ornament: '✦',
      },
      copyrightPage: {
        copyrightLine: `Copyright © ${new Date().getFullYear()}`,
        rightsLine: 'All rights reserved.',
      },
      contentsPage: {
        overline: 'CONTENTS',
        title: 'Inside this book',
      },
      sections,
      chapters: formattedChapters,
      tableOfContents,
      typography: {
        pageMarginMm: 25,
        bodyFontPt: 11.5,
        bodyLineHeightMm: 6,
        chapterTitleFontPt: 25,
        chapterLabelFontPt: 9,
        paragraphSpacingMm: 5,
        titleFontPt: 30,
        contentsTitleFontPt: 25,
        tocFontPt: 11,
        runningHeaderFontPt: 8,
        footerFontPt: 8,
        bodyFontFamily: 'Georgia, Times New Roman, serif',
        headingFontFamily: 'Georgia, Times New Roman, serif',
      },
      colors: {
        paper: '#fbf8f2',
        ink: '#302d2b',
        muted: '#88745d',
        accent: '#92775a',
        rule: '#d2c9bc',
      },
    };

    return {
      book: normalizedBook,
      chapters: formattedChapters,
      presentation,
      tableOfContents,
      totalWords,
      estimatedPages,
    };
  }

  normalizeSpacing(content: string): string[] {
    return content
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\u00a0 ]+/g, ' ')
      .split(/\n\s*\n|\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  normalizeHeading(heading: string, position: number): string {
    const normalized = heading.replace(/\s+/g, ' ').trim();
    if (!normalized) return position > 0 ? `Chapter ${position}` : 'Untitled';

    return normalized.replace(/^(chapter|chap\.?)\s+(\d+)/i, (_match, _prefix: string, number: string) => `Chapter ${number}`)
      .replace(/^part\s+(\d+)/i, (_match, number: string) => `Part ${number}`);
  }

  private formatChapterHeading(heading: string, chapterNumber: number, section: FormattedChapter['section'], duplicateExplicitNumber = false): { chapterLabel: string | null; title: string } {
    const normalized = heading.replace(/\s+/g, ' ').trim();
    if (section !== 'main-content') {
      return { chapterLabel: null, title: normalized };
    }
    if (!normalized) return { chapterLabel: `CHAPTER ${chapterNumber}`, title: '' };

    const numberedChapter = normalized.match(/^(?:chapter|chap\.?)\s+(\d+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*|\s+)?(.*)$/iu);
    if (numberedChapter) {
      const number = numberedChapter[1];
      const extractedTitle = numberedChapter[2].trim();
      if (duplicateExplicitNumber) {
        return { chapterLabel: `CHAPTER ${chapterNumber}`, title: extractedTitle };
      }
      return {
        chapterLabel: `CHAPTER ${number.toLocaleUpperCase()}`,
        title: extractedTitle,
      };
    }

    return {
      chapterLabel: `CHAPTER ${chapterNumber}`,
      title: this.normalizeHeading(normalized, chapterNumber),
    };
  }

  private classifySection(title: string): FormattedChapter['section'] {
    const normalized = title.trim();
    if (/^(introduction|prologue|preface|foreword)(?:\b|\s*[:.\-–—])/iu.test(normalized)) return 'front-matter';
    if (/^(afterword|appendix|acknowledg(?:e)?ments?|epilogue)(?:\b|\s*[:.\-–—])/iu.test(normalized)) return 'back-matter';
    return 'main-content';
  }

  calculateWordCount(content: string): number {
    return content.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  }
}
