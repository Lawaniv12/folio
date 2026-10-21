import { Injectable, inject } from '@angular/core';
import * as mammoth from 'mammoth';
import { Storage as SupabaseStorage } from './storage';
import { Supabase } from './supabase';

export interface BookImportOptions {
    title?: string;
    authorName?: string;
    template?: string;
    uploadedSource?: {
        bucket: string;
        path: string;
        publicUrl: string;
    };
}

export type BookTemplate = 'novel' | 'business' | 'academic';

export interface ParsedChapter {
    position: number;
    title: string;
    content: string;
    word_count: number;
}

export interface BookRecordInsert {
    user_id: string;
    title: string;
    author_name: string;
    status: 'draft';
    template: BookTemplate;
    total_words: number;
    source_file_url: string;
    source_format: 'docx';
}

export interface ChapterRecordInsert extends ParsedChapter {
    book_id: string;
}

export class BookImportError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'BookImportError';
    }
}

interface ChapterHeading {
    lineIndex: number;
    title: string;
}

@Injectable({ providedIn: 'root' })
export class BookImportService {
    private readonly supabase = inject(Supabase);
    private readonly storage = inject(SupabaseStorage);
    private readonly manuscriptBucket = 'uploads';

    /** Extracts a DOCX manuscript, stores its source, and creates its book and chapter records. */
    async importDocx(file: File, options: BookImportOptions = {}): Promise<string> {
        this.validateDocx(file);

        let uploadedPath: string | null = options.uploadedSource?.path ?? null;
        let uploadedBucket = options.uploadedSource?.bucket ?? this.manuscriptBucket;
        let createdBookId: string | null = null;

        try {
            const user = await this.supabase.getCurrentUser();
            if (!user) {
                throw new BookImportError('Sign in before importing a manuscript.');
            }
            if (!user.id.trim()) {
                throw new BookImportError('The authenticated account does not have a valid user ID. Sign in again and retry.');
            }

            const extracted = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
            const manuscriptText = this.normalizeText(extracted.value);
            if (!manuscriptText) {
                throw new BookImportError('This DOCX file does not contain readable text.');
            }

            const parsed = this.parseManuscript(manuscriptText, file.name);
            const authorName = this.resolveAuthorName(options.authorName, user.user_metadata, user.email);
            if (!options.uploadedSource) {
                const safeFileName = this.safeFileName(file.name);
                uploadedPath = `${user.id}/${crypto.randomUUID()}-${safeFileName}`;
                uploadedBucket = this.manuscriptBucket;
                await this.storage.uploadFile(this.manuscriptBucket, uploadedPath, file);
            }
            const sourceFileUrl = options.uploadedSource?.publicUrl
                ?? this.storage.getPublicUrl(uploadedBucket, uploadedPath as string);
            const template = this.resolveTemplate(options.template);

            const bookRecord: BookRecordInsert = {
                user_id: user.id,
                title: options.title?.trim() || parsed.title,
                author_name: authorName,
                status: 'draft',
                template,
                total_words: parsed.totalWords,
                source_file_url: sourceFileUrl,
                source_format: 'docx',
            };
            const session = await this.supabase.getSession();

            console.group('BOOK IMPORT DEBUG');

            console.log('Authenticated User:', user);
            console.log('Authenticated User ID:', user.id);

            console.log('Session:', session);

            console.log('Book Record Payload:');
            console.log(JSON.stringify(bookRecord, null, 2));

            console.log('Payload user_id:', bookRecord.user_id);

            console.log(
                'user_id matches auth user:',
                bookRecord.user_id === user.id
            );

            console.groupEnd();
            const { data: book, error: bookError } = await this.supabase.client
                .from('books')
                .insert(bookRecord)
                .select('id')
                .single();
            if (bookError) {
                console.group('BOOK INSERT ERROR');

                console.error('Code:', bookError.code);
                console.error('Message:', bookError.message);
                console.error('Details:', bookError.details);
                console.error('Hint:', bookError.hint);

                console.log('Current User:', user);
                console.log('Book Record:', bookRecord);

                console.groupEnd();

                throw bookError;
            }

            if (typeof book.id !== 'string' || !book.id) {
                throw new BookImportError('The books table did not return the new book ID.');
            }

            const bookId = book.id;
            createdBookId = bookId;
            const chapterRecords: ChapterRecordInsert[] = parsed.chapters.map((chapter) => ({
                ...chapter,
                book_id: bookId,
            }));
            const { error: chaptersError } = await this.supabase.client.from('chapters').insert(chapterRecords);
            if (chaptersError) throw chaptersError;

            return createdBookId;
        } catch (error: unknown) {
            const cleanupErrors = await this.rollback(createdBookId, uploadedPath, uploadedBucket);
            const details = this.errorMessage(error);
            const cleanupMessage = cleanupErrors.length > 0
                ? ` Cleanup also failed: ${cleanupErrors.map((cleanupError) => this.errorMessage(cleanupError)).join('; ')}`
                : '';

            if (error instanceof BookImportError && cleanupErrors.length === 0) throw error;
            throw new BookImportError(`Unable to import the DOCX manuscript: ${details}.${cleanupMessage}`, { cause: error });
        }
    }

