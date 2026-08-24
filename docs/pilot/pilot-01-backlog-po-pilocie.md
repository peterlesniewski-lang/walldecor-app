# Pilot 01 — backlog świadomie odłożony

Pilot potwierdza wyłącznie wewnętrzny przebieg Tasków 1–5. Nie jest dowodem działania na produkcji, wysyłki wiadomości, połączenia CRM ani wdrożenia środowiska pośredniego.

## Po pilocie: Task 5 (P2)

- **P2-5A — odpowiedź błędna prywatnej usługi plików:** klient API przy HTTP non-2xx ma jawnie anulować lub odczytać body odpowiedzi. Dodać ograniczone czasowo testy body błędów dla uploadu, podpisania, pobrania i usuwania.
- **P2-5B — odporność parsera uploadu:** rozszerzyć testy multipart o wiele plików, zduplikowane pola, nieprawidłowy multipart oraz backpressure/deadlock/fuzz.

**Warunek środowiska, nie P2 kodu:** launcher pozwala w tym pilocie ocenić UX uploadu/QR wyłącznie na fikcyjnych plikach i lokalnym adapterze testowym. Przed technicznym smoke bezpieczeństwa trzeba uruchomić właściwą prywatną usługę plików z ClamAV; wynik pilota nie jest takim dowodem.

## Kolejne etapy, poza pilotem

| Task | Świadomie poza zakresem |
| --- | --- |
| 6 | Konto instalatora i szczelna nawigacja. |
| 7 | Wizyty, wielu instalatorów i Google Calendar. |
| 8 | Materiały i potwierdzone przekazania. |
| 9 | Raport wizyty, odbiór zakresu, podpis i PDF. |
| 10 | Jedno końcowe zadanie do faktury po pełnym odbiorze zlecenia. |
| 11 | Gmail, przypomnienia, Sheets i niezawodny worker. |
| 12 | Wiki, backup, restore i gotowość produkcyjna. |

Decyzje po pilocie zapisujemy z obserwacji, a nie z założeń: co potwierdzono, co nie było testowane i co wymaga osobnego technicznego sprawdzenia.
