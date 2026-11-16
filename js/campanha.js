/* ============================================================
   Java Distribuidora — Campanhas sazonais
   ------------------------------------------------------------
   Para ativar/desativar ou mudar as datas, edite apenas este
   arquivo. O site se ajusta sozinho (hero, selos e filtro).

   "ativa" é o interruptor geral. "inicio"/"fim" delimitam o
   período em que a campanha aparece automaticamente.

   As campanhas são resolvidas uma de cada vez: quando uma
   termina, a próxima já entra sozinha, sem precisar mexer no
   HTML (Black November → Super Natal).

   Durante o desenvolvimento local é possível forçar uma
   campanha pela URL:
       index.html?campanha=natal
       index.html?campanha=blackNovember
       index.html?campanha=normal
   (o atalho só funciona em localhost)
   ============================================================ */
window.CAMPANHA = {
    blackNovember: {
        ativa: true,
        inicio: '2026-11-01T00:00:00-03:00',
        fim: '2026-11-30T23:59:59-03:00',
        // Rótulo usado no selo dos produtos e no filtro do catálogo
        selo: 'Black November',
        // Rótulo do filtro (pill) no catálogo
        filtro: 'Black November',
        // Ícone (Font Awesome) usado no selo/filtro
        icone: 'fa-bolt',
        hero: 'homeBlack',
        countdown: 'bnCountdown',
        classe: 'isBlackCampaign'
    },
    natal: {
        ativa: true,
        inicio: '2026-12-01T00:00:00-03:00',
        fim: '2026-12-31T23:59:59-03:00',
        selo: 'Super Natal',
        filtro: 'Super Natal',
        icone: 'fa-gift',
        hero: 'homeNatal',
        countdown: 'natalCountdown',
        classe: 'isNatalCampaign'
    }
};

