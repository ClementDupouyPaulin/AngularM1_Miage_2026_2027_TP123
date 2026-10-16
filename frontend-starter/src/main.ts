import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { AppComponent } from './app/components/app/app';
import { routes } from './app/routes';
import { authInterceptor } from './app/shared/interceptors/auth.interceptor';
import { authErrorInterceptor } from './app/shared/interceptors/auth-error.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    // Pas de withFetch() : le backend XHR est requis pour recevoir les
    // événements de progression d'upload (HttpEventType.UploadProgress).
    provideHttpClient(withInterceptors([authInterceptor, authErrorInterceptor])),
  ],
}).catch(console.error);
