import { Injectable, inject } from '@angular/core';
import { Supabase } from './supabase';

export interface UploadedFile {
    path: string;
    fullPath: string;
}

@Injectable({ providedIn: 'root' })
export class Storage {
    private readonly supabase = inject(Supabase);

    async uploadFile(bucket: string, path: string, file: File): Promise<UploadedFile> {
        const { data, error } = await this.supabase.client.storage
            .from(bucket)
            .upload(path, file, {
                cacheControl: '3600',
                contentType: file.type || undefined,
                upsert: false,
            });

        if (error) {
            console.group('SUPABASE STORAGE ERROR');

            console.error('Message:', error.message);
            console.error('Name:', error.name);

            console.log('Bucket:', bucket);
            console.log('Path:', path);
            console.log('File:', file);

            console.groupEnd();

            throw error;
        }
        return { path: data.path, fullPath: data.fullPath };
    }

    getPublicUrl(bucket: string, path: string): string {
        return this.supabase.client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }

    async deleteFile(bucket: string, path: string): Promise<void> {
        const { error } = await this.supabase.client.storage.from(bucket).remove([path]);
        if (error) throw error;
    }
}
