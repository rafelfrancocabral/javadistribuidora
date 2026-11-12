/* ============================================================
   Java Distribuidora — Campanhas sazonais
   ------------------------------------------------------------
   Para ativar/desativar ou mudar as datas, edite apenas este
   arquivo. O site se ajusta sozinho (hero, selos e filtro).

   "ativa" é o interruptor geral. "inicio"/"fim" delimitam o
   período em que a campanha aparece automaticamente.
   ============================================================ */
window.CAMPANHA = {
    blackNovember: {
        ativa: true,
        inicio: '2026-11-01T00:00:00-03:00',
        fim: '2026-11-30T23:59:59-03:00',
        // Rótulo usado no selo dos produtos e no filtro do catálogo
        selo: 'Black November',
        // Rótulo do filtro (pill) no catálogo
        filtro: 'Black November'
    }
};

(function () {
    var cfg = (window.CAMPANHA && window.CAMPANHA.blackNovember) || null;
    var timer = null;

    function dentroDoPeriodo() {
        if (!cfg || !cfg.ativa) return false;
        var agora = Date.now();
        var ini = cfg.inicio ? Date.parse(cfg.inicio) : -Infinity;
        var fim = cfg.fim ? Date.parse(cfg.fim) : Infinity;
        return agora >= ini && agora <= fim;
    }

    // Usado pelo script.js para exibir filtro/selos
    window.blackNovemberAtiva = dentroDoPeriodo;

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function atualizarContagem() {
        var el = document.getElementById('bnCountdown');
        if (!el || !cfg) return;
        var restante = Date.parse(cfg.fim) - Date.now();
        if (restante <= 0) {
            encerrar();
            return;
        }
        var total = Math.floor(restante / 1000);
        var valores = {
            days: Math.floor(total / 86400),
            hours: Math.floor((total % 86400) / 3600),
            minutes: Math.floor((total % 3600) / 60),
            seconds: total % 60
        };
        Object.keys(valores).forEach(function (k) {
            var node = el.querySelector('[data-bn="' + k + '"]');
            if (node) node.textContent = pad(valores[k]);
        });
    }

    function ajustarLinksInicio() {
        // Enquanto a campanha está no ar, "Início" aponta para o hero Black.
        document.querySelectorAll('a[href="#home"]').forEach(function (a) {
            a.setAttribute('href', '#homeBlack');
        });
    }

    function encerrar() {
        if (timer) { clearInterval(timer); timer = null; }
        document.documentElement.classList.remove('isBlackCampaign');
        var black = document.getElementById('homeBlack');
        if (black) black.style.display = 'none';
        var normal = document.getElementById('home');
        if (normal) normal.style.display = '';
        document.querySelectorAll('a[href="#homeBlack"]').forEach(function (a) {
            a.setAttribute('href', '#home');
        });
    }

    function iniciarContagem() {
        atualizarContagem();
        if (!timer) timer = setInterval(atualizarContagem, 1000);
    }

    document.addEventListener('DOMContentLoaded', function () {
        var black = document.getElementById('homeBlack');
        if (!black) return;
        if (!dentroDoPeriodo()) {
            black.style.display = 'none';
            return;
        }
        document.documentElement.classList.add('isBlackCampaign');
        ajustarLinksInicio();
        iniciarContagem();
    });
})();
