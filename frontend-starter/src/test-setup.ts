// Polyfill minimal de localStorage pour l'environnement de test (jsdom, dans
// cette configuration, expose un accesseur localStorage qui lève une erreur
// sans le flag Node --localstorage-file). AuthService lit localStorage dès sa
// construction : sans ce polyfill, tout test qui injecte le vrai AuthService
// plante avant même d'atteindre les assertions.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

try {
  globalThis.localStorage.getItem('__probe__');
} catch {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}
