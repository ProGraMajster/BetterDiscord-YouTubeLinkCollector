# Przebieg automatycznej kolekcji 1.2.5

Autor projektu: ProGraMajster.

## Podsumowanie i przesuwanie okna

Po ukończeniu zakresu widzisz Odczyt wyszukiwania zakończony i np. 6/6 stron. Sekcja Wiadomości z wybranego wyszukiwania pokazuje sprawdzone wiadomości / licznik Discorda, wiadomości z linkami i bez rozpoznanych linków YouTube. Przykład: 148/148 sprawdzonych, 121 z linkami, 27 bez linków. Te 27 wiadomości zostało odczytanych; nie są pominiętymi wynikami. Rozpoznawanie uwzględnia źródła włączone w ustawieniach. Wiadomości bez dostępnej zawartości nie są zaliczane do wiadomości bez linków.

Liczniki Linki YouTube w całej kolekcji oznaczają wystąpienia, unikalne filmy/playlisty i powtórzenia. Mogą obejmować wiele zakresów i załadowane wiadomości poza bieżącym wyszukiwaniem. Numer strony listy linków jest opisany osobno od stron Discorda.

Pełna historia rozmowy: niepotwierdzona wyjaśnia oznaczenie INCOMPLETE eksportu. Ukończenie danego wyszukiwania nie dowodzi całej historii. Bieżący błąd pozostaje wyraźnie widoczny; dawne komunikaty znajdziesz w Diagnostyka → Historia wcześniejszych błędów. Nie są kasowane z checkpointów ani JSON.

Przeciągnij otwarte okno za pasek tytułu. Przyciski na pasku zachowują standardowe działanie. Możesz też zaznaczyć pasek klawiszem Tab i używać strzałek (20 px; Shift + strzałka: 50 px). Pasek pozostaje dostępny w obszarze klienta, także po zmianie rozmiaru okna. Gdy przesuniesz panel niżej, dostępna wysokość dopasuje się do miejsca pod paskiem. Zamykanie i ponowne otwarcie zachowuje pozycję w tej sesji; nie zmienia checkpointu ani kolekcji.

Otwórz kanał i jego wyszukiwanie. Wybierz dokładny filtr in:, domenę youtube.com i stałe sortowanie. Usuń ograniczenia autora/daty, jeśli nie należą do zamierzonego zakresu. W panelu wybierz kanał, format eksportu oraz **Zbierz wszystkie strony**. Samo otwarcie panelu nie rozpoczyna nawigacji.

Kolektor odczytuje wszystkie identyfikowalne wiadomości bieżącej strony z zamontowanych props React, czeka na zgodny pełny zestaw przez minimum 1 s i przetwarza linki. Następnie zapisuje stronę oraz oczekiwany kierunek/numer do checkpointu. Dopiero po przyjęciu zapisu klika istniejący przycisk rel=next/prev. Nie używa prywatnego transportu ani action creatorów. Standardowa akcja przycisku uruchamia normalne działanie klienta.

Po kliknięciu wymaga kolejnego numeru/offsetu, innego podpisu ID, tego samego zapytania/filtrów/sortowania i licznika, zakończenia ładowania i pełnego payloadu. Nowy numer ze starą zawartością nie przechodzi. Tymczasowo nieobecna paginacja i częściowe wyniki są oczekiwaniem, nie sukcesem. Brak dowodu przez 30 s zatrzymuje przebieg bez ponawiania kliknięcia. Zmiana zakresu, licznika lub nieoczekiwany skok strony zatrzymują pracę; zebrane linki pozostają.

Start ze strony >1 powoduje odczyt tej strony, cofanie istniejącym Poprzednia do 1 i przejście Następna do końca. To pozwala rozpocząć na dowolnej już otwartej stronie. Limit kontrolera to 10 000 przejść na przebieg. Użytkownik może przerwać przyciskiem Pauza/Stop; wyłączenie pluginu usuwa jego timery i listenery. Trwającego działania klienta po wcześniej wysłanym kliknięciu nie da się cofnąć, ale kolejne kliknięcia są blokowane natychmiast.

Na końcu muszą zgadzać się bieżący numer i liczba dostępnych stron oraz stan istniejącego Next: disabled; brak Next jest dopuszczony tylko dla jednej strony. Następują zatrzymanie, checkpoint i eksport całej kolekcji w wybranym formacie. Anulowany dialog pozostawia wyniki dostępne do ponownego Eksportuj. Po timeoutcie automatyczny eksport końcowy nie rusza; eksport częściowy jest nadal dostępny ręcznie.

Po Pauza/Stop/restarcie otwórz ten sam zakres i ponownie wybierz Zbierz wszystkie strony. Checkpoint przywraca linki i dowody stron, a nie aktywny timer ani niewysłane kliknięcia. Ponowne odwiedzenie wiadomości nie mnoży wystąpień. Wznów odczyt to osobny pasywny odczyt danych bieżącego widoku.

Następnie wykonaj zakres youtu.be z tą samą kolekcją. Przejście stron jednego zapytania nie zastępuje drugiej domeny. Nie zakładamy, że licznik wyników oznacza liczbę filmów. Jeśli indeks lub klient ogranicza dostępne strony, dziel zakres dat w istniejącym UI. Plugin nie konstruuje zapytań, nie odblokowuje ukrytych/ignorowanych wiadomości i nie omija limitów.

Przy błędzie Brak rozpoznanej paginacji rozwiń Diagnostyka: root/props/queryStore/contextStore/pagination/coherent/payload/pageSize pokazują dokładnie brakujące dowody, bez treści wiadomości ani tokenów. Nie stosujemy zastępczych zgadywanych selektorów przycisków. Pełna historia kanału pozostaje INCOMPLETE, również przy 103/103 stron konkretnego zakresu.

## Przerwa między stronami

Po Stop rozwiń Ustawienia i prywatność. Wpisz Minimum oczekiwania (s) i Maksimum oczekiwania (s), a następnie wybierz Zapisz zakres. Domyślnie jest 3–30 s. Dla stałej przerwy wpisz tę samą wartość w obu polach; 0–0 wyłącza dodatkową przerwę. Zakres to całe sekundy 0–300, minimum ≤ maksimum.

Dla każdego przejścia w obie strony wtyczka losuje liczbę całych sekund z zapisanego zakresu. Najpierw stabilizuje i zapisuje stronę, potem pokazuje odliczanie, a przed kliknięciem ponownie sprawdza wyniki. Timeout ładowania kolejnej strony liczy się od kliknięcia. Stop/Pauza/wyłączenie pluginu przerywają przerwę natychmiast. Ustawienia są zablokowane podczas zbierania i zachowane w checkpointach/JSON. Przerwa reguluje tempo; nie zapewnia niewykrywalności.
