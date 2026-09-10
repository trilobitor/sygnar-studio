# Deskryptor trackera — GitHub

**Kontrakt:** żadna rola ani żaden skill hAit nie wywołuje CLI trackera wprost.
Role nazywają **operacje**; ten plik mówi, jak każda operacja się wykonuje.
Nowy dostawca (Linear, Jira, GitLab) to jeden nowy plik w tym katalogu i jedna
zmiana pola `tracker` w `.hait/hait.config.json` — zero zmian w rolach.

Wzorzec przejęty z `open-mercato/skills` (DECISIONS.md → „Tracker abstraction").
Powód, dla którego to jest **markdown, a nie kod**: deskryptor czyta agent
w czasie działania, więc działa identycznie w każdym harnessie, a
skommitowana kopia w repozytorium jest punktem nadpisania — zespół edytuje
ten plik, żeby zmienić dowolną operację. Ta sama zasada „lokalny plik wygrywa",
co przy rolach.

**Reguła bezpieczeństwa, której nadpisanie nie może rozluźnić:** operacje
oznaczone `ZAPIS` wymagają jawnej decyzji człowieka, jeśli
`hait.config.json → silnik.autonomia` nie jest ustawiona na `true`.

---

## Wymagania

`gh` uwierzytelnione w bieżącym repozytorium (`gh auth status`).
Brak `gh` ⇒ operacje odczytu degradują do `git`, operacje zapisu zwracają
`NIEDOSTĘPNE` — nigdy nie udają sukcesu.

## Operacje odczytu

| Operacja | Wykonanie |
|---|---|
| `get-issue <nr>` | `gh issue view <nr> --json number,title,body,labels,assignees,state` |
| `search-issues <q>` | `gh issue list --search "<q>" --json number,title,labels --limit 25` |
| `get-pr <nr>` | `gh pr view <nr> --json number,title,body,labels,files,reviews,statusCheckRollup` |
| `get-pr-diff <nr>` | `gh pr diff <nr>` |
| `list-checks <nr>` | `gh pr checks <nr>` |

## Operacje zapisu — ZAPIS

| Operacja | Wykonanie |
|---|---|
| `comment-issue <nr> <plik>` | `gh issue comment <nr> --body-file <plik>` |
| `update-comment <id> <plik>` | `gh api -X PATCH /repos/{owner}/{repo}/issues/comments/<id> -f body=@<plik>` |
| `label <nr> <etykiety>` | `gh issue edit <nr> --add-label "<etykiety>"` |
| `create-pr` | `gh pr create --draft --title "<t>" --body-file <plik>` |
| `comment-pr <nr> <plik>` | `gh pr comment <nr> --body-file <plik>` |
| `mark-pr-ready <nr>` | `gh pr ready <nr>` |
| `merge-pr <nr>` | `gh pr merge <nr> --squash` |

## Reguły wiążące

1. **Jeden komentarz z uzasadnieniem etykiet na przebieg**, nadpisywany przez
   `update-comment`, nie dopisywany. Powód: łańcuch dopisywanych komentarzy
   jest nieczytelny i różni się między runtime'ami.
2. **Blokada zadania jest przekazywana, nigdy zwalniana i brana na nowo.**
   Rola kończąca etap przekazuje blokadę następnej (komentarz z nazwą
   następnej roli) *przed* zwolnieniem swojej. Powód: okno bez blokady
   pozwala innemu wykonawcy zacząć duplikat — błąd zaobserwowany
   produkcyjnie w cudzym pipelinie i tam naprawiony; przejmujemy naprawę,
   nie błąd.
3. **Rola prosi o odbiór, nigdy go sobie nie przyznaje.** Etykieta
   `qa-approved` nie może zostać nadana przez żadną rolę hAit. To jedyna
   bramka, której warstwa 2 ani 3 nie zastąpi.
4. `merge-pr` nigdy nie jest wywoływane przez rolę — wyłącznie przez człowieka.
