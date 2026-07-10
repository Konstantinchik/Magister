# Autotests — Magister

Автотесты браузерного поведения уроков сайта Magister на **Playwright + Firefox**.
Сейчас покрыт `lesson1`: клики по интерактивам, заполнение полей и списков,
проверка озвучивания (Web Speech API), прогресса и отсутствия PHP-ошибок.

## Требования

- **Node.js 18+** (в PATH);
- **PHP** — любой из:
  - portable PHP в `..\MagisterTest\vendor\php\php.exe` (ставится `MagisterTest\setup.ps1 -PhpOnly`);
  - системный `php` в PATH (XAMPP, Laragon, WAMP, OSPanel);
  - путь, заданный переменной окружения `MAGISTER_PHP`.

Firefox для Playwright и npm-зависимости BAT-файлы ставят сами при первом запуске.

## Запуск

Двойным щелчком или из консоли:

```bat
headless\run_lesson1_firefox_headless.bat   REM без окна, отчёт в консоли и JSON
headed\run_lesson1_firefox_headed.bat       REM с видимым окном браузера
```

Каждый BAT при первом запуске:

1. проверяет наличие `node` и `npm`;
2. при отсутствии `node_modules` ставит Playwright: `call npm --prefix <autotests> install`;
3. синхронизирует браузер: `playwright install firefox`;
4. запускает сценарий и в конце делает `pause`, чтобы окно не закрылось.

## Настройка окружения (переменные)

Пути **не зашиты в код** — переопределяются переменными окружения:

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `MAGISTER_SITE` | корень сайта (где `index.php`) | родительская папка `autotests` |
| `MAGISTER_PHP` | путь к `php.exe` | автопоиск (см. ниже) |
| `MAGISTER_AUTOTEST_PORT` | порт локального `php -S` | свободный порт |

Порядок автопоиска PHP (`resolvePhp` в `_common/lesson1_firefox_common.mjs`):

1. `MAGISTER_PHP`, если задан и запускается;
2. portable PHP: `<repo>\..\MagisterTest\vendor\php\php.exe`;
3. `vendor\php\php.exe` внутри репозитория;
4. системный `php` из PATH;
5. типичные стеки: XAMPP, Laragon, WAMP64, OSPanel, `C:\Program Files\php`.

Каждый кандидат проверяется запуском `php -v`, поэтому битая сборка
(например, без Visual C++ Redistributable) молча пропускается, а не роняет тест
с непонятной ошибкой. Если PHP не найден нигде — тест завершается с понятной
подсказкой, что установить.

Пример запуска с явными путями (PowerShell):

```powershell
$env:MAGISTER_PHP = "C:\php\php.exe"
$env:MAGISTER_SITE = "D:\MAGISTER\Magister"
node headless\lesson1_firefox_headless.mjs
```

## Отчёты

JSON с деталями прогона пишется в `headed\reports\` или `headless\reports\`
(`lesson1-firefox-report.json`): счётчики кликов/заполнений, состояние страницы,
console-ошибки, список assertions. Папки `reports\` и `node_modules\` — в `.gitignore`.

## Структура

```
autotests/
├── _common/
│   └── lesson1_firefox_common.mjs   общий сценарий (поиск PHP, запуск сервера, прогон)
├── headed/
│   ├── lesson1_firefox_headed.mjs
│   └── run_lesson1_firefox_headed.bat
├── headless/
│   ├── lesson1_firefox_headless.mjs
│   └── run_lesson1_firefox_headless.bat
├── package.json
└── README.md
```

## Дальше

Номер урока сейчас зафиксирован (`lesson1`). Чтобы покрыть `lesson2`, `lesson3` …,
общий сценарий можно параметризовать номером и вынести привязки `4%` / `Пройдено`
в аргументы функции `runLesson1FirefoxAutotest`.
