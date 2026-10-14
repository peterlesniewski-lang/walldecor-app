# WallDecor-App — Coolify

Aktualna instrukcja: [GitHub Actions + GHCR](docs/GITHUB-ACTIONS-BUILD.md).

- GitHub Actions buduje pełny obraz z `Dockerfile` poza VPS.
- Coolify używa `Dockerfile.coolify` do pobrania wskazanego obrazu.
- Auto Deploy i Preview Deployments pozostają wyłączone.
- Wdrożenie wymaga wyraźnej zgody użytkownika na konkretny digest.
- Zachować istniejący zasób, wolumeny SQLite, sekrety runtime i sieci.
- Nigdy nie kopiować poświadczeń do dokumentacji ani repozytorium.

Domena: `https://app.walldecor.pl`, port kontenera `3000`.
Kontekst Coolify: `wallvps`, aplikacja `pwc0sk0w8cw8k8wkgwokgogk`.
Procedura pierwszego wdrożenia i rollbacku jest w aktualnej instrukcji.
