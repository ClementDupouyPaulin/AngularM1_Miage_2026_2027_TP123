import { Routes } from '@angular/router';
import { authGuard } from './shared/guards/auth.guard';
import { LoginPageComponent } from './components/login-page/login-page';
import { ProfilePageComponent } from './components/profile-page/profile-page';
import { RegisterPageComponent } from './components/register-page/register-page';
import { ClipCompareComponent } from './components/clip-compare/clip-compare';
import { ClipDetailComponent } from './components/clip-detail/clip-detail';
import { ClipsPageComponent } from './components/clips-page/clips-page';
import { TracksPageComponent } from './components/tracks-page/tracks-page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tracks' },
  { path: 'login', component: LoginPageComponent },
  { path: 'register', component: RegisterPageComponent },
  { path: 'profile', component: ProfilePageComponent, canActivate: [authGuard] },
  { path: 'tracks', component: TracksPageComponent, canActivate: [authGuard] },
  { path: 'clips', component: ClipsPageComponent, canActivate: [authGuard] },
  { path: 'clips/compare', component: ClipCompareComponent, canActivate: [authGuard] },
  { path: 'clips/:id', component: ClipDetailComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'tracks' },
];
