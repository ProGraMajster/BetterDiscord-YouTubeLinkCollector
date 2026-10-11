# Audyt źródeł klienta — 2026-10-10

Autor projektu: ProGraMajster.

Rzeczywisty Discord 1.0.9261 był uruchomiony lokalnie. Narzędzia sesji udostępniały przeglądarki, bez sterowania natywnym oknem Discorda i bez otwartej karty Discorda. **Nie wykonano odczytu zamontowanego DOM/React zalogowanego klienta.** Zamiast zgadywania odczytano publiczne statyczne JS/CSS obecne w jego Cache/Cache_Data. Dekompresowano wyłącznie rozpoznane zasoby webpack/CSS; nie analizowano odpowiedzi API, sesji ani tokenów.

Cache zawiera wiele generacji. Pochodzenie lokalne i hash dowodzą rzeczywistych źródeł, ale nie dowodzą, który bundle jest aktualnie zamontowany. Runtime adapter weryfikuje kontrakty przed działaniem. Pełnych zasobów Discorda i prywatnego cache nie dołączono do ZIP.

| Zasób i SHA-256 rozpakowanego JS | Rzeczywisty kontrakt |
| --- | --- |
| f_0002d0.js · 2a3201012566d2002a66e6e8d4cdbfa902beec63c1ad1480455a04a685d95db9 | Moduł 65600, SearchQueryStore: getSearchResultsQueryString, getSearchResultsQuery, getSearchResultsOffset, getSearchMode; brak getCurrentSearchId. Uruchomiono rzeczywistą fabrykę modułu offline z minimalną infrastrukturą Flux: update zapytania/offsetu i odczyty PASS. Brak transportu/konta. |
| f_0002e3.js · 60b8f7edefeac297beea1ead3c4653d0e4488dbb4f7e9a78eb005bcfc0af3c73 | SearchResultsWrap: props searchContext, search, messages, searchResultsQuery, searchMode, blockCount, ignoreCount. messages/search są odroczone przez useDeferredValue. Kontekst GUILD używa guildId; GUILD_CHANNEL/CHANNEL/THREAD używają channelId. offset i totalResults są w search. Hashed klasa ma prefiks searchResultsWrap. Renderowane messages to aktualna strona; nie ma wymaganego przez dawny adapter searchId. |
| f_0002ca.js · 5a07484906cda3ef49255e1bb4f0bbdcd37baa9ef53f89fe2c0254da19e83be7 | Moduł 158142, Pagination: currentPage (1-based; korekta audytu w 1.2.1), totalCount, pageSize, onPageChange. Istniejące Button mają rel=prev/next i disabled. Renderują standardowe kliknięcia strony. Kontrakt odczytano ze źródła; nie wywołano prywatnego handlera. |
| f_00060c.js · 3b6bf9be531555061024ba6af6a8abf5afd70f521ecdd30bcdd7369f23d6473e | Nowszy SearchMessageStore: getMessage(messageID), getTotalCount/getIsFetching/getIsIndexing/getIsHistoricalIndexing/getError; getMessages(searchID) zwraca zbiór dopisywany do momentu clear. SelectedSearchContextStore udostępnia getSelectedSearchContext. Starsze źródło ma getMessage(messageID,channelID). |

## Dlaczego wcześniejszy odczyt zawodził

1. Adapter 1.1.0 oczekiwał SearchStore/getCurrentSearchId, podczas gdy sprawdzony kod używa SearchQueryStore i osobnego SelectedSearchContextStore.
2. Wymagał props searchId/searchID zamiast istniejących searchContext/search/messages; nie znajdował pełnego payloadu i paginacji.
3. Nie obsługiwał sygnatury getMessage(messageID,channelID), więc część DOM fallback nie dawała wiadomości. Sam lokalizowany licznik ani zakładany rozmiar 25 nie ustalają strony.
4. Sam getMessages(searchID) nie dowodzi strony, bo store dopisuje wyniki do momentu clear. **Prześledzono również pełną ścieżkę klienta:** moduł 753806 w f_0002d0.js wywołuje clearSearchMessages oraz updateSearchResultsQuery z nowym offsetem w onFetchStart. Hook 969715 w f_0002e3.js przekształca wyniki store w renderedMessages; komponent 23179 przekazuje je przez useDeferredValue. Zatem standardowy przycisk korzysta z istniejącego cyklu clear → query/offset → nowe wyniki → deferred props. Wtyczka nie wywołuje tych metod; czyta props po tym cyklu i kwalifikuje stronę dopiero przy zgodnych offsetach, liczbie i stabilności. Bez clear albo przy odroczonej starej zawartości surowy zbiór mógłby być nieprawidłowym dowodem.

