# Architektura 1.2.7

Autor projektu: ProGraMajster.

Plugin jest canonical single-file CommonJS bez builda i zależności. Core udostępnia ten sam parser/model testom i narzędziu bota. Collection zachowuje wystąpienia (wiadomość, oryginalny URL, ordinal), grupy typu/ID i seen fingerprints; powtórne odwiedziny nie tworzą duplikatów. Linki już zaobserwowane pozostają również po edycji. Każdy wynik wymaga jawnego channel_id wybranego kanału i poprawnego ID.

## Odczyt i nawigacja

LocalAdapter sprawdza widok, kanał i uprawnienia. Czyta dostępne MessageStore oraz current React search props i SearchQueryStore/SelectedSearchContextStore. SearchMessageStore.getMessages samo nie potwierdza strony: zbiór jest dopisywany do clear; zwykłe onFetchStart klienta czyści go przed aktualizacją query/offsetu. Rzeczywiste źródła i sygnatury są w CLIENT-AUDIT.md. Brak własnego transportu, tokena i prywatnych akcji.

UIPageNavigator ma reading → waiting → reading oraz finished/interrupted. reading wymaga pełnego payloadu, braku loading/index/error, zgodnego kontekstu/filtrów/offsetu/paginacji i minimum 1 s stabilności dwóch odczytów. Aktualna wielkość strony pochodzi z pageSize. Pełne messages są odczytywane nawet przy częściowym zamontowaniu DOM. blocked/ignored i nierozpoznane wiadomości blokują pełny odczyt.

Po zbieraniu ponownie sprawdzamy payload, zatwierdzamy stronę w SearchTracker i zapisujemy navigation (phase/fromPage/expectedPage/direction/updatedAt) razem z linkami. Dopiero po readback banku i pointera wolno kliknąć standardowy istniejący rel=next/prev. Następny odczyt wymaga oczekiwanego numeru, nowego offset/pageKey i innego dokładnego podpisu ID. Nowy numer ze starymi ID czeka, nie przechodzi. Limit odczytu / przejścia wynosi domyślnie 90 s, ustawiany osobno w zakresie 15–300 s; nie ponawia dostarczonych kliknięć. Zmiana scope/count/skok strony kończy zadanie. Kontroler ma limit 10 000 przejść.

Zwykły Start/Wznów czyta bieżącą stronę i przechodzi next do końca. Użycie prev do strony 1 wymaga jawnej opcji Zbierz od początku… i potwierdzenia. Checkpoint pamięta opcjonalne runMode/exportFormat, a brak w starym zapisie jest zgodny. Zakończenie wymaga dostępnego totalPages oraz native end control. Po końcu zatrzymuje skan, zapisuje i uruchamia jeden pełny eksport. Status całej historii pozostaje częściowy/INCOMPLETE.

Czytanie jest serializowane; co 100 wiadomości oddaje sterowanie. Polling 2 s i debounce 350 ms uzupełniają store/observer. Stop/Pauza anulują kontroler, zwiększają generation, czyszczą poll/read timer i zapisują. Stara asynchroniczna partia nie może kliknąć po anulowaniu. Wysłane wcześniej kliknięcie klienta może zakończyć własne ładowanie. Restart nigdy automatycznie nie odtwarza kliknięć.

SearchTracker v1 pozostaje addytywnym polem schematu 1: do 64 scopes, 8000 stron, 4 MiB. navigation jest opcjonalne i walidowane. Kontekst podpisuje kanał/serwer, query, filters, sort; offset nie jest filtrem. processed wymaga seen dla każdej wiadomości. Stary rekord bez historii stron nie jest sztucznym dowodem ich odczytu. Metadane nawigacji liczą się do budżetu pamięci.

Dane niepełnego hit są odzyskiwane wyłącznie po dokładnym ID z kompletnych stores lub props message zatwierdzonego fiber. Niepełny rekord pierwszego store nie przesłania kolejnego. Zmiana payloadu przed kliknięciem uruchamia do trzech ponownych odczytów tej samej strony; zakończona przerwa nie jest wtedy liczona od nowa.

## Trwałość i odzyskiwanie

