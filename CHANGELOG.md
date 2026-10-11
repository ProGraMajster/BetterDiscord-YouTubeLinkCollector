# Changelog

## 1.2.5 — 2026-10-10

- Author: ProGraMajster.
- Separate checked/reported messages, messages with YouTube links, messages without recognized links, and unverified results. Collection link counters and list pagination have distinct labels.
- Successful search completion survives checkpoint restoration; full-history INCOMPLETE coverage is explained separately. Genuine gaps and count mismatches remain warnings.
- Earlier errors remain in collapsed history; current errors are visible and saved history is preserved.
- Drag the title bar or use arrow keys to move the panel. Its header stays reachable after resizing; position is retained when reopened during the session. Pointer capture/listeners are cleaned up.
- Preserved schema-1 checkpoints, collection-preserving resume, page delay settings, callback export, and ProGraMajster authorship. The original implementation suite passed 168/168 tests.
- First public GitHub publication: MIT license, English README, publication guards, source ZIP/checksums, and CI/tag-based prerelease automation. Plugin runtime remains unchanged.

## 1.2.4 — 2026-10-10

- Autor: ProGraMajster.
- Minimum/maksimum przerwy między stronami w ustawieniach, Zapisz zakres, domyślnie 3–30 s. Całe sekundy 0–300, zapis w checkpointach/JSON, zgodność starszych zapisów.
- Odliczanie, natychmiastowy Stop/Pauza, kontrola wyników po przerwie i timeout liczony dopiero od click. Pola zablokowane podczas zbierania.
- 163/163 testów; przeglądarka: nawigacja 13/13 (3–3 s), Stop podczas przerwy 4/4 (30 s), Stop podczas fetch 4/4, timeout 5/5.
- Zachowano naprawy automatycznej nawigacji, przycisk na górnym pasku, eksport callback i autorstwo.

## 1.2.3 — 2026-10-10

- Autor: ProGraMajster.
- Oczekiwanie na zaplanowane przejście toleruje chwilowe totalResults=0 i brak kontekstu podczas ładowania. Licznik początkowy pochodzi z załadowanej strony. Spójność zakresu/licznika i nowe ID sprawdzane po zakończeniu ładowania, przed następnym kliknięciem. Timeout i Stop zachowane.
- Użytkownik potwierdził przechodzenie przez kolejne strony w rzeczywistym Discordzie. Koniec 103 stron i eksport na tym koncie nie zostały jeszcze potwierdzone.
- 157/157 testów PASS; przeglądarka: nawigacja/eksport 13/13, Stop 4/4, timeout 5/5. Fixture odtwarza zerowanie licznika podczas fetch, ładowany embed i indeksowanie w tle.
- Zachowane dane, eksport callback, checkpointy schematu 1 oraz checkpointy bota z 1.2.0/1.2.1/1.2.2.

## 1.2.2 — 2026-10-10

- Oddzielono ładowanie wyszukiwarki od wskaźników w embedach i historycznego indeksowania w tle. Diagnostyka podaje busyReasons, loaded, fullPage i liczbę odczytanych wyników.
- 152/152 testów PASS. Użytkownik potwierdził odczyt dwóch stron (51 linków), po czym ujawniła się blokada przez chwilowy zerowy licznik; poprawiona w 1.2.3.

## 1.2.1 — 2026-10-10

- Numeracja UI od 1: offset=(currentPage-1)*pageSize. Poprawka numeracji nie usuwała jeszcze fałszywej blokady ładowania; użytkownik potwierdził zatrzymanie na pierwszej stronie.

- Autor: ProGraMajster.
- Naprawa fałszywego coherent:false: zwykłe obiekty filtrów z innego kontekstu JavaScript oraz aktualna gałąź React przy współdzielonych dzieciach i starych return pointers. Zachowana kontrola rzeczywistych zmian filtrów/offsetów.
- Rozpoznana paginacja może rozpocząć oczekiwanie na ustabilizowanie danych. Błąd niezgodności nie jest już przedstawiany jako brak paginacji; diagnostyka pokazuje przyczynę i trzy offsety, bez treści zapytania.
- YT • Kolektor przeniesiony na środek górnego paska (top=40 px). Diagnostyka zawija długi tekst bez przesuwania panelu poziomo.
- Checkpointy schematu 1, eksport callback oraz checkpointy narzędzia bota 1.2.0 zachowane.
- 149/149 testów; przeglądarkowy przebieg 3 stron/19 linków/eksport, współdzielone dzieci React i obiekty z iframe: 13/13 PASS.

