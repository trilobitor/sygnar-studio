/**
 * Limity wspólne dla serwera i przeglądarki.
 *
 * Osobny plik, bo obie strony muszą znać tę samą liczbę: panel odrzuca za duży
 * plik od razu, żeby nie wysyłać stu megabajtów na darmo, a serwer i tak
 * sprawdza to jeszcze raz, bo panel nie jest źródłem prawdy.
 *
 * Wcześniej stała mieszkała w `server/services/file-type`, a komponent
 * kliencki importował ją stamtąd. Turbopack odcinał resztę modułu, więc nic
 * wrażliwego nie wyciekało — ale wystarczyłby jeden import runtime'owy w tym
 * module (`node:fs`, klient bazy), żeby wciągnąć go do przeglądarki albo
 * wywalić budowanie klienta (SYG-110).
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