Persistence zapisuje state-a/state-b naprzemiennie, readback, potem checkpoint i jego readback. SCHEMA=1, namespace i klucze pozostają niezmienione. FNV-1a wykrywa przypadkowe uszkodzenie; nie jest podpisem. Poprawny pointer jest granicą commit; fallback na inny poprawny bank ostrzega. Większy bank/archive jest widoczny w odzyskiwaniu, nie przyjmowany bez decyzji użytkownika.

Migracja 1.0.0/1.1.0 zachowuje oryginalne envelope/pointer w legacy-wersja przed pierwszą rotacją. Większy lub innego kanału bank zostaje w recovery-safety przed nadpisaniem. Kopie są ograniczone rozmiarem i nie zastępują samowolnie wcześniejszych danych. Błąd kopii blokuje zapis banku. Pusta kolekcja nie może niejawnie nadpisać poprawnej niepustej; jawny Reset/import/zmiana kanału mają osobną potwierdzaną ścieżkę. protectEmptyConfig chroni istniejący plik przed pustym cache BdApi przy uszkodzonym JSON.

Granice: 50 000 wystąpień, 250 000 wiadomości, 24 MiB snapshotu, 4 MiB tracking. Kopie mogą zwiększyć rozmiar konfiguracji; budżet kopii wynosi 2× limit snapshotu +64 KiB każda. BdApi readback jest dowodem akceptacji API, nie fizycznego flush. Serializacja/FNV są synchroniczne; maksymalnej kolekcji nie zakwalifikowano w natywnym kliencie. Kopię konfiguracji wykonuj po zamknięciu Discorda.

## UI i pliki

W 1.2.5 SearchTracker.accounting wylicza unikalne ID wyłącznie ze stron processed wybranego zakresu. Odczytany fingerprint [] oznacza brak rozpoznanych linków; prawidłowy zapis adresów oznacza wiadomość z linkami. Brak/nieznany fingerprint jest odrębnym unverified, nigdy zerem linków. Załadowany chat i inne zakresy nie zmieniają rozliczenia tego wyszukiwania. Wystąpienia całej kolekcji pozostają osobnym licznikiem. Nie dodano danych do checkpointu. Po odtworzeniu faza finished i komplet potwierdzonych stron pozwalają odtworzyć sukces; niezgodność licznika lub unverified blokuje zielone zakończenie. Pełna historia nadal jest oznaczona osobno.

Ruchome okno używa Pointer Events i capture na nagłówku, z pominięciem przycisków/innych kontrolek. Pozycja jest pamiętana wyłącznie w instancji pluginu. Strzałki zapewniają ruch klawiaturą; resize ogranicza współrzędne, a dostępna wysokość zapewnia przewijanie. Pointerup/cancel/lostcapture kończą ruch. Zamknięcie/stop zwalniają capture oraz listenery nagłówka i resize. Nagłówek jest sticky, więc pozostaje dostępny przy przewijaniu.

Główny panel: kanał/status/postęp, Zbierz wszystkie strony/Start/Pauza/Stop/Eksportuj, trzy liczniki i do 100 wierszy. Historia, odzyskiwanie, ustawienia i diagnostyka domyślnie zwinięte. Okno ma przewijanie i szerokość dopasowaną do viewportu. Eksport obejmuje całą kolekcję, nie filtr listy.

Callback filesystem BD: writeFile wx/UTF-8 → readFile temp → rename → readFile target. Pełny Node: open/FileHandle/fsync/rename. ExportIO odróżnia saved/cancelled/download/copied/manual; Blob nie deklaruje zakończenia pobrania. Błąd zachowuje kolekcję. JSON zawiera cały snapshot i jest walidowany przy imporcie; TXT/CSV nie zastępują checkpointu. Kopie co 5 min wymagają wybranej ścieżki i udanego pierwszego zapisu; brak równoległego I/O. stop czyści listenery, timery, pending inputs i własne Blob URL.

## Opcjonalny bot