## 1.2.0 — 2026-10-10

- Autor: ProGraMajster.
- Zbierz wszystkie strony: istniejące rel=prev/next, cofnięcie do początku, stabilizacja 1 s, checkpoint przed kliknięciem, potwierdzenie nowego numeru/offsetu i nowych ID, timeout 30 s, bez ponawiania kliknięcia. Pauza/Stop blokują dalsze przejścia. Automatyczny eksport po końcu.
- Aktualny adapter SearchQueryStore/SelectedSearchContextStore i rzeczywistych React props; paginacja przez przodków istniejących przycisków, dynamiczny pageSize. Odczyt pełnego payloadu strony zamiast tylko DOM lub zbioru akumulowanego store.
- Zgodność schematu 1 i migracja 1.0.0/1.1.0; zweryfikowane kopie banków, widoczne odzyskiwanie, ochrona większej kopii i niejawnego pustego zapisu.
- Uproszczony panel: główne akcje, postęp i wyniki; historia, odzyskiwanie, ustawienia i diagnostyka domyślnie zwinięte. Eksport callback i autorstwo zachowane.
- Testy 3300 linków/195 stron, realnej kopii 151 rekordów oraz UI normal/Stop/timeout. Kwalifikacja w natywnym Discordzie niewykonana; dokładny zakres dowodów w raporcie 1.2.0.

## 1.1.0 — 2026-10-09

- Autor projektu pozostaje **ProGraMajster**.
- Naprawa fs.promises undefined w eksporcie/importcie BetterDiscord: adapter callback z kontrolą UTF-8, odczytem kontrolnym, temp/rename; wariant pełnego Node zachowany.
- Eksport bez native API: Blob/download, schowek i treść do ręcznego kopiowania; ciche anulowanie i prawdziwe błędy. Przeglądarkowy import JSON.
- Półautomatyczne skanowanie: osobne zakresy filtrów/sortowania, obserwacja i potwierdzenie stron, stabilizacja odczytu, luki, powtórzenia, recheck i timeout. Brak niezakwalifikowanej automatycznej nawigacji.
- Addytywna migracja schematu 1 i niezmienione aktywne klucze; oryginalne banki 1.0.0 zachowane w zweryfikowanej kopii migracyjnej.
- Start zachowuje kolekcję; Pauza, historia zakresów, własny opis przy niedostępnych danych klienta, kopiowanie pojedynczego/wyświetlanych linków, diagnostyka.
- Opcjonalny, uprzednio sprawdzony zapis kopii JSON co 5 minut na wskazaną ścieżkę, tylko w tej sesji.
- Rozszerzone testy API, realnego filesystemu, starego checkpointu 126 rekordów, paginacji, cyklu życia i 3300 unikalnych zasobów / 6600 wystąpień. Instrukcja manualnej kwalifikacji 1.1.0.

Użytkownik potwierdził odczyt 1.0.0 w rzeczywistym kliencie. Nowe wydanie jest przygotowane do jego testów; test 1.1.0 w rzeczywistym BetterDiscord nie został wykonany.

## 1.0.0 — 2026-10-09

- Autor projektu i autor wskazany w metadanych: **ProGraMajster**.
- Samodzielny plik instalacyjny `.plugin.js`, polski panel ustawień i niezależne okno kolekcji.
- Jawny wybór jednego kanału, kontrola uprawnień, Start/Stop/Wznów/Reset, zatrzymanie po zmianie kanału.
- Odczyt załadowanych wiadomości i identyfikowalnych, widocznych wyników wyszukiwania; brak automatyzacji konta użytkownika.
- Parser URL, normalizacja wideo/playlist, zachowanie wystąpień, grupy zasobów i metadane źródeł.
- TXT/CSV/JSON, ochrona CSV przed formułami, oznaczenia niepełnych eksportów i odtworzenie z JSON.
- Przetwarzanie partiami, paginowana lista, limity bez cichego usuwania rekordów i dwa naprzemienne zapisy BdApi.Data.
- Osobne, opcjonalne narzędzie oficjalnego bota z paginacją historii, weryfikacją dostępu, obsługą 429 i punktami wznowienia.
- Testy jednostkowe/integracyjne na atrapach oraz fixture przeglądarkowa panelu.

Odczyt pełnej historii rzeczywistego kanału i aktualne integracje stores/DOM wymagają testów ręcznych w Discordzie/BetterDiscordzie. Wydanie zawiera instalowalny artefakt; nie zostało zakwalifikowane testem na koncie Discord.