    private resolveTemplate(template: string | undefined): BookTemplate {
        if (!template?.trim()) return 'novel';
        const normalizedTemplate = template.trim().toLowerCase();
        if (normalizedTemplate === 'novel' || normalizedTemplate === 'business' || normalizedTemplate === 'academic') {
            return normalizedTemplate;
        }
        throw new BookImportError('Choose a supported template: novel, business, or academic.');
    }

    private validateDocx(file: File): void {
        if (!(file instanceof File)) {
            throw new BookImportError('Choose a DOCX file to import.');
        }
        if (!file.name.toLowerCase().endsWith('.docx')) {
            throw new BookImportError('Only Microsoft Word DOCX files are supported.');
        }
        if (file.size === 0) {
            throw new BookImportError('The selected DOCX file is empty.');
        }
    }

    private normalizeText(text: string): string {
        return text
            .replace(/\r\n?/g, '\n')
            .replace(/[\t\u00a0]+/g, ' ')
            .split('\n')
            .map((line) => line.trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private parseManuscript(text: string, fileName: string): { title: string; chapters: ParsedChapter[]; totalWords: number } {
        const lines = text.split('\n');
        const titleLineIndex = lines.findIndex((line) => line.length > 0 && !this.isChapterHeading(line));
        const title = titleLineIndex >= 0
            ? lines[titleLineIndex]
            : fileName.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim() || 'Untitled manuscript';
        const headings = lines
            .map((line, lineIndex) => ({ lineIndex, title: this.getChapterHeading(line) }))
            .filter((heading): heading is ChapterHeading => heading.title !== null)
            .map((heading) => ({ ...heading, title: heading.title as string }));

        const chapters = headings.length > 0
            ? this.chaptersFromHeadings(lines, headings, titleLineIndex)
            : this.singleChapter(lines, titleLineIndex);
        const nonEmptyChapters = chapters.filter((chapter) => chapter.content.trim().length > 0);
        if (nonEmptyChapters.length === 0) {
            throw new BookImportError('No chapter text could be found in this DOCX file.');
        }

        const positionedChapters = nonEmptyChapters.map((chapter, index) => ({ ...chapter, position: index + 1 }));
        const totalWords = positionedChapters.reduce((total, chapter) => total + chapter.word_count, 0);
        return { title, chapters: positionedChapters, totalWords };
    }

    private chaptersFromHeadings(lines: string[], headings: ChapterHeading[], titleLineIndex: number): ParsedChapter[] {
        return headings.map((heading, index) => {
            const nextHeadingIndex = headings[index + 1]?.lineIndex ?? lines.length;
            const followingLines = lines.slice(heading.lineIndex + 1, nextHeadingIndex);
            let chapterTitle = heading.title;
            if (/^(chapter|chap\.?|part)\s+[\wivxlcdm-]+$/i.test(chapterTitle)) {
                const nextTitleLine = followingLines.find((line) => line.length > 0);
                if (nextTitleLine && this.isLikelyHeadingTitle(nextTitleLine)) {
                    chapterTitle = nextTitleLine;
                    followingLines.splice(followingLines.indexOf(nextTitleLine), 1);
                }
            }

            const contentLines = followingLines.filter((line, lineIndex) => {
                const sourceLineIndex = heading.lineIndex + 1 + lineIndex;
                return sourceLineIndex !== titleLineIndex;
            });
            const content = contentLines.join('\n').trim();
            return { position: index + 1, title: chapterTitle, content, word_count: this.countWords(content) };
        });
    }

    private singleChapter(lines: string[], titleLineIndex: number): ParsedChapter[] {
        const content = lines
            .filter((_, index) => index !== titleLineIndex)
            .join('\n')
            .trim();
        return [{ position: 1, title: 'Chapter 1', content, word_count: this.countWords(content) }];
    }

    private getChapterHeading(line: string): string | null {
        const trimmed = line.trim();
        if (!trimmed) return null;

        const numberedHeading = trimmed.match(/^(chapter|chap\.?)\s+([\w-]+)(?:\s*[:.\-–—]\s*|\s+)?(.*)$/i);
        if (numberedHeading) {
            const suffix = numberedHeading[3]?.trim();
            return suffix ? `${numberedHeading[1].replace(/\.$/, '')} ${numberedHeading[2]}: ${suffix}` : `${numberedHeading[1].replace(/\.$/, '')} ${numberedHeading[2]}`;
        }

        const partHeading = trimmed.match(/^part\s+([\w-]+)(?:\s*[:.\-–—]\s*|\s+)?(.*)$/i);
        if (partHeading) {
            const suffix = partHeading[2]?.trim();
            return suffix ? `Part ${partHeading[1]}: ${suffix}` : `Part ${partHeading[1]}`;
        }

        if (/^(prologue|epilogue|preface|introduction|afterword|acknowledgements?|appendix(?:\s+[\w-]+)?)$/i.test(trimmed)) {
            return trimmed;
        }
        return null;
    }

    private isChapterHeading(line: string): boolean {
        return this.getChapterHeading(line) !== null;
    }

    private isLikelyHeadingTitle(line: string): boolean {
        return line.length <= 100 && line.split(/\s+/).length <= 14 && !/[.!?]$/.test(line);
    }

    private countWords(text: string): number {
        return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
    }

    private resolveAuthorName(authorName: string | undefined, metadata: Record<string, unknown>, email: string | undefined): string {
        const providedName = authorName?.trim();
        if (providedName) return providedName;

        for (const key of ['author_name', 'display_name', 'full_name', 'name']) {
            const value = metadata[key];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        if (email) return email;
        throw new BookImportError('Add an author name to the import options or your account profile.');
    }

    private safeFileName(fileName: string): string {
        return fileName
            .replace(/[^\p{L}\p{N}._-]+/gu, '-')
            .replace(/^-+|-+$/g, '') || 'manuscript.docx';
    }

    private async rollback(bookId: string | null, uploadedPath: string | null, bucket: string): Promise<unknown[]> {
        const cleanupErrors: unknown[] = [];
        if (bookId) {
            const { error } = await this.supabase.client.from('books').delete().eq('id', bookId);
            if (error) cleanupErrors.push(error);
        }
        if (uploadedPath) {
            try {
                await this.storage.deleteFile(bucket, uploadedPath);
            } catch (error: unknown) {
                cleanupErrors.push(error);
            }
        }
        return cleanupErrors;
    }

    private errorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        return typeof error === 'string' ? error : 'An unexpected error occurred';
    }
}
