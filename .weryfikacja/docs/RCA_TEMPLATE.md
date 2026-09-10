# RCA — {{TASK}} / bramka {{GATE}} / iteracja {{ITER}}

> Diagnoza przyczyny źródłowej. **Bramka nie wpuści drugiej próby**, dopóki pole
> `detect:` poniżej nie jest wypełnione (gate.sh sprawdza to automatycznie).
> Po naprawie: `scripts/add-pitfall.sh docs/rca/<ten-plik>.md` dopisuje detektor
> do rejestru — i ten błąd nigdy więcej nie przechodzi przez krok 0.

- data: {{DATE}}
- zadanie: {{TASK}}
- bramka: {{GATE}}
- iteracja: {{ITER}}
- tytul: TODO krótka nazwa błędu (trafi do rejestru jako tytuł pułapki)
- kategoria: TODO A–H
- tryb: TODO empty | obecny | raport

## Objaw (co zgłosiła bramka)
{{POWOD}}

## Przyczyna źródłowa (min. 2 poziomy „dlaczego")
1. Dlaczego wystąpił objaw? →
2. Dlaczego to było możliwe? →

## Poprawka (co zmieniamy TERAZ)
-

- fix: TODO jednolinijkowa reguła poprawna (trafi do rejestru)

## Detektor (OBOWIĄZKOWE przed 2. iteracją)
<!-- Jedna linia bash wykonywalna przez `bash -c`. Output = linie naruszeń.
     tryb empty: output ⇒ FAIL · tryb obecny: brak outputu ⇒ FAIL · tryb raport: output ⇒ WARN -->
- detect: TODO

## Weryfikacja detektora
- [ ] Uruchomiony na kodzie SPRZED poprawki — łapie błąd (albo: uzasadnienie, czemu nie da się odtworzyć)
- [ ] Uruchomiony na kodzie PO poprawce — cisza
- [ ] Fałszywe pozytywy sprawdzone (detektor nie strzela do zdrowego kodu)

## Wpływ
- Co jeszcze mogło być dotknięte tą samą przyczyną:
