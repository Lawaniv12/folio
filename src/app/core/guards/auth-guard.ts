import { inject, Injector } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';

const hasSession: CanActivateFn = async (_route, state) => {
  const injector = inject(Injector);
  const router = inject(Router);

  try {
    const { Supabase } = await import('../services/supabase');
    const supabase = injector.get(Supabase);
    if (await supabase.getSession()) return true;
  } catch {
    // Treat an unavailable or invalid session as signed out.
  }

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const authGuard: CanActivateFn = hasSession;
export const authChildGuard: CanActivateChildFn = (_route, state) => hasSession(_route, state);
