# Deployment Memory — walldecor-app

Zapisuję tu błędy napotkane podczas deployów oraz ich rozwiązania.
Sprawdzaj TEN PLIK przed każdym deployem lub zmianą w Dockerfile/entrypoint.

---

## Błędy i Fixy

### 1. Brakujące `src/lib/utils.ts`
**Błąd:** `Module not found: Can't resolve '@/lib/utils'`
**Przyczyna:** Plik nie był dodany do gita (prawdopodobnie w .gitignore lub pominięty).
**Fix:** Utwórz `src/lib/utils.ts`:
```ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
Oraz dodaj do `package.json`: `clsx`, `tailwind-merge`, `class-variance-authority`.

---

### 2. `package-lock.json` out of sync
**Błąd:** `npm ci can only install packages when package.json and package-lock.json are in sync`
**Przyczyna:** Ręczna edycja `package.json` bez uruchomienia `npm install`.
**Fix:** Zawsze po edycji `package.json` uruchom `npm install` lokalnie i pushuj zaktualizowany `package-lock.json`. Jeśli brak Node.js — zmień `npm ci` na `npm install` w Dockerfile (tymczasowo).

---

### 3. `prisma.config.ts` — niekompatybilny z Prisma v5
**Błąd:** `Cannot find module 'prisma/config'` (build) lub `Failed to parse syntax of config file at "/app/prisma.config.ts"` (runtime)
**Przyczyna:** `prisma/config` istnieje dopiero od Prisma v6. Projekt używa v5.
**Fix:** Zastąp zawartość `prisma.config.ts`:
```ts
// Prisma v5 does not use this config file
export {};
```

---

### 4. TypeScript error — `role: string` nie pasuje do `'ADMIN' | 'MANAGER' | 'EMPLOYEE'`
**Błąd:** `Type 'string' is not assignable to type '"ADMIN" | "MANAGER" | "EMPLOYEE"'` w `src/lib/auth.ts`
**Przyczyna:** Prisma zwraca `role` jako `string`, NextAuth oczekuje union type.
**Fix:** Dodaj cast w `authorize()`:
```ts
role: user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE',
```

---

### 5. `npx prisma` ściąga złą wersję (v7 zamiast v5)
**Błąd:** `Failed to parse syntax of config file` — `npx` instaluje `prisma@latest` (v7) zamiast v5 z projektu.
**Przyczyna:** `docker-entrypoint.sh` używał `npx prisma` bez zainstalowanego binarki w runner stage.
**Fix:** W `docker-entrypoint.sh` używaj:
```sh
node ./node_modules/prisma/dist/bin.js migrate deploy
node ./node_modules/prisma/dist/bin.js db seed
```
Oraz dodaj do Dockerfile (runner stage):
```dockerfile
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
```

---

### 7. `prisma/dist/bin.js` — zła ścieżka CLI w Prisma v5
**Błąd:** `Cannot find module '/app/node_modules/prisma/dist/bin.js'`
**Przyczyna:** W Prisma v5 ścieżka CLI to `build/index.js`, nie `dist/bin.js`.
**Fix:** W `docker-entrypoint.sh`:
```sh
node ./node_modules/prisma/build/index.js migrate deploy
node ./node_modules/prisma/build/index.js db seed
```

---

### 6. `node_modules/.bin/prisma` — brak companion `.wasm`
**Błąd:** `ENOENT: no such file or directory, open '/app/node_modules/.bin/prisma_schema_build_bg.wasm'`
**Przyczyna:** Kopiowanie tylko binarki `.bin/prisma` bez pliku wasm, który jest potrzebny jako companion.
**Fix:** Nie kopiuj `.bin/prisma` — używaj `node ./node_modules/prisma/dist/bin.js` bezpośrednio.

---

## Checklist przed deployem

- [ ] `src/lib/utils.ts` istnieje?
- [ ] Wszystkie pakiety z importów są w `package.json`?
- [ ] `package-lock.json` jest zsynchronizowany (`npm install` był uruchomiony)?
- [ ] `prisma.config.ts` ma tylko `export {}` (nie importuje z `prisma/config`)?
- [ ] `docker-entrypoint.sh` używa `node ./node_modules/prisma/dist/bin.js` zamiast `npx prisma`?
- [ ] TypeScript buildy lokalnie bez błędów (`next build`)?
