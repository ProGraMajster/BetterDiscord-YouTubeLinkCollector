# YouTube Link Collector 1.2.5 — czytelne podsumowanie i ruchome okno

Autor projektu: **ProGraMajster**.

Dotychczasowy panel pokazywał 148 wyników wyszukiwania, 121 linków oraz INCOMPLETE bez rozliczenia różnicy. Dawny błąd pozostał czerwony pod poprawnie zakończonym przebiegiem. W 1.2.5 panel pokazuje osobno sprawdzone wiadomości, wiadomości z linkami i bez rozpoznanych linków oraz linki w całej kolekcji. Ukończenie wyszukiwania jest sukcesem; ograniczenie pełnej historii ma osobne wyjaśnienie. Niepotwierdzone wiadomości i rzeczywiste niezgodności licznika nadal blokują zielone zakończenie. Historia wcześniejszych błędów jest zwinięta; aktualny błąd pozostaje widoczny i historia nie jest kasowana.

Historyczna weryfikacja klienta 1.2.4 potwierdziła rozliczenie 148 wiadomości ze stron 1–6 (25+25+25+25+25+23). 121 wiadomości miało rozpoznane linki YouTube, 27 miało checkpoint bez linków. Kolekcja zawierała 121 wystąpień, 117 unikalnych zasobów i 4 powtórzenia. Faza nawigacji finished. Nie uznano tego za dowód pełnej historii rozmowy ani fizycznego zapisu końcowego eksportu.

Okno można przeciągać za pasek tytułu i przesuwać strzałkami. Przyciski nie wywołują ruchu. Nagłówek pozostaje dostępny przy przewijaniu i po zmianie rozmiaru viewportu; dostępna wysokość panelu dopasowuje się do położenia. Po zamknięciu/otwarciu pozycja pozostaje w tej sesji. Cleanup zwalnia pointer capture i listenery; pozycja nie jest dopisywana do checkpointu.

Walidacja: 168/168 testów automatycznych, bez pominięć. Przeglądarka z syntetycznym BdApi: podsumowanie/nawigacja/eksport 18/18 PASS, pięć istniejących kliknięć Next i sześć potwierdzonych stron. Dodatkowo sprawdzono bieżący błąd i przywrócenie checkpointu bez autoFinished, zwiniętą historię, rzeczywisty drag, strzałki, zachowanie pozycji i resize 480×360 bez poziomego overflow. Podgląd [PANEL-1.2.5.png](PANEL-1.2.5.png) przedstawia dane syntetyczne, nie konto użytkownika. Nowego interfejsu 1.2.5 agent nie sprawdził w natywnym Discordzie.

Plugin podmieniono w dotychczasowym katalogu BetterDiscord po wykonaniu prywatnych kopii pluginu i konfiguracji. Skrypt nie zapisywał konfiguracji; kontrola bajtów przed/po potwierdziła niezmieniony plik. JSON roundtrip zachował dane, rozliczenie wiadomości, historię błędu i zapisany zakres oczekiwania. Eksport callback, schemat 1 i odczyt checkpointów bota do 1.2.4 zachowane. SHA-256 pluginu: b3f90a2e13dfd01bc0db1002f66df1a05473e1a4c6b273ed891094e88742addd. Prywatne kopie są poza paczką.
