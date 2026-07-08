<?php
// lessons.php — все 24 занятия + интерактив.

$lesson = isset($_GET['n']) ? (int)$_GET['n'] : 1;
if ($lesson < 1) $lesson = 1;
if ($lesson > 24) $lesson = 24;

$file = __DIR__ . "/data/lesson{$lesson}.php";
$hasPascalTrainer = $lesson >= 19 && $lesson <= 24;

$pageTitle = "Занятие {$lesson} — ПГУ • Информатика";
$openMainContainer = false;
$extraHead = $hasPascalTrainer
    ? '    <link href="/assets/css/pascal-trainer.css" rel="stylesheet">' . PHP_EOL
    : '';
$extraFooterScripts = '';

if ($hasPascalTrainer) {
    $extraFooterScripts .= '        <script src="/assets/js/pascal-trainer.js"></script>' . PHP_EOL;
}

$extraFooterScripts .= <<<HTML
        <script>
        try {
            localStorage.setItem('lastLesson', {$lesson});
        } catch (e) {
            console.warn('localStorage недоступен, последнее занятие не сохранено.', e);
        }
        </script>

HTML;

require __DIR__ . '/header.php';
?>

    <!-- Инфо о занятии + прогресс-бар -->
    <div class="bg-white border-top border-bottom">
        <div class="container py-3">
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <div class="fw-semibold">
                    Занятие <?= $lesson ?> из 24
                </div>
                <div class="small text-muted">
                    Навигация и прогресс сохраняются в браузере
                </div>
            </div>

            <div class="progress mt-2" style="height: 10px;">
                <div id="globalProgress" class="progress-bar" role="progressbar" style="width: 0%;">0%</div>
            </div>
        </div>
    </div>

    <div class="container my-4">

        <!-- Навигация по занятиям -->
        <div class="btn-group d-flex flex-wrap mb-4" role="group" aria-label="Навигация по занятиям">
            <?php for ($i = 1; $i <= 24; $i++): ?>
                <a href="/lessons.php?n=<?= $i ?>"
                   class="btn <?= $i == $lesson ? 'btn-primary' : 'btn-outline-primary' ?> btn-sm m-1">
                    <?= $i ?>
                </a>
            <?php endfor; ?>
        </div>

        <!-- Контент занятия -->
        <div id="lesson-content" class="mb-5">
            <?php
            if (file_exists($file)) {
                include $file;
            } else {
                echo '<div class="alert alert-warning">Материал для занятия ' . $lesson . ' пока не добавлен.</div>';
            }
            ?>
        </div>

        <!-- Кнопки вперёд/назад -->
        <div class="d-flex justify-content-between mt-4 mb-5">
            <?php if ($lesson > 1): ?>
                <a href="/lessons.php?n=<?= $lesson - 1 ?>" class="btn btn-outline-primary">← Предыдущее занятие</a>
            <?php else: ?>
                <div></div>
            <?php endif; ?>

            <?php if ($lesson < 24): ?>
                <a href="/lessons.php?n=<?= $lesson + 1 ?>" class="btn btn-primary">Следующее занятие →</a>
            <?php else: ?>
                <a href="/index.php" class="btn btn-success">Вернуться на главную</a>
            <?php endif; ?>
        </div>

    </div>

<?php require __DIR__ . '/footer.php'; ?>
