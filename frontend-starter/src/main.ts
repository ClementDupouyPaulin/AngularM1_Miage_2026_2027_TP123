import { bootstrapApplication } from "@angular/platform-browser";
import { provideHttpClient, withInterceptors, withXhr } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { AppComponent } from './app/components/app/app';
import { routes } from './app/routes';
import { authInterceptor } from './app/shared/interceptors/auth.interceptor';
import { authErrorInterceptor } from './app/shared/interceptors/auth-error.interceptor';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    // Depuis Angular 22 le backend par défaut est fetch, qui n'émet pas
    // HttpEventType.UploadProgress : withXhr() est requis pour la barre d'envoi.
    provideHttpClient(withXhr(), withInterceptors([authInterceptor, authErrorInterceptor])),
  ],
}).catch(console.error);
