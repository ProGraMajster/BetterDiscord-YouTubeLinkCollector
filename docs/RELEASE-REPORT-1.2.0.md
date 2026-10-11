# Raport techniczny YouTube Link Collector 1.2.0

Raport historyczny wydania 1.2.0. Bieżący kod, logi i walidacja dotyczą 1.2.1; oryginalna paczka 1.2.0 pozostaje zachowana osobno.

Autor projektu: **ProGraMajster**. Data: 2026-10-10. Plugin i package.json wskazują 1.2.0/ProGraMajster; zasada jest w AGENTS.md. Bez instalowania nowego pluginu na koncie, bez zmiany istniejącej konfiguracji, commit/push/publikacji.

## Wynik

**Automatyczna nawigacja jest zaimplementowana.** Główna akcja Zbierz wszystkie strony odczytuje już otwartą wyszukiwarkę, stabilizuje pełny payload, zapisuje linki i checkpoint, klika istniejące prev/next oraz potwierdza nowy numer/offset i nowe ID po zakończeniu loading. Zaczynając ze środka cofa się do 1 i idzie do końca. Na końcu uruchamia eksport pełnej kolekcji. Postęp pokazuje np. 15/103. Pauza/Stop, timeout 30 s, limity, zmiany zakresu i save failure blokują kolejne click. Brak dopasowania kontrolki jest konkretnym błędem, nie przełączeniem na pozornie automatyczny tryb ręczny.

Techniczna wykonalność wynika z odczytanych rzeczywistych źródeł klienta i prób standardowych DOM button events. **Kwalifikacja na zalogowanym Discordzie 1.0.9261: NOT EXECUTED — native UI unavailable.** Proces Discorda był uruchomiony, lecz narzędzia sesji udostępniały przeglądarki bez jego karty i nie obsługiwały natywnego okna. To dokładna przeszkoda dla live inspekcji/testu, nie przeszkoda dla przygotowania implementacji. Cache może zawierać różne generacje, więc źródło nie potwierdza mounted buildu. Nie deklarujemy, że 100+ stron rzeczywistego kanału już przeszło.

## Dlaczego nie rozpoznawano wyszukiwarki

Sprawdzony kod klienta używa **SearchQueryStore** zamiast oczekiwanego SearchStore/getCurrentSearchId. Root przekazuje **searchContext/search/messages/searchResultsQuery**, a dawny adapter oczekiwał searchId/searchID. Sygnatura starego SearchMessageStore to messageID/channelID, której brakowało w fallbacku. Nowszy store dopisuje wyniki do clear; standardowe onFetchStart czyści go przed aktualizacją query/offsetu, a wyniki trafiają do odroczonych props. Surowy getMessages bez zgodnego kontekstu/offsetu nie dowodzi strony. Usunięto te założenia. Aktualna paginacja currentPage/pageSize/totalCount i semantyczne rel=next/prev są odczytane z rzeczywistego kodu. Szczegóły/hashes: CLIENT-AUDIT.md. Jest to potwierdzona niezgodność kodu, odrębna od niewykonanego runtime śladu użytkownika.

## Dlaczego było 26 zamiast 126

**Przyczyny historycznej nie ustalono.** Nie mamy historycznej konfiguracji w momencie różnicy i nie odtwarzamy nieobecnych danych z samej liczby. Szczegóły prywatnych banków, ich identyfikatory i sumy kontrolne pominięto w publicznej dokumentacji.

Zmiana trybu/filtra listy sama nie kasuje wystąpień. Możliwe ścieżki wymagające historycznego dowodu to starszy zatwierdzony pointer przy większym niezatwierdzonym banku, jawne zastąpienie kolekcji lub niezapisane dane przed restartem. Nie wybieramy jednej jako rzeczywistej przyczyny. Nowe guardy chronią niejawny pusty zapis, pokazują wszystkie poprawne banki i archives, ostrzegają o większym zapisie oraz zachowują go przed nadpisaniem. Test 26/126 potwierdza odzyskiwanie w tym scenariuszu.

## Czy eksport działa