(function () {
    var CHAVES = Object.keys(window.CAMPANHA);
    var timer = null;

    // Atalho de desenvolvimento: ?campanha=natal | blackNovember | normal
    var forcar = (function () {
        try {
            var valor = new URLSearchParams(location.search).get('campanha');
            if (!valor) return null;
            var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
            if (!local) return null;
            if (valor === 'normal') return 'normal';
            return window.CAMPANHA[valor] ? valor : null;
        } catch (e) { return null; }
    })();

    function dentroDoPeriodo(cfg) {
        if (!cfg || !cfg.ativa) return false;
        var agora = Date.now();
        var ini = cfg.inicio ? Date.parse(cfg.inicio) : -Infinity;
        var fim = cfg.fim ? Date.parse(cfg.fim) : Infinity;
        return agora >= ini && agora <= fim;
    }

    // Retorna { chave, cfg } da campanha em vigor (ou null).
    function campanhaAtual() {
        if (forcar === 'normal') return null;
        if (forcar) return { chave: forcar, cfg: window.CAMPANHA[forcar] };

        var ativas = CHAVES.filter(function (k) { return dentroDoPeriodo(window.CAMPANHA[k]); });
        if (!ativas.length) return null;
        // Se duas se sobrepuserem, vence a que começou por último.
        ativas.sort(function (a, b) {
            return (Date.parse(window.CAMPANHA[b].inicio) || 0) - (Date.parse(window.CAMPANHA[a].inicio) || 0);
        });
        return { chave: ativas[0], cfg: window.CAMPANHA[ativas[0]] };
    }

    function chaveAtual() {
        var atual = campanhaAtual();
        return atual ? atual.chave : null;
    }

    // API pública usada pelo site (js/script.js) e por outros scripts
    window.campanhaAtual = campanhaAtual;
    window.campanhaAtualChave = chaveAtual;
    window.campanhaAtiva = function () { return !!campanhaAtual(); };
    window.campanhaSelo = function () { var c = campanhaAtual(); return (c && c.cfg.selo) || ''; };
    window.campanhaFiltro = function () { var c = campanhaAtual(); return (c && c.cfg.filtro) || ''; };
    window.campanhaIcone = function () { var c = campanhaAtual(); return (c && c.cfg.icone) || 'fa-tags'; };
    // Compatibilidade com versões antigas do site
    window.blackNovemberAtiva = function () { return chaveAtual() === 'blackNovember'; };

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function pararContagem() {
        if (timer) { clearInterval(timer); timer = null; }
    }

    // Aplica a campanha em vigor: hero visível, classe no <html>,
    // links de "Início" e contagem regressiva.
    function aplicar() {
        var atual = campanhaAtual();

        CHAVES.forEach(function (k) {
            var cfg = window.CAMPANHA[k];
            var secao = cfg.hero ? document.getElementById(cfg.hero) : null;
            var visivel = !!atual && atual.chave === k;
            if (secao) secao.style.display = visivel ? 'flex' : 'none';
            if (cfg.classe) document.documentElement.classList.toggle(cfg.classe, visivel);
        });

        var normal = document.getElementById('home');
        if (normal) normal.style.display = atual ? 'none' : '';

        // "Início" (menu, logo e rodapé) aponta para o hero em exibição.
        var alvo = atual ? '#' + atual.cfg.hero : '#home';
        document.querySelectorAll('a[href^="#home"]').forEach(function (a) {
            a.setAttribute('href', alvo);
        });

        // O catálogo (filtro e selos) se redesenha ao trocar de campanha.
        try {
            document.dispatchEvent(new CustomEvent('campanha:mudou', {
                detail: { chave: atual ? atual.chave : null }
            }));
        } catch (e) {}
    }

    function atualizarContagem() {
        var atual = campanhaAtual();
        if (!atual) {
            // Nenhuma campanha no ar agora: aplica o hero normal e
            // agenda a próxima (a virada pode cair num intervalo).
            pararContagem();
            aplicar();
            iniciarContagem();
            return;
        }

        var cfg = atual.cfg;
        var el = document.getElementById(cfg.countdown);
        if (!el) return;

        var restante = Date.parse(cfg.fim) - Date.now();
        if (restante <= 0 && !forcar) {
            // Campanha terminou com a página aberta: passa para a próxima.
            pararContagem();
            aplicar();
            iniciarContagem();
            return;
        }

        var total = Math.max(0, Math.floor(restante / 1000));
        var valores = {
            days: Math.floor(total / 86400),
            hours: Math.floor((total % 86400) / 3600),
            minutes: Math.floor((total % 3600) / 60),
            seconds: total % 60
        };
        Object.keys(valores).forEach(function (k) {
            var node = el.querySelector('[data-cd="' + k + '"]');
            if (node) node.textContent = pad(valores[k]);
        });
    }

    var proximaTimer = null;

    // Se nenhuma campanha está no ar, acorda na hora em que a próxima começar
    // (evita a página ficar no hero normal por estar aberta na virada).
    function agendarProxima() {
        if (proximaTimer) { clearTimeout(proximaTimer); proximaTimer = null; }
        if (forcar) return;
        var agora = Date.now();
        var inicios = CHAVES.map(function (k) {
            return Date.parse(window.CAMPANHA[k].inicio);
        }).filter(function (t) { return t > agora; }).sort(function (a, b) { return a - b; });
        if (!inicios.length) return;
        // setTimeout não aceita atrasos muito longos: re-checa no máximo a cada hora
        var espera = Math.min(inicios[0] - agora + 1500, 3600000);
        proximaTimer = setTimeout(function () {
            aplicar();
            iniciarContagem();
        }, espera);
    }

    function iniciarContagem() {
        pararContagem();
        if (!campanhaAtual()) { agendarProxima(); return; }
        atualizarContagem();
        timer = setInterval(atualizarContagem, 1000);
    }

    window.aplicarCampanha = function () {
        aplicar();
        iniciarContagem();
    };

    document.addEventListener('DOMContentLoaded', function () {
        aplicar();
        iniciarContagem();
    });

    // Aba em segundo plano pode ter os timers atrasados pelo navegador:
    // ao voltar para a página, garante a campanha e a contagem corretas.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        aplicar();
        iniciarContagem();
    });
})();
