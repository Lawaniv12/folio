import { Routes } from '@angular/router';
import { StudioLayout } from './layouts/studio-layout';
import { authChildGuard, authGuard } from './core/guards/auth-guard';

export const routes: Routes = [
	{
		path: 'login',
		loadComponent: () => import('./features/auth/pages/login/login').then((module) => module.Login),
		title: 'Sign in · Folio Author Studio',
	},
	{
		path: '',
		component: StudioLayout,
		canActivate: [authGuard],
		canActivateChild: [authChildGuard],
		children: [
			{ path: '', pathMatch: 'full', redirectTo: 'dashboard' },
			{
				path: 'dashboard',
				loadComponent: () => import('./features/dashboard/dashboard').then((module) => module.Dashboard),
				title: 'Dashboard · Folio Author Studio',
			},
			{
				path: 'books',
				loadComponent: () => import('./features/books/book-library').then((module) => module.BookLibrary),
				title: 'My Books · Folio Author Studio',
			},
			{
				path: 'books/:id/preview',
				loadComponent: () => import('./features/books/book-preview/book-preview').then((module) => module.BookPreview),
				title: 'Reader Preview · Folio Author Studio',
			},
			{
				path: 'books/:bookId/assistant',
				loadComponent: () => import('./features/books/publishing-assistant/publishing-assistant').then((module) => module.PublishingAssistant),
				title: 'AI Publishing Assistant · Folio Author Studio',
			},
			{
				path: 'books/:bookId',
				loadComponent: () => import('./features/books/book-details/book-details').then((module) => module.BookDetails),
				title: 'Book Details · Folio Author Studio',
			},
			{
				path: 'upload',
				loadComponent: () => import('./features/uploads/upload-manuscript/upload-manuscript').then((module) => module.UploadManuscript),
				title: 'Upload a Manuscript · Folio Author Studio',
			},
			{
				path: 'exports',
				loadComponent: () => import('./features/exports/export-center/export-center').then((module) => module.ExportCenter),
				title: 'Exports · Folio Author Studio',
			},
			{
				path: 'settings',
				loadComponent: () => import('./features/settings/account-settings/account-settings').then((module) => module.AccountSettings),
				title: 'Settings · Folio Author Studio',
			},
		],
	},
	{ path: '**', redirectTo: 'dashboard' },
];
