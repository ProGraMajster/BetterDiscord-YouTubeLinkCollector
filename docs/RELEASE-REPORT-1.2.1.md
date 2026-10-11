> Raport historyczny. Kolejny test użytkownika wykazał timeout ładowania mimo poprawnej numeracji. Pełne naprawy i aktualny wynik opisuje [raport 1.2.3](RELEASE-REPORT-1.2.3.md).

# YouTube Link Collector 1.2.1 — naprawa automatycznego przechodzenia stron

Autor projektu: ProGraMajster.

Przyczyna zgłoszonego zatrzymania na pierwszej stronie była błędną konwersją numeru paginacji. Discord przekazuje currentPage=1 przy offset=0; adapter traktował currentPage jako indeks od zera, wyliczał offset=25 i blokował kliknięcie. Diagnostyka użytkownika potwierdziła queryOffset=propsOffset=0, paginationOffset=25 i filtersCoherent=true. Komponent SearchPagination (moduł 876689) faktycznie liczy floor(offset/pageSize)+1; dopiero callback odejmuje 1.

Poprawka liczy offset jako (currentPage-1)*pageSize i zachowuje numer strony z UI. Dla 2554 wyników/pageSize=25 są 103 strony; strony 1/2/103 dają offsety 0/25/2550, ostatnia ma 4 wyniki. Wykonano rzeczywistą fabrykę komponentu offline z infrastrukturą testową i porównano ten sam kontrakt z poprzednim kodem: 1.2.0 i wstępny 1.2.1 odrzucają pierwszą stronę, końcowy kod ją odczytuje i dopuszcza standardową akcję Next. [Szczegóły źródeł](CLIENT-AUDIT.md).

Zachowano checkpoint przed każdym istniejącym kliknięciem rel=prev/next, stabilizację, potwierdzenie nowego numeru/offsetu/ID, timeout i natychmiastowy Stop. Nie osłabiono sprawdzania spójności. Dodatkowo poprawiono odczyt zatwierdzonych gałęzi React przy współdzielonych dzieciach i obsługę zwykłych filtrów z innego realm. Rzeczywiście inne filtry/offsety nadal blokują przejście. Diagnostyka pokazuje konkretne przyczyny, trzy offsety, currentPage i paginationBase=1; zawija tekst.

Przycisk YT • Kolektor jest na środku górnego paska. Nie zasłania dolnej paginacji. Eksport callback, autorstwo, schemat checkpointu oraz brak samoczynnego wznowienia kliknięć zachowane. Checkpointy oficjalnego bota 1.2.0 nadal są odczytywane.

149/149 testów i kontrola składni PASS. Test przeglądarkowy zgodny z numeracją od 1, z osobnym realm (iframe), współdzielonym fiber i istniejącymi przyciskami: 13/13 PASS; odczyt 3 stron/19 linków, pełny TXT i checkpointy przed kliknięciem. To kontrakt testowy, nie zalogowany Discord. Dostępne narzędzia nie udostępniają natywnego okna; końcowe potwierdzenie działania na koncie pozostaje w toku.

Końcową poprawkę podmieniono również w dotychczasowym katalogu BetterDiscord, zachowując kopie poprzednich pluginów i konfiguracji. Skrypt nie zapisywał konfiguracji. Prywatne kopie, zrzuty użytkownika oraz pełne zasoby Discorda/BetterDiscorda nie są dołączone do ZIP.