Oddzielne tools/collect-channel.mjs używa oficjalnego zarejestrowanego bota i publicznego Get Channel Messages, before, do 100 wiadomości; sprawdza konto bota, dostęp/historię oraz Message Content. Sekwencyjne 429/retry/backoff są ograniczone, 401/403 przerywają. Krótka partia nie dowodzi końca; pusta partia i ponowna kontrola uprawnień kończą dostępny zakres do pierwszej górnej granicy. .lock chroni pojedynczy checkpoint. Token bota pozostaje wyłącznie w środowisku; plugin go nie używa. Narzędzie bota przyjmuje checkpointy 1.0.0/1.1.0/1.2.0/1.2.1/1.2.2/1.2.3/1.2.4 i korzysta z tego samego Core.

## Spójność odczytu w 1.2.4

Aktywna gałąź jest ustalana przez child/sibling od HostRoot.current, również osobno dla przodków. Samo przełączenie DOM fiber na alternate nie wystarcza przy współdzielonych dzieciach po bailout. Mechanizm jest ograniczony do 128 przodków i 5000 przejść przez rodzeństwo. Kontekst filtrów akceptuje zwykłe obiekty z innego realm i bez prototypu; odrzuca klasy oraz accessors. Klucze checkpointów dla dotychczasowych poprawnych danych pozostają identyczne. Ogólne zachowanie gałęzi opisują [źródła React](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberTreeReflection.js). Implementacja wtyczki podąża za zatwierdzonymi listami dzieci i nie wywołuje funkcji React/Discorda. Narzędzie bota nadal akceptuje także checkpointy 1.2.0.

SearchPagination ma numer currentPage od 1 (floor(offset/pageSize)+1); jego callback onPageChange odejmuje 1. Adapter nie wywołuje callbacku: klika standardowy button, a offset porównuje jako (currentPage-1)*pageSize.

W 1.2.4 źródłem loading są flagi wyszukiwarki, nie wskaźniki embedów. Historyczne indeksowanie jest informacją. W fazie waiting jawne loading pozwala czekać na przywrócenie kontekstu/licznika, bez wydłużania timeoutu ani klikania. Po loading wracają wszystkie kontrole spójności. Licznik bazowy przyjmowany jest wyłącznie z loaded strony.

Przerwa 1.2.4 używa jednego anulowalnego setTimeout i tickera odliczania. read pozostaje zajęty, aby kolejne zdarzenie/poll nie uruchomiło równoległego przejścia. Stop/save failure rozwiązuje oczekiwanie z false i czyści oba timery; generation/running/navigator są sprawdzane przed click. Adapter ponownie weryfikuje zapisany payload po przerwie. navigator.started resetowany jest dopiero przed click, więc 30-sekundowy timeout nie obejmuje przerwy. Nie dodano nowej fazy checkpointu. Nowe opcjonalne config fields są walidowane, a brak w starszym zapisie oznacza 3–30 s.

## Połączenie diagnostyczne 1.2.6

LiveDiagnostics sprawdza krótki, wygasający plik żądania i zapisuje tylko sanitizowany status. Brak serwera, tokenów, eval, poleceń, treści/ID wiadomości oraz odczytu prywatnych endpointów. Cykl życia zwalnia timer; błędy diagnostyki nie zatrzymują zbierania. Raport pasuje do nonce i ma nie więcej niż 10 s. Szczegóły: LIVE-DIAGNOSTICS.md.

## 1.2.7: page evidence and UI lifecycle

The selected channel remains the record/export boundary. A complete current-page hit with a valid different channel ID contributes only its identity to `excludedMessages` and the page signature. Checkpoints keep the optional validated `excludedIDs` subset. Accounting separates reviewed hits, selected-channel messages, other-channel hits, linkless messages and unverified messages. Empty selected-channel pages can advance only if all page-provided hits are qualified. Unknown/incomplete hits, hidden results, unstable scope/count and duplicate identities still prevent completion. No additional client action or request is introduced.

A verified change to the expected page enters the read phase even if that page is incomplete; the subsequent error identifies an incomplete read instead of misreporting a failed UI click. New-page identity still includes all qualified hit IDs.

BetterDiscord can reuse the plugin instance across stop/start. Stop now clears and nulls the pending render handle so the scheduler guard cannot freeze subsequent updates. One cached settings root and one floating root retain registration until explicit disposal, including temporary detachment. Refresh isolates each panel failure and exposes sanitized panel age/error metadata; collection cancellation stays available. Four tab views share existing actions/state and one scrolling content region; no parallel collection controller is created.
