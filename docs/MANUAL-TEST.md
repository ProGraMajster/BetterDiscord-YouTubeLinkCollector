# Kwalifikacja w rzeczywistym Discordzie/BetterDiscord — 1.2.5

Autor projektu: **ProGraMajster**. **Kwalifikacja częściowa:** użytkownik ukończył w 1.2.4 wyszukiwanie w rozmowie prywatnej (6/6 stron, 148 wiadomości, 121 linków); checkpoint potwierdza 27 sprawdzonych wiadomości bez rozpoznanych linków YouTube. Pełny poniższy protokół i nowy interfejs 1.2.5 nie zostały wykonane w natywnym UI przez agenta. Poniższe kroki są protokołem, nie raportem wykonania. Nie testuj awarii na jedynej kopii danych.

## Czytelność i położenie okna 1.2.5

- Dla ukończonego zakresu sprawdź zielone Odczyt wyszukiwania zakończony, zgodny licznik wiadomości i osobne liczby z linkami / bez rozpoznanych linków. Nie utożsamiaj linków z wiadomościami. Bez potwierdzenia lub faktycznie różny licznik mają ostrzegać, bez zielonego zakończenia.
- Zrestartuj plugin przy zachowanym checkpointcie finished. Podsumowanie powinno odtworzyć sukces bez uruchamiania nawigacji. Dawny błąd powinien pozostać w zwiniętej historii; bieżący błąd musi być widoczny.
- Przeciągnij pasek tytułu w różne miejsca, zwolnij wskaźnik, użyj strzałek/Shift+strzałek oraz przewiń panel. Nagłówek i Zamknij pozostają dostępne. Przyciski i kontrolki nie rozpoczynają przeciągania.
- Zamknij i otwórz panel: pozycja pozostaje w tej sesji. Zmniejsz okno Discorda: pasek nie znika poza obszarem klienta. Wyłącz plugin podczas ruchu: brak pozostawionego pointer capture i listenerów.

## Przygotowanie i migracja

1. Zapisz wersje Discorda/BetterDiscord, wersję pluginu i datę testu. Stop, checkpoint, całkowicie zamknij Discord, skopiuj konfigurację i plugin. Wykonaj UPGRADE.md.
2. Porównaj liczniki przed/po z tą samą kolekcją i trybem. Dla historycznej kontrolnej kopii 1.1.0 oczekiwano 151/151, dla wcześniejszej zachowanej 126 oczekuj 126, nie założonej wartości z innego momentu. Sprawdź dostępne banki i legacy. Nie klikaj Reset przy różnicy.
3. Wyeksportuj JSON natywnym dialogiem. Sprawdź wszystkie occurrences, collection.records, schemaVersion 1 i pluginVersion 1.2.5. Importuj wyłącznie do kontrolnej kopii. Przetestuj TXT/CSV, polskie znaki, tryby unique/all, cancel i zapis do niedostępnej ścieżki; brak fałszywego sukcesu i danych utraconych z pamięci. Sprawdź fallback Blob/download w rzeczywistym Electron oraz kopię 5 min.

## Rzeczywiste DOM/React i nawigacja

