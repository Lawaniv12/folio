import { FormatterService, type FormatterBookInput, type FormatterChapterInput } from './formatter.service';

describe('FormatterService chapter display formatting', () => {
  const formatter = new FormatterService();
  const book: FormatterBookInput = {
    id: 'book-1',
    title: 'A Book',
    author_name: 'A. Author',
    template: 'novel',
    total_words: 100,
    source_format: 'docx',
  };

  function formatChapter(position: number, title: string) {
    const chapter: FormatterChapterInput = {
      id: `chapter-${position}`,
      position,
      title,
      content: 'A little text for this chapter.',
      word_count: 6,
    };
    return formatter.formatBook(book, [chapter]).chapters[0];
  }

  it('extracts an explicit Arabic chapter number and clean title without changing position', () => {
    const chapter = formatChapter(4, 'Chapter 3 - Long-Term Success');

    expect(chapter.chapterLabel).toBe('CHAPTER 3');
    expect(chapter.title).toBe('Long-Term Success');
    expect(chapter.position).toBe(4);
  });

  it('extracts numbered titles using a colon and keeps the title clean in the TOC', () => {
    const preview = formatter.formatBook(book, [{
      id: 'chapter-2',
      position: 2,
      title: 'Chapter 2: Building Momentum',
      content: 'A little text for this chapter.',
      word_count: 6,
    }]);

    expect(preview.tableOfContents[0]?.chapterLabel).toBe('CHAPTER 2');
    expect(preview.tableOfContents[0]?.title).toBe('Building Momentum');
  });

  it.each(['Introduction', 'Prologue', 'Preface', 'Foreword', 'Acknowledgements', 'Appendix', 'Afterword', 'Epilogue'])(
    'does not number front/back matter: %s',
    (title) => {
      const chapter = formatChapter(5, title);
      expect(chapter.chapterLabel).toBeNull();
      expect(chapter.title).toBe(title);
      expect(chapter.position).toBe(5);
    },
  );

  it('does not repeat the chapter number when the source heading contains only its number', () => {
    const chapter = formatChapter(1, 'Chapter 1');

    expect(chapter.chapterLabel).toBe('CHAPTER 1');
    expect(chapter.title).toBe('');
  });

  it('numbers main chapters sequentially without counting front matter or duplicating explicit labels', () => {
    const preview = formatter.formatBook(book, [
      { id: 'intro', position: 1, title: 'Introduction', content: 'Opening.', word_count: 1 },
      { id: 'first', position: 2, title: 'Chapter 1: Starting Small', content: 'First.', word_count: 1 },
      { id: 'duplicate', position: 3, title: 'Chapter 1: Building On', content: 'Second.', word_count: 1 },
      { id: 'next', position: 4, title: 'A New Direction', content: 'Third.', word_count: 1 },
      { id: 'thanks', position: 5, title: 'Acknowledgements', content: 'Thanks.', word_count: 1 },
    ]);

    expect(preview.presentation.sections.map((section) => section.type)).toEqual(['front-matter', 'main-content', 'back-matter']);
    expect(preview.chapters.map(({ id, chapterLabel, title }) => ({ id, chapterLabel, title }))).toEqual([
      { id: 'intro', chapterLabel: null, title: 'Introduction' },
      { id: 'first', chapterLabel: 'CHAPTER 1', title: 'Starting Small' },
      { id: 'duplicate', chapterLabel: 'CHAPTER 2', title: 'Building On' },
      { id: 'next', chapterLabel: 'CHAPTER 3', title: 'A New Direction' },
      { id: 'thanks', chapterLabel: null, title: 'Acknowledgements' },
    ]);
    expect(preview.presentation.tableOfContents).toEqual(preview.tableOfContents);
  });
});
