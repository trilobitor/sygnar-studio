---
name: hait-governance
description: >
  Tryb rady hAit — ustrukturyzowany spór dla decyzji, których nie da się
  sprawdzić bramką. Używaj przy hasłach „decyzja strategiczna", „rada",
  „zarząd", „czy powinniśmy", „opcje z konsekwencjami", „ryzyko biznesowe",
  „wycena", „umowa", „zatrudnienie", „pivot" — a także zawsze, gdy zadanie nie
  ma komendy walidacji zwracającej kod wyjścia.
---

# hait-governance — tryb rady

## Dlaczego to jest osobny skill, a nie faza protokołu

Protokół fazowy opiera się na tym, że fakt rozstrzyga skrypt. W decyzji
zarządczej **nie ma skryptu**: nie istnieje `gate.sh` dla pytania, czy przejść
na inny model rozliczeń. Kiedy warstwa 2 znika, jedyną dostępną bramką zostaje
ustrukturyzowany spór — i wtedy wiele perspektyw przestaje być ozdobnikiem,
a staje się jedynym mechanizmem kontroli jakości, jaki został.

To jest obszar, w którym architektura hAit jest najmocniej uzasadniona
i jednocześnie najtrudniejsza do zweryfikowania. Obie rzeczy trzeba mówić razem.

## Konstrukcja

**Role o sprzecznych funkcjach celu.** Nie „różne osobowości" — różne
**interesy**. Rola, która optymalizuje koszt, i rola, która optymalizuje
odporność, nie zgodzą się ze sobą, i o to chodzi. Zgodność ról o tym samym
interesie nie wnosi informacji.

**Zbieranie w izolacji.** Każda rola formułuje rekomendację, nie widząc
pozostałych. Dopiero Arbiter zestawia je razem. Bez tego pierwsza wypowiedź
zakotwicza resztę i rada produkuje jedną opinię w pięciu redakcjach.

**Obowiązkowa rozbieżność.** Jeśli wszystkie role zbiegły się do tego samego
kierunku, ostatnia w kolejce ma obowiązek sformułować najmocniejszy możliwy
kontrargument. Jednomyślność w trudnej decyzji zwykle znaczy, że nikt nie
policzył kosztu utrzymania.

## Wyjście

Rada **nie podejmuje decyzji**. Produkuje:

1. **Opcje z konsekwencjami** — po jednym akapicie na opcję, każdy kończy się
   zdaniem „to jest błędne, jeśli…".
2. **Rekomendację z rodowodem** — z jawnym rozdziałem: co jest sprawdzalnym
   faktem, co wnioskiem z podanych przesłanek, a co zgadywaniem podanym,
   bo lepsze niż milczenie.
3. **Rozbieżność** — kto się nie zgadza i na jakiej podstawie. Rada, której
   protokół nie odnotował sporu, przebiegła źle.
4. **Czego brakuje** — dane, które zmieniłyby rekomendację.

Naciśnięcie przycisku i jego skutki są po stronie człowieka. Rola przedstawia
opcje; eskalacja zawsze prowadzi do właściciela decyzji.

## Decyzje, których rada nie podejmuje nigdy

Wydatki i umowy. Zatrudnienie i rozstanie. Usunięcie danych. Cokolwiek
nieodwracalnego. Dla tych rada przygotowuje materiał i zatrzymuje się.

## Pomiar — uczciwie

W przeciwieństwie do inżynierii, **nie ma tu bramki, więc nie ma łatwego
pomiaru**. Jedyna metodyka, która nie jest samooszukiwaniem:

- decyzje archiwizuje się z datą i prognozą (co ma się wydarzyć, do kiedy);
- po upływie terminu ktoś sprawdza, co się wydarzyło naprawdę;
- mierzy się **kalibrację** — czy prognozy z pewnością 70% sprawdzają się
  w 70% przypadków — a nie „trafność".

To jest pomiar wolny (kwartały, nie dni) i dlatego kuszący do pominięcia.
Pominięcie oznacza, że warstwa governance nie ma żadnego dowodu poza tym,
że brzmi rozsądnie.

## Warunek falsyfikacji

Ten skill jest błędny, jeśli po ~20 zarchiwizowanych decyzjach kalibracja rady
nie różni się od kalibracji jednej roli pytanej wprost. Wtedy ustrukturyzowany
spór jest kosztownym rytuałem, a nie mechanizmem, i zostaje z niego wyłącznie
wartość dokumentacyjna — która też jest wartością, ale zupełnie inną i tańszą
do uzyskania.
