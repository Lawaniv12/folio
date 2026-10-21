import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Supabase } from '../../../../core/services/supabase';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login {
  private readonly supabase = inject(Supabase);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected email = '';
  protected password = '';
  protected readonly notice = signal('');
  protected readonly isSigningIn = signal(false);

  protected async signIn(): Promise<void> {
    const email = this.email.trim();
    if (!email || !this.password) {
      this.notice.set('Enter your email and password to continue.');
      return;
    }
    if (this.isSigningIn()) return;

    this.isSigningIn.set(true);
    this.notice.set('');
    try {
      await this.supabase.signIn(email, this.password);
      const requestedUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      const destination = requestedUrl?.startsWith('/') && !requestedUrl.startsWith('//')
        ? requestedUrl
        : '/dashboard';
      await this.router.navigateByUrl(destination);
    } catch (error: unknown) {
      this.notice.set(error instanceof Error ? error.message : 'Unable to sign in. Please try again.');
    } finally {
      this.isSigningIn.set(false);
    }
  }
}