**TXT/CSV/JSON przeszły testy kodu, realnego filesystemu Windows i fixture przeglądarkowej.** Zachowano działający callback adapter BD bez fs.promises/open, UTF-8, readback, temp/rename, ciche cancel, błędy bez utraty kolekcji i Blob/clipboard/manual fallback. Duża kolekcja 6600 occurrences/3300 resources eksportowała całość mimo filtra panelu. Realne pobranie Blob z fixture dało 130 wierszy TXT. Automatyczny koniec UI fixture uruchomił TXT 19.

**Natywny dialog/IPC BetterDiscord 1.2.0: NOT EXECUTED.** Sukces testu callback na dysku nie zastępuje tego testu. Blob komunikowany jest jako przekazanie do pobrania, nie hostowy dowód końca zapisu. Automatyczny eksport korzysta z wybranego formatu i trybu; JSON zawsze zawiera wszystkie wystąpienia/checkpoint, TXT/CSV odpowiedni tryb. Filtry i strony listy nie ograniczają eksportu. Można wyeksportować częściową kolekcję podczas pracy lub po błędzie.

## Checkpointy, UI i granice

Schemat 1, namespace i aktywne klucze zachowane. Oryginalne 1.0.0/1.1.0 banki kopiowane z weryfikacją przed rotacją; większy bank archiwizowany. Recovery umożliwia bezpieczny eksport kopii i potwierdzane zastąpienie. Stara historia stron nie jest wymyślana z liczby rekordów/batches. Restore nie wznawia click automatycznie. Ustawienia/historia/odzyskiwanie/diagnostyka zwinięte, główne akcje i wyniki dostępne od razu. Kontrola pamięci i oddawanie sterowania co 100 wiadomości, najwyżej 100 wierszy DOM, cleanup cyklu życia.

Brak własnych requestów Discorda, czytania user tokena, self-bota, private action creatorów i obchodzenia limitów. Standardowe kliknięcie uruchamia istniejący klient; nie oznacza aprobaty platformy. [Polityka Discorda](https://discord.com/safety/platform-manipulation-policy-explainer) obejmuje automatyzację zwykłych kont i modyfikacje klienta. Decyzja wdrożenia konkretnych UI kliknięć odpowiada najnowszej instrukcji użytkownika; ogólne zastrzeżenie nie zastąpiło analizy. Opcjonalny własny zarejestrowany bot z oficjalnym API pozostaje inną drogą ograniczenia ręcznej pracy, wymaga instalacji/uprawnień/Message Content i nie był uruchomiony na jego kanale. Plugin z niego nie korzysta.

## Co przetestowano i co pozostało

**140/140 testów Node**, składnia 9 JS i dwóch fixture, rzeczywista fabryka QueryStore offline, audyt źródła Pagination, realny callback fs oraz testy browser: 24 panel, 8 duża kolekcja, 12 normal UI, 4 Stop, 5 timeout. Duży model 3300 links/195 pages/194 next/restart/export PASS; to model, nie 195 kliknięć w Discordzie. Nowe testy wymagają nowych ID i pełnego odczytu po przejściu, nie samego click ani numeru.

Pozostałe: zamontowany DOM/React bieżącego buildu, standardowe next/prev na koncie, realne partial/deferred render, timeout/Pauza/Stop w natywnym kliencie, natywny dialog, realne 103+ strony i≥ 3000 linków, wielogodzinne zużycie pamięci, pełna historia rzeczywistego kanału i środowisko bota. Wszystkie **NOT EXECUTED**, zgodnie z protokołem MANUAL-TEST.md. Szczegółowa tabela dowodów: VALIDATION.md; log: TEST-RESULTS.txt i BROWSER-RESULTS.txt.

## Artefakty i użycie

Canonical YouTubeLinkCollector.plugin.js, pełny ZIP 1.2.0, SHA256SUMS.txt, README/CHANGELOG/AGENTS oraz aktualne docs. UPGRADE.md opisuje kopię zamkniętej konfiguracji i odzyskiwanie; USAGE.md pojedynczy przebieg otwartej wyszukiwarki oraz drugi zakres youtu.be. ZIP nie zawiera prywatnego config, eksportów użytkownika ani całych zasobów/cache klienta. Dotychczasowe archiwa 1.0.0/1.1.0 zachowano. Raport 1.1.0 pozostaje wyraźnie historyczny.