To **potwierdzone niezgodności kontraktów w rzeczywistych źródłach**. Nie są pełnym śladem runtime błędu na koncie użytkownika. Test integracji w działającym Discordzie pozostaje niewykonany.

## Mechanizm nawigacji

Root wyszukiwania wykrywany jest po odczytanym prefiksie klasy. Pagination czytana jest przede wszystkim z przodków React istniejących przycisków rel=next/prev (do 24 poziomów); ograniczony odczyt dzieci to fallback. Aktywną gałąź fiber sprawdzamy przez HostRoot.current/alternate. Rzeczywisty pageSize jest wymagany, nie zgadywany. Klikane jest wyłącznie jednoznaczne, zamontowane, aktywne istniejące rel=next/prev. Każde kliknięcie ma uprzedni checkpoint i późniejszą weryfikację numeru, offsetu, nowych ID oraz loading/fullPage. Sama metoda click nie jest dowodem przejścia.

Ograniczenia: klient może zmienić kontrakty, usuwać paginację na czas ładowania, filtrować blocked/ignored, ograniczać totalCount paginacji lub indeks. Nierozpoznany/niepełny stan blokuje przejście; zmiana zapytania/licznika zatrzymuje przebieg. Nie ma prywatnego REST, tokenów, hooks/action creatorów ani odblokowywania UI.

## Uzupełnienie 1.2.1

Dodatkowa diagnostyka ze zrzutów użytkownika potwierdza wykrycie panelu, props, payloadu, paginacji i next oraz pageSize=25. Blokada była przy coherent=false. Dotychczasowy komunikat braku paginacji był więc nieprawidłowy. Zrzut nie zawierał przyczyny ani trzech offsetów; 1.2.1 je dodaje.

Sprawdzono także faktycznie zainstalowany BetterDiscord/data/betterdiscord.asar: bundle betterdiscord.js SHA-256 016c8f660f1d2ac01a2c263291df1804066eec664feb3ee07f3c98770c37cb7c. Bound BdApi ma ReactUtils, a getInternalInstance odczytuje __reactFiber/__reactInternalInstance. Sprawdzony Button z modułu 862482 przekazuje rel do button DOM; nie było podstaw do zmiany selektorów paginacji. Błąd dotyczył kwalifikacji danych. Dwóch odtworzonych wad odczytu nie uznajemy automatycznie za pełny ślad błędu na koncie użytkownika.

## Potwierdzona przyczyna blokady i pełny kontrakt numeracji

Drugi odczyt użytkownika: queryOffset=0, propsOffset=0, paginationOffset=25, filtersCoherent=true, pageSize=25. Weryfikacja pośredniego komponentu SearchPagination, moduł 876689 w f_0002d7.js, potwierdziła błąd konwersji adaptera: komponent wylicza currentPage=floor(offset/pageSize)+1, a jego callback przekazuje page-1. **Numer UI jest od 1; indeks callbacku jest od 0.** Wcześniejszy opis zero-based był błędny.

SHA-256 f_0002d7.js: 298cdba2ec122556dd149f825c3184f4ea98224b7f600161eb40eb96350f6f6e. Rzeczywistą fabrykę modułu 876689 wykonano offline ze stubami JSX/useCallback i zwykłym callbackiem testu, bez konta, transportu ani akcji klienta: offsety 0/25/2550 dawały currentPage 1/2/103, a callback następnej strony indeksy 1/2/103. 1.2.1 używa (currentPage-1)*pageSize. Identyczny przypadek 2554 wyników/25 na stronę porównano z oryginalnym 1.2.0 i wstępnym 1.2.1 — oba odrzucały pierwszą stronę; końcowa poprawka ją kwalifikuje.

## Ładowanie i przejściowy zerowy licznik — 1.2.2/1.2.3

Moduły 23179 i 229374 odróżniają isSearching od isHistoricalIndexing. SearchResults nie renderuje paginacji dla isSearching; natywne onPageChange blokuje tę flagę, a historyczne indeksowanie trafia do nagłówka jako informacja. Ogólne loading/progressbar/aria-busy wewnątrz embedu nie jest kontraktem ładowania wyszukiwarki. 1.2.2 usunęła tę fałszywą kwalifikację; checkpoint użytkownika wcześniej potwierdzał timeout busy, ale nie wskazywał który stary człon warunku go wywołał.

Test użytkownika 1.2.2 potwierdził 2/103 przetworzone strony i 51 rekordów. Następnie props miały offset=50, currentPage=3, props-searching, readMessages=0 i expectedHits=0; błąd dotyczył zmiany licznika. To oczekiwany stan po clear w onFetchStart. 1.2.3 nie porównuje tego stanu podczas jawnego loading zaplanowanej następnej strony. Spójność ponownie sprawdza po ładowaniu. Użytkownik potwierdził kontynuowanie przez kolejne strony w rzeczywistym kliencie.
