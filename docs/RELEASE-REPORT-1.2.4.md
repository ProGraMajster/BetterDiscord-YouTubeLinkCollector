# YouTube Link Collector 1.2.4 — ustawiana przerwa między stronami

Autor projektu: **ProGraMajster**.

W Ustawienia i prywatność dodano minimum/maksimum oczekiwania w sekundach i Zapisz zakres. Domyślnie 3–30 s; losowanie całych sekund dla każdego przejścia, także cofania. Zakres 0–300 s, min ≤ max; równe wartości oznaczają stałą przerwę. Zapis obejmuje checkpoint/JSON. Starsze checkpointy zachowują wszystkie rekordy i dostają domyślne wartości.

Oczekiwanie następuje po stabilizacji i checkpointcie strony. Panel pokazuje pozostały czas. Stop/Pauza i wyłączenie pluginu anulują timer i odliczanie natychmiast. Po przerwie adapter ponownie sprawdza zakres/stronę/payload przed jednym istniejącym kliknięciem. Timeout ładowania jest liczony od click, nie od początku przerwy. Zmiana ustawień podczas pracy jest zablokowana. Funkcja reguluje tempo; nie zapewnia niewykrywalności ani nie obchodzi ograniczeń klienta.

Zachowano [naprawy 1.2.3](RELEASE-REPORT-1.2.3.md): numeracja od 1, loading wyszukiwarki zamiast embedów, tolerowanie przejściowego zerowego licznika podczas fetch. Użytkownik potwierdził przechodzenie kolejnych stron w 1.2.3. Koniec całego zakresu i końcowy eksport na tym koncie nie są potwierdzone. Nowe ustawienia 1.2.4 nie zostały jeszcze zakwalifikowane w natywnym Discordzie.

163/163 testów PASS. Przeglądarka: nawigacja i pełny TXT 13/13 z zakresem 3–3 s ustawionym przez rzeczywiste kontrolki; Stop podczas 30 s przerwy 4/4, Stop podczas fetch 4/4, timeout 5/5. Odliczanie pokazało przejście na 2 za 30 s; po Stop zniknęło i nie było kliknięcia. Zweryfikowano zapis ustawień, checkpoint i kolekcję. Fixture używa syntetycznego BdApi, rzeczywistego DOM/kliknięć, loading embedu, zerowania licznika podczas fetch i właściwej numeracji. [Walidacja](VALIDATION.md).

Przycisk YT • Kolektor pozostaje na środku górnego paska; nie zasłania dolnego pagera. Autorstwo ProGraMajster, eksport callback i zgodność schematu 1 zachowane. Narzędzie bota odczytuje poprzednie checkpointy do 1.2.3; nie korzysta z ustawienia przerwy UI.

Plugin podmieniono w dotychczasowym katalogu BetterDiscord. Przed aktualizacją zachowano poprzedni plugin i konfigurację; skrypt nie zapisywał konfiguracji. Końcowy SHA-256 pluginu: 1680de352bdb73fa4420daf1b7d8bc9f1c1edb7ad35249ff286bf043bcdfb608. Prywatne kopie i materiały konta są poza ZIP.
