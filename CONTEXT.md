# WallDecor

Aplikacja budżetowo-HR firmy WallDecor: finanse salonów (JAG, PUL) i całej firmy, HR, montaże.

## Language

### Koszty pracownicze

**Koszt pracodawcy**:
Pełny miesięczny koszt, jaki firma ponosi za osobę zatrudnioną na UoP/UZ lub za zarząd („brutto brutto”): wynagrodzenie brutto, składki po stronie pracodawcy, premie i dodatki. Nie obejmuje wykonawców B2B, których koszt przychodzi fakturą.
_Avoid_: koszt pracowniczy, koszty osobowe, pensja, wynagrodzenie (w kontekście wyniku firmy)

**Pasek wynagrodzenia**:
Miesięczne zestawienie dla jednej osoby: wynagrodzenie brutto i netto za dany miesiąc, widoczne dla niej na własnym koncie.
_Avoid_: payslip, odcinek płacowy

**Lista płac**:
Miesięczny dokument od kadrowej z brutto i netto (do wypłaty) każdej osoby na UoP za dany okres; źródło faktycznych kwot. Nie zawiera składek po stronie pracodawcy.
_Avoid_: payroll, zestawienie płac

**Angaż**:
Stała miesięczna kwota wynagrodzenia z umowy lub uchwały, wpisana przez ADMIN w karcie osoby. Nie obejmuje nadgodzin ani premii.
_Avoid_: pensja, stawka

**Szacunek kosztu pracodawcy**:
Koszt pracodawcy osoby za miesiąc, za który nie ma jeszcze zatwierdzonej Listy płac, używany w wyniku do czasu zatwierdzenia: koszt pracodawcy z ostatniego wcześniejszego zatwierdzonego miesiąca tej osoby (podzielony na salony według podziału obowiązującego w szacowanym miesiącu); dopiero gdy takiego miesiąca nie ma — wyliczony z Angażu i stawek składek pracodawcy.
_Avoid_: prognoza, koszt oczekiwany

**Stawka godzinowa**:
Podstawa wynagrodzenia wpisana w karcie osoby zamiast miesięcznego Angażu: kwota brutto za godzinę. Brutto miesiąca = zatwierdzone w Czasie pracy godziny × stawka; każda zatwierdzona godzina, także w sobotę i ponad normę, jest płatna tą samą stawką. Osoby na stawce godzinowej są zatwierdzane wyłącznie ręcznie.
_Avoid_: dniówka, akord, nadgodziny (przy stawce godzinowej)

**Przypomnienie przed wypłatą**:
Powiadomienie dla ADMIN-a dwa dni robocze przed ostatnim dniem roboczym miesiąca, gdy na liście płac są osoby bez zatwierdzonego rozliczenia. Wynagrodzenia wypłaca się do ostatniego dnia roboczego miesiąca, którego dotyczą.
_Avoid_: alert płacowy, termin płatności

**Miesiąc kosztu**:
Miesiąc, za który wykonano pracę; w nim Koszt pracodawcy obciąża wynik, niezależnie od terminu zapłaty składek.
_Avoid_: miesiąc wypłaty

### Ludzie w HR

**Wykonawca zewnętrzny**:
Podwykonawca rozliczany fakturą za pracę, a nie pracownik: karta osoby z rodzajem umowy `B2B` (bez osobnego pola w bazie). Karta istnieje po to, żeby wykonawca miał konto instalatora i mógł być przypisany w Montażach. Widoczny tylko w zakładce „Wykonawcy” listy pracowników, w module Montaże i w Ustawienia → Użytkownicy; nie ma go w Wynagrodzeniach, Czasie pracy, Urlopach, raportach HR, strukturze ani na listach wyboru przełożonego i nie ma salda urlopowego. Karta bez wpisanego rodzaju umowy jest pracownikiem — nikt nie znika z HR przez brak danych.
_Avoid_: pracownik B2B, współpracownik

### Koszty bez faktury

**Umowa kosztowa**:
Stała umowa, za którą spółka co miesiąc płaci bez faktury VAT (np. najem placu od osoby prywatnej); jej kwota jest kosztem stałym w każdym miesiącu obowiązywania.
_Avoid_: umowa dodatkowa, koszt ręczny, czynsz (jako nazwa ogólna)

### Montaże

**Protokół odbioru prac**:
Zapis prac jednego rodzaju wykonanych podczas jednej wizyty, także w kilku pomieszczeniach, oraz stanowiska klienta: odbioru, odbioru z uwagami albo odmowy odbioru.

**Protokół jednostronny**:
Oświadczenie wykonawcy o wykonanych pracach i okolicznościach braku potwierdzenia klienta. Nie oznacza odbioru prac przez klienta.