4. Otwórz wyniki in: konkretny_kanał youtube.com ze stałym sortowaniem. Rozwiń Diagnostyka. Zweryfikuj root, actual props, queryStore, pagination, offset, currentPage/pageSize/totalCount oraz rel=next/prev i disabled. Jeśli kontrakt jest inny, zapisz wyłącznie nazwy pól, typy i zanonimizowane struktury; bez tokenów, treści i sekretów. Dopasowanie kodu musi opierać się na tym dowodzie.
5. Kliknij Zbierz wszystkie strony na stronie 1. Sprawdź 1→2→3, liczbę wiadomości każdej strony, pełny odczyt przy częściowym DOM mounting, checkpoint przed click oraz nowy zestaw ID po click. Samo przesunięcie numeru lub kliknięcie nie spełnia testu. Zweryfikuj również start ze strony środkowej i prev do 1.
6. Doprowadź do wolnego loading, odroczonego payloadu i chwilowego braku paginacji. Nie może pojawić się drugie click przed potwierdzeniem nowej strony. Nierozpoznane/ukryte/ignorowane wyniki i timeout mają zatrzymać przebieg bez utraty dotychczasowych linków.
7. Stop i Pauza podczas oczekiwania na odpowiedź oraz podczas dużej partii: żadnych kolejnych click, zapisane rekordy zachowane. Trwający klient może dokończyć swoją poprzednią akcję. Wyłącz plugin w trakcie skanu, otwórz panel ponownie i sprawdź brak timerów/listenerów/starych kliknięć. Restart nie uruchamia nawigacji automatycznie.
8. Zmień query, autora/daty/sortowanie, licznik wyników, otwarty kanał lub ręcznie przeskocz nieoczekiwaną stronę. Przebieg ma się zatrzymać przed kolejną nawigacją, zachować dane i przyjąć nowy zakres dopiero po jawnym uruchomieniu.

## Koniec i duży kanał

9. Na ostatniej stronie sprawdź zgodny numer/totalPages i disabled Next; brak zbędnego click. Ma uruchomić jeden natywny eksport całej kolekcji. Anuluj dialog i wyeksportuj ponownie. INCOMPLETE pozostaje względem pełnej historii.
10. Przejdź rzeczywiste >100 stron i ≥ 3000 linków, porównaj próbki oraz źródła z ręcznym odczytem. Dla 2554 wyników nie zakładaj rozmiaru 25 ani 103 stron: odczytaj rzeczywisty pageSize i paginację. Sprawdź pamięć, responsywność, checkpointy, JSON roundtrip i przerwanie/wznowienie bez dubli.
11. Powtórz youtu.be z tą samą kolekcją i osobnym scope. Sprawdź MEE6/author/date filters i limit klienta, dziel zakres dat zwykłym UI. Nie kwalifikuj całej historii na podstawie indeksu lub samych pełnych liczników stron.

Raport z wykonania powinien podać buildy, rzeczywiste kontrakty, liczniki przed/po, SHA-256 użytego pluginu/eksportów, zakresy i wynik każdego kroku. Nie zaliczaj testów jednostkowych ani screenshotu fixture jako live testu. Nie używaj user tokenów, private requests lub obchodzenia limitów do uzyskania dowodu.

## Regresja 1.2.5

Sprawdź wersję 1.2.5 w Diagnostyce. Przycisk otwierania powinien być na środku górnego paska; sprawdź także mniejsze okno i dostęp do natywnej paginacji. Otwórz wyniki z filtrem autora i kanału. Przed odczytem coherent może być false przejściowo; ustabilizowane wyniki powinny mieć coherent=true i zgodne queryOffset/propsOffset/paginationOffset. Zbierz wszystkie strony; przy 2554 wynikach i faktycznie odczytanym pageSize=25 totalPages powinno wynosić 103. Sprawdź próbki linków, końcowy eksport i Stop podczas ładowania. Jeśli coherent pozostaje false, zapisz coherenceReason oraz trzy offsety; nie kwalifikuj takiej strony jako odczytanej. Rozwiń diagnostykę i upewnij się, że tekst jest widoczny bez przewijania poziomego.

Sprawdź także chwilowe totalResults=0 podczas normalnego fetch: odczyt ma czekać, bez kolejnego kliknięcia; po zakończeniu powinien kontynuować. busyReasons powinno wskazywać wyłącznie stan samej wyszukiwarki. Faktyczna zmiana licznika/filtra po załadowaniu nadal ma zatrzymywać przebieg.

Sprawdź ustawienia przerwy 3–30 s, stały zakres 5–5 s i błędny min > max. Zapisz zakres, przeładuj i porównaj wartości. Podczas odliczania pola mają być zablokowane; Stop ma anulować przyszłe click od razu. Zmień wyniki/stronę ręcznie podczas przerwy: adapter powinien zatrzymać click po ponownej weryfikacji.
