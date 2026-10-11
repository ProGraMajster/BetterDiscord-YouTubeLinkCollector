# YouTube Link Collector 1.2.3 — działająca nawigacja otwartej wyszukiwarki

Autor projektu: **ProGraMajster**.

Użytkownik potwierdził, że 1.2.3 przechodzi przez kolejne strony w jego rzeczywistym Discordzie. Dotychczasowe linki zachowano. Nie potwierdzono jeszcze końca wszystkich 103 stron ani końcowego eksportu na tym koncie; zbieranie może nadal pracować.

Zgłoszenia wskazały trzy kolejne blokady. Błędna numeracja traktowała UI currentPage=1 jako indeks 1 i wyliczała offset=25 zamiast 0. Po korekcie spójność była prawidłowa, ale checkpoint zawierał timeout oczekiwania na ładowanie: szeroki warunek obejmował również wskaźniki embedów i indeksowanie w tle. 1.2.2 przeszła strony 1/2 i zebrała 51 linków, a przy następnym fetch zatrzymała się przez totalResults=0. Nowa diagnostyka potwierdziła props-searching, offset=50, currentPage=3, pusty payload i expectedHits=0. Był to przejściowy stan ładowania, nie nowy zakres.

Adapter korzysta z rzeczywistych props/store wyszukiwarki. Native SearchResults blokuje zmianę strony podczas isSearching; historyczne indeksowanie i loading wewnątrz embedu nie oznaczają ładowania aktualnych wyników. Podczas zaplanowanego przejścia nie porównujemy tymczasowego licznika/zakresu, jeśli wyszukiwarka jawnie ładuje. Po zakończeniu ładowania sprawdzamy je ponownie, wymagamy nowej strony, offsetu, nowych ID i stabilnego kompletnego payloadu. Timeout nadal liczy się od jednego kliknięcia i nie jest przedłużany; nie ponawiamy kliknięć. Faktycznie zmieniony zakres/licznik zatrzymuje przebieg przed następną akcją UI.

Checkpoint powstaje przed istniejącym rel=prev/next. Stop natychmiast unieważnia przyszłe odczyty/kliknięcia. Początkowa strona pośrodku zostaje odczytana, następnie następuje cofnięcie do 1 i przejście do końca. Brak prywatnego transportu, tokenów i wywoływania akcji/handlerów klienta poza standardowym kliknięciem istniejącego przycisku. [Audyt źródeł](CLIENT-AUDIT.md).

Przycisk YT • Kolektor przeniesiono z dolnej paginacji na środek górnego paska. Diagnostyka zawija tekst. Autorstwo, schemat checkpointu, wystąpienia URL, eksport callback i odzyskiwanie pozostają zgodne. Aktualizacja nie uruchamia kliknięć samoczynnie.

157/157 testów PASS, kontrola składni/metadanych PASS. Przeglądarka z syntetycznym BdApi: 13/13 nawigacja i pełny eksport, 4/4 Stop, 5/5 timeout. Fixture odtwarza rzeczywistą numerację od 1, zerowanie licznika podczas fetch, loading embedu, historyczne indeksowanie, shared React fiber i filtry z iframe. To nie dowód ukończenia pełnego skanu konta. [Walidacja](VALIDATION.md).

Plik 1.2.3 zainstalowany w dotychczasowym katalogu BetterDiscord. Przed podmianą zachowano konfigurację i poprzedni plugin; skrypt nie zapisywał konfiguracji. SHA-256 zainstalowanego pluginu: 75038f235dc0d9ca2e643e25f91f0b44d016050d3130b253855abee39c4433a2. Prywatne kopie, zrzuty użytkownika oraz pełne zasoby Discorda/BetterDiscorda nie są dołączone do ZIP.
