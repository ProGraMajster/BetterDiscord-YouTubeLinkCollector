# Ograniczenia 1.2.0

Autor projektu: ProGraMajster.

- Automatyczne przejścia istniejącymi przyciskami są zaimplementowane i sprawdzone w fixture przeglądarkowej. Natywny Discord/BetterDiscord **NOT EXECUTED — native UI unavailable**. Audyt rzeczywistych źródeł z cache nie zastępuje odczytu aktualnie zamontowanego DOM.
- Wewnętrzne stores/React/CSS mogą się zmienić. Brak potwierdzonego kontraktu, ukryte/ignorowane wyniki, rozbieżne offsety, częściowe payloady lub niedostępny przycisk blokują nawigację. Bez zgadywania private API i bez ponawiania kliknięć po timeoutcie.
- Stop blokuje przyszłe kliknięcia; wcześniej wysłana akcja klienta może dokończyć ładowanie. Restart wymaga świadomego ponownego uruchomienia przebiegu; odtwarza dane, nie aktywne akcje.
- 103/103 stron dowodzi odczytu dostępnych stron tego zakresu, nie całej historii. Wyniki indeksu, limity paginacji, filtry autora/daty, brak drugiej domeny, edycje/usunięcia mogą ograniczać zbiór. Eksport lokalny pozostaje INCOMPLETE.
- Wybrany kanał musi odpowiadać wynikom i uprawnieniom. GUILD/CHANNEL/THREAD są rozpoznane; przekrojowy kontekst DMS nie kwalifikuje jednego kanału. Kontener forum nie jest skanowany.
- Dane są archiwum zaobserwowanych linków. Nie sprawdzamy dostępności wideo, nie odtwarzamy usuniętych wiadomości ani nie zachowujemy pełnych treści/profili. Zebrane źródła/author/timestamp mogą być prywatne.
- Limity danych i tracking zatrzymują pracę bez cichego usuwania. Checkpoint BdApi jest kontrolowany w API, ale crash przed flush może utracić ostatni zapis. Synchroniczna serializacja dużych snapshotów może chwilowo opóźnić UI. Nie wykonano natywnego wielogodzinnego skanu.
- Callback filesystem BD nie zapewnia fsync. Sukces zapisów ma readback. Blob oznacza przekazanie do pobrania; brak hostowego DownloadItem.done. Natywny dialog/IPC 1.2.0 wymaga testu BetterDiscord.
- Bieżąca kopia konfiguracji zawierała 151/151 i nie zawierała starych 26/126. Przyczyny wcześniejszej zmiany licznika nie da się rozstrzygnąć bez historycznego zapisu. Nowe odzyskiwanie nie konstruuje nieobecnych rekordów.
- Automatyzacja istniejącego UI nie jest zatwierdzeniem rozwiązania przez Discord. Polityka platformy obejmuje automatyzację kont użytkowników i modyfikacje klienta; źródła w RESEARCH.md. Oficjalny bot jest osobną opcją, wymaga uprawnionej instalacji i Message Content; nie wykonano skanu bota na koncie użytkownika.
