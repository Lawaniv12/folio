import { computed, Injectable, signal } from '@angular/core';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

export interface StudioProfile {
	displayName: string;
	initials: string;
	publisherName: string;
	authorName: string;
	email: string;
}

@Injectable({ providedIn: 'root' })
export class Supabase {
	readonly client: SupabaseClient;
	readonly currentUser = signal<User | null>(null);
	readonly studioProfile = computed<StudioProfile>(() => {
		const user = this.currentUser();
		const metadata = user?.user_metadata;
		const displayName = this.metadataString(metadata?.['display_name'])
			|| this.metadataString(metadata?.['full_name'])
			|| this.metadataString(metadata?.['name'])
			|| user?.email
			|| 'Author';
		const publisherName = this.metadataString(metadata?.['publisher_name']) || 'My Publishing Studio';
		const authorName = this.metadataString(metadata?.['author_name']) || displayName;

		return {
			displayName,
			initials: this.getInitials(displayName),
			publisherName,
			authorName,
			email: user?.email ?? '',
		};
	});

	constructor() {
		if (!environment.supabaseUrl || !environment.supabaseAnonKey) {
			throw new Error('Supabase URL and publishable key must be configured in the Angular environment.');
		}

		this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
		this.client.auth.onAuthStateChange((_event, session) => {
			this.currentUser.set(session?.user ?? null);
		});
	}

	async getCurrentUser(): Promise<User | null> {
		const { data, error } = await this.client.auth.getUser();
		if (error) throw error;
		this.currentUser.set(data.user);
		return data.user;
	}

	async getSession(): Promise<Session | null> {
		const { data, error } = await this.client.auth.getSession();
		if (error) throw error;
		this.currentUser.set(data.session?.user ?? null);
		return data.session;
	}

	async signIn(email: string, password: string): Promise<User> {
		const { data, error } = await this.client.auth.signInWithPassword({ email, password });
		if (error) throw error;
		if (!data.user) throw new Error('Supabase sign-in completed without returning a user.');
		this.currentUser.set(data.user);
		return data.user;
	}

	async updateUserMetadata(metadata: Record<string, unknown>): Promise<User> {
		const { data, error } = await this.client.auth.updateUser({ data: metadata });
		if (error) throw error;
		this.currentUser.set(data.user);
		return data.user;
	}

	private metadataString(value: unknown): string {
		return typeof value === 'string' ? value.trim() : '';
	}

	private getInitials(name: string): string {
		return name
			.split(/[\s@._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toLocaleUpperCase() ?? '')
			.join('') || 'AU';
	}

	async signOut(): Promise<void> {
		const { error } = await this.client.auth.signOut();
		if (error) throw error;
		this.currentUser.set(null);
	}
}
