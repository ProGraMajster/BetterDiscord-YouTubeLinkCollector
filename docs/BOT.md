# Registered-bot CLI

Author: **ProGraMajster**. The existing detailed instructions below are in Polish. This separate tool uses a registered bot and the official API; it is not part of plugin UI pagination.

## Oficjalny bot: historia kanału

Narzędzie wymaga **Node.js 22+**, własnej zarejestrowanej aplikacji/bota i możliwości dodania go do serwera. Nie obsługuje tokenów kont użytkowników. Nie prosi o token w panelu wtyczki.

1. W [Discord Developer Portal](https://discord.com/developers/applications) utwórz bota. Włącz **Message Content Intent**, a jeśli aplikacja wymaga zatwierdzenia, uzyskaj je. Dodaj bota do wybranego serwera za pomocą oficjalnej instalacji aplikacji.
2. Nadaj mu dostęp tylko do potrzebnego kanału: **View Channel** i **Read Message History**. Administrator oraz Send Messages nie są potrzebne. Narzędzie weryfikuje konto bota, flagi aplikacji i efektywne uprawnienia kanału.
3. W terminalu, w katalogu rozpakowanej paczki, ustaw `DISCORD_BOT_TOKEN` na token **tego bota**, bez prefiksu `Bot `. Nie zapisuj go w skrypcie ani pliku kolekcji. Przykład PowerShell z niewyświetlanym wpisywaniem:

```powershell
$botSecret = Read-Host 'Token zarejestrowanego bota' -AsSecureString
$botCredential = [System.Net.NetworkCredential]::new('', $botSecret)
$env:DISCORD_BOT_TOKEN = $botCredential.Password
node .\tools\collect-channel.mjs --channel 123456789012345678 --out .\exports
Remove-Item Env:\DISCORD_BOT_TOKEN
$botCredential = $null
$botSecret = $null
```

ID w przykładzie jest przykładowe — użyj ID swojego kanału. Sekret jest dostępny procesowi narzędzia w pamięci i środowisku; polecenie usunięcia należy wykonać także po błędzie lub przerwaniu. Nie udostępniaj tokena innym osobom.

Wznowienie:

```powershell
node .\tools\collect-channel.mjs --channel 123456789012345678 --out .\exports --resume
```

Narzędzie zapisuje checkpoint po każdej partii oraz trzy eksporty na końcu, także po przerwaniu/błędzie podczas skanu. **Ctrl+C** zatrzymuje odczyt, zapisuje postęp i eksportuje niepełne wyniki. Istniejący checkpoint wymaga `--resume`; aby zacząć niezależną kolekcję, wskaż nowy katalog lub `--checkpoint` z nową ścieżką. `--max-pages 10000` ogranicza liczbę stron jednej sesji; limit nie oznacza zakończenia historii. Kod wyjścia: 0 — koniec zadeklarowanego zakresu, 2 — przerwanie/limit stron, 1 — błąd. Błąd przed rozpoczęciem skanu nie nadpisuje wcześniejszego checkpointu.

Zakres bota: **jeden kanał tekstowy lub ogłoszeniowy serwera**, bez wątków potomnych, DM-ów i forów. Paginacja używa oficjalnego Get Channel Messages, do 100 wiadomości na partię. Krótsza niepusta partia nie kończy skanu. Osiągnięcie końca wymaga pustej partii i ponownego sprawdzenia dostępu oraz Message Content. 429 powoduje oczekiwanie zgodne z Retry-After; 401/403 zatrzymują odczyt. Nie ma obchodzenia limitów.

Status COMPLETE obejmuje tylko dostępną historię do najnowszej wiadomości odczytanej w pierwszej partii. Discord nie oferuje atomowej migawki: późniejsze wiadomości, edycje, usunięcia i zmiany uprawnień mogą wpłynąć na wynik. Narzędzie nie odzyskuje usuniętych wiadomości. Otwórz odpowiedni kanał w kliencie i użyj **Import JSON**, aby zastąpić lokalną kolekcję eksportem bota. Import wymaga potwierdzenia i zgodności kanału. Panel wyraźnie informuje, że dowody kompletności są deklaracją z pliku, nie niezależnym sprawdzeniem serwera.
