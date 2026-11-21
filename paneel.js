/* Huiskamer-paneel – in de stijl van Apple HomeView.
   Twee wijzerplaten om tussen te vegen: Klok (rustscherm) en Overzicht (widgets).
   Geen server nodig: Spotify logt in met PKCE (alleen een Client ID, geen geheim),
   het weer komt van Open-Meteo (gratis, zonder sleutel).
   Zolang Spotify of de agenda niet gekoppeld is, toont het paneel voorbeeldgegevens. */
(function () {
  'use strict';

  // ---------- hulpjes ----------
  var $ = function (id) { return document.getElementById(id); };
  var html = document.documentElement;
  var RUST_NA = 90 * 1000;          // na 1,5 minuut niets aanraken → klok
  var RUST_NA_NACHT = 30 * 1000;
  var NACHT_VAN = 23 * 60, NACHT_TOT = 6 * 60 + 30;

  function lees(sleutel, standaard) {
    try { var w = localStorage.getItem('paneel.' + sleutel); return w === null ? standaard : JSON.parse(w); }
    catch (e) { return standaard; }
  }
  function bewaar(sleutel, waarde) {
    try { localStorage.setItem('paneel.' + sleutel, JSON.stringify(waarde)); } catch (e) {}
  }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var meldTimer;
  function meld(tekst) {
    var m = $('melding');
    m.textContent = tekst; m.classList.add('zichtbaar');
    clearTimeout(meldTimer); meldTimer = setTimeout(function () { m.classList.remove('zichtbaar'); }, 3000);
  }
  function tweeCijfers(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return tweeCijfers(d.getHours()) + ':' + tweeCijfers(d.getMinutes()); }
  function mss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + tweeCijfers(s % 60); }
  function zelfdeDag(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function hoofdletter(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  var fmtDatum = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  var fmtDagKort = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' });
  var fmtWeekdag = new Intl.DateTimeFormat('nl-NL', { weekday: 'long' });
  var fmtWeekdagKort = new Intl.DateTimeFormat('nl-NL', { weekday: 'short' });

  function DEMO_START() { return window.self !== window.top || /[?&]voorbeeld/.test(location.search); }
  var instellingen = {
    plaats: lees('plaats', DEMO_START() ? { naam: 'Apeldoorn', lat: 52.2112, lon: 5.9699 } : { naam: 'Utrecht', lat: 52.0908, lon: 5.1222 }),
    clientId: lees('clientId', '') || '3e8939358f744f439a8a819d925019e8'   // Spotify-app van Tim (niet geheim)
  };
  // Voorbeeldstand alleen op de productpagina (paneel in een iframe) of met ?voorbeeld.
  // Een echt paneel begint leeg en wordt ingesteld met de telefoon (QR-code).
  var DEMO = window.self !== window.top || /[?&]voorbeeld/.test(location.search);

  // Het huishouden: 1 tot 4 personen, elk met een eigen kleur (p1..p4), plus 'samen'.
  var leden = lees('leden', null);
  var agendaLinks = lees('agendaLinks', {});
  if (!leden) {   // overzetten van de eerste versie (vast 'papa' en 'joyce')
    var oud = lees('namen', null);
    if (oud || agendaLinks.papa !== undefined) {
      oud = oud || { papa: 'Arjan', joyce: 'Joyce' };
      leden = [{ id: 'p1', naam: oud.papa }, { id: 'p2', naam: oud.joyce }];
      agendaLinks = { p1: agendaLinks.papa || '', p2: agendaLinks.joyce || '', samen: agendaLinks.samen || '' };
      bewaar('leden', leden); bewaar('agendaLinks', agendaLinks);
    } else leden = [];
  }
  if (DEMO) { leden = [{ id: 'p1', naam: 'Arjan' }, { id: 'p2', naam: 'Joyce' }]; agendaLinks = {}; }
  function naamVan(id) { var l = leden.filter(function (x) { return x.id === id; })[0]; return l ? l.naam : ''; }
  function agendaSoorten() { return leden.map(function (l) { return l.id; }).concat(['samen']); }
  // instellink: ?client=<Client ID> vult de Spotify Client ID in. Het adres blijft staan, zodat een
  // beginscherm-icoon (dat op iOS een eigen geheugen heeft) hem ook meekrijgt. Niet geheim (PKCE).
  (function () {
    var m = /[?&]client=([0-9a-fA-F]{32})/.exec(location.search);
    if (!m || lees('clientId', '') === m[1]) return;
    instellingen.clientId = m[1]; bewaar('clientId', m[1]);
    setTimeout(function () { meld('Spotify-sleutel ingevuld: houd de klok 2 seconden ingedrukt en tik op Koppel'); }, 800);
  })();

  // ---------- klok + nacht ----------
  var nachtGeforceerd = null;   // voor de voorbeeldpagina
  function isNacht(d) {
    if (nachtGeforceerd !== null) return nachtGeforceerd;
    var m = d.getHours() * 60 + d.getMinutes();
    return m >= NACHT_VAN || m < NACHT_TOT;
  }
  var laatsteMinuut = '';
  function tikKlok() {
    var nu = new Date(), t = hhmm(nu);
    if (t === laatsteMinuut) return;
    laatsteMinuut = t;
    var dt = fmtDatum.format(nu);
    $('kg-tijd').textContent = t; $('tijd').textContent = t;
    $('kg-datum').textContent = dt; $('datum').textContent = dt;
    $('ag-dag').textContent = fmtWeekdag.format(nu);
    $('ag-nummer').textContent = nu.getDate();
    html.classList.toggle('nacht', isNacht(nu));
    tekenAgenda();
  }
  setInterval(tikKlok, 1000);

  // ---------- wijzerplaten ----------
  function opKlok() { return html.classList.contains('op-klok'); }
  function gaNaar(klok) {
    if (klok === opKlok()) return;
    html.classList.toggle('op-klok', klok);
    if (klok) { ladeDicht(); agendaDicht(); zetFilter('alles'); if (zichtbaar()) zetZichtbaar(false); }
    spotify.peil();
  }
  var laatsteAanraking = Date.now();
  var gestuurd = false;   // true = de voorbeeldpagina stuurt het paneel aan
  document.addEventListener('pointerdown', function () { laatsteAanraking = Date.now(); }, true);
  setInterval(function () {
    var wacht = isNacht(new Date()) ? RUST_NA_NACHT : RUST_NA;
    if (gestuurd) return;
    if ($('instellingen').hidden && !opKlok() && Date.now() - laatsteAanraking > wacht) gaNaar(true);
  }, 2000);

  // lang drukken op een klok → instellingen
  ['klok', 'kg-boven'].forEach(function (id) {
    var t, x, y;
    $(id).addEventListener('pointerdown', function (e) { x = e.clientX; y = e.clientY; t = setTimeout(vraagCode, 2000); });
    $(id).addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - x) + Math.abs(e.clientY - y) > 10) clearTimeout(t); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (s) { $(id).addEventListener(s, function () { clearTimeout(t); }); });
  });

  // ---------- weer (Open-Meteo) ----------
  var WEER = {
    0: ['Onbewolkt', 'zon'], 1: ['Overwegend helder', 'zon'], 2: ['Half bewolkt', 'halfzon'], 3: ['Bewolkt', 'wolk'],
    45: ['Mist', 'mist'], 48: ['Mist met rijp', 'mist'],
    51: ['Lichte motregen', 'regen'], 53: ['Motregen', 'regen'], 55: ['Dichte motregen', 'regen'],
    56: ['IJzel', 'regen'], 57: ['IJzel', 'regen'],
    61: ['Lichte regen', 'regen'], 63: ['Regen', 'regen'], 65: ['Zware regen', 'buien'],
    66: ['IJzel', 'regen'], 67: ['IJzel', 'regen'],
    71: ['Lichte sneeuw', 'sneeuw'], 73: ['Sneeuw', 'sneeuw'], 75: ['Zware sneeuw', 'sneeuw'], 77: ['Sneeuwkorrels', 'sneeuw'],
    80: ['Lichte buien', 'buien'], 81: ['Buien', 'buien'], 82: ['Zware buien', 'buien'],
    85: ['Sneeuwbuien', 'sneeuw'], 86: ['Zware sneeuwbuien', 'sneeuw'],
    95: ['Onweer', 'onweer'], 96: ['Onweer met hagel', 'onweer'], 99: ['Onweer met hagel', 'onweer']
  };
  var WOLK = '<path class="wi-wolk" d="M7.6 19.5h10a4.1 4.1 0 0 0 .55-8.16A5.7 5.7 0 0 0 7.2 10.3a4.6 4.6 0 0 0 .4 9.2z"/>';
  var WOLK_LAAG = '<path class="wi-wolk" d="M7.4 15.8h10.2a3.7 3.7 0 0 0 .5-7.36A5.2 5.2 0 0 0 8 7.6a4.1 4.1 0 0 0-.6 8.2z"/>';
  function icoon(soort, dag) {
    var zon = '<circle class="wi-zon" cx="12" cy="12" r="4.6"/><g style="stroke:#ffd60a;stroke-width:2;stroke-linecap:round">' +
      [0, 45, 90, 135, 180, 225, 270, 315].map(function (h) {
        return '<line x1="12" y1="2.2" x2="12" y2="4.2" transform="rotate(' + h + ' 12 12)"/>';
      }).join('') + '</g>';
    var maan = '<path class="wi-maan" d="M15.2 3.6a8.4 8.4 0 1 0 5.2 13.1 7.2 7.2 0 0 1-5.2-13.1z"/>';
    var hemel = dag ? zon : maan;
    var klein = '<g transform="translate(-2.6 -3.4) scale(.78)">' + hemel + '</g>';
    var s = {
      zon: hemel,
      halfzon: klein + WOLK,
      wolk: '<path class="wi-wolk-achter" d="M13.6 12.8h6.2a3.2 3.2 0 0 0 .3-6.38A4.3 4.3 0 0 0 12.4 5.6"/>' + WOLK,
      mist: '<g class="wi-mist"><line x1="4" y1="8.5" x2="20" y2="8.5"/><line x1="6" y1="12.5" x2="18" y2="12.5"/><line x1="4" y1="16.5" x2="20" y2="16.5"/></g>',
      regen: WOLK_LAAG + '<g class="wi-druppel"><line x1="9" y1="18.6" x2="8.2" y2="21.2"/><line x1="13" y1="18.6" x2="12.2" y2="21.2"/><line x1="17" y1="18.6" x2="16.2" y2="21.2"/></g>',
      buien: WOLK_LAAG + '<g class="wi-druppel"><line x1="8" y1="18.2" x2="6.8" y2="21.6"/><line x1="11.5" y1="18.2" x2="10.3" y2="21.6"/><line x1="15" y1="18.2" x2="13.8" y2="21.6"/><line x1="18.5" y1="18.2" x2="17.3" y2="21.6"/></g>',
      sneeuw: WOLK_LAAG + '<g class="wi-sneeuw"><circle cx="9" cy="19.6" r="1.25"/><circle cx="13" cy="21.1" r="1.25"/><circle cx="17" cy="19.6" r="1.25"/></g>',
      onweer: WOLK_LAAG + '<path class="wi-flits" d="M12.6 15.4 9.8 20.1h2.7l-1.1 3.7 4.1-5.5h-2.8l1.5-2.9z"/>'
    }[soort] || hemel;
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + s + '</svg>';
  }

  var weerNu = null;
  function haalWeer() {
    var p = instellingen.plaats;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon +
      '&current=temperature_2m,weather_code,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=6&timezone=Europe%2FAmsterdam';
    fetch(url).then(function (r) { return r.json(); }).then(verwerkWeer).catch(function () {
      // geen internet of geblokkeerd (bijv. in de voorbeeldpagina): in de voorbeeldstand nagemaakt weer
      if (DEMO) verwerkWeer(voorbeeldWeer());
      else $('weer-omschrijving').textContent = 'Weer niet bereikbaar';
    });
  }
  function voorbeeldWeer() {
    var nu = new Date(); nu.setMinutes(0, 0, 0);
    var h = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], is_day: [] };
    for (var i = 0; i < 12; i++) {
      var t = new Date(nu.getTime() + i * 3600000), u = t.getHours();
      h.time.push(t.getFullYear() + '-' + tweeCijfers(t.getMonth() + 1) + '-' + tweeCijfers(t.getDate()) + 'T' + tweeCijfers(u) + ':00'); h.temperature_2m.push(9 - Math.abs(14 - u) * 0.4);
      h.weather_code.push([2, 2, 3, 3, 61, 3, 2, 1, 1, 0, 0, 0][i]); h.precipitation_probability.push([0, 10, 20, 40, 60, 30, 10, 0, 0, 0, 0, 0][i]);
      h.is_day.push(u >= 8 && u < 17 ? 1 : 0);
    }
    var dagen = { time: [], weather_code: [2, 61, 3, 0, 80, 2], temperature_2m_max: [9, 8, 10, 12, 9, 11], temperature_2m_min: [3, 4, 2, 1, 5, 4] };
    for (var j = 0; j < 6; j++) { var d = new Date(); d.setDate(d.getDate() + j); dagen.time.push(d.getFullYear() + '-' + tweeCijfers(d.getMonth() + 1) + '-' + tweeCijfers(d.getDate())); }
    return { current: { temperature_2m: 8, weather_code: 2, is_day: h.is_day[0] }, hourly: h, daily: dagen };
  }
  function verwerkWeer(d) {
    var p = instellingen.plaats;
    (function () {
      var c = d.current, w = WEER[c.weather_code] || ['', 'wolk'], dag = c.is_day === 1;
      var hoog = Math.round(d.daily.temperature_2m_max[0]), laag = Math.round(d.daily.temperature_2m_min[0]);
      weerNu = { temp: Math.round(c.temperature_2m), tekst: w[0], soort: w[1], dag: dag, hoog: hoog, laag: laag };

      $('weer-plaats').textContent = p.naam;
      $('weer-temp').textContent = weerNu.temp + '°';
      $('weer-icoon').innerHTML = icoon(w[1], dag);
      $('weer-omschrijving').textContent = w[0];
      $('weer-hl').textContent = 'H:' + hoog + '° L:' + laag + '°';

      // per uur: Nu + de komende 5 uur
      var nu = new Date(), uren = [];
      for (var i = 0; i < d.hourly.time.length && uren.length < 6; i++) {
        var t = new Date(d.hourly.time[i]);
        if (t.getTime() + 3600000 > nu.getTime()) uren.push(i);
      }
      $('weer-uren').innerHTML = uren.map(function (i, n) {
        var code = WEER[d.hourly.weather_code[i]] || ['', 'wolk'];
        var kans = d.hourly.precipitation_probability[i];
        var label = n === 0 ? 'Nu' : String(new Date(d.hourly.time[i]).getHours());
        var temp = n === 0 ? weerNu.temp : Math.round(d.hourly.temperature_2m[i]);
        var ic = n === 0 ? icoon(weerNu.soort, weerNu.dag) : icoon(code[1], d.hourly.is_day[i] === 1);
        return '<div class="uur"><span>' + label + '</span>' + ic +
          '<div class="kans">' + (kans >= 30 ? kans + '%' : '') + '</div><b>' + temp + '°</b></div>';
      }).join('');

      // komende 4 dagen met temperatuurbalkjes
      var min = Math.min.apply(null, d.daily.temperature_2m_min.slice(0, 4));
      var max = Math.max.apply(null, d.daily.temperature_2m_max.slice(0, 4));
      var span = Math.max(1, max - min);
      var dagen = '';
      for (var j = 0; j < 4; j++) {
        var dc = WEER[d.daily.weather_code[j]] || ['', 'wolk'];
        var lo = d.daily.temperature_2m_min[j], hi = d.daily.temperature_2m_max[j];
        var naam = j === 0 ? 'Vandaag' : hoofdletter(fmtWeekdagKort.format(new Date(d.daily.time[j] + 'T12:00')).replace('.', ''));
        dagen += '<div class="dagrij"><span>' + naam + '</span>' + icoon(dc[1], true) +
          '<span class="laag">' + Math.round(lo) + '°</span>' +
          '<span class="bereik"><i style="left:' + ((lo - min) / span * 100).toFixed(1) + '%;right:' + ((max - hi) / span * 100).toFixed(1) + '%"></i></span>' +
          '<span class="hoog">' + Math.round(hi) + '°</span></div>';
      }
      var blok = document.querySelector('.ww-dagen');
      if (!blok) { blok = document.createElement('div'); blok.className = 'ww-dagen'; $('weer').appendChild(blok); }
      blok.innerHTML = dagen;
      tekenKlokWidgets();
    })();
  }
  haalWeer();
  setInterval(haalWeer, 15 * 60 * 1000);

  // ---------- agenda ----------
  // Voorlopig voorbeeldafspraken. Later: de gedeelde iCloud-agenda's (zie README).
  function voorbeeldAgenda() {
    var basis = new Date(); basis.setHours(0, 0, 0, 0);
    function op(dag, u, m, duur, titel, plek, wie, heleDag) {
      var s = new Date(basis); s.setDate(s.getDate() + dag); s.setHours(u, m);
      var e = new Date(s.getTime() + duur * 60000);
      return { start: s, eind: e, titel: titel, plek: plek, wie: wie, heleDag: !!heleDag };
    }
    return [
      op(0, 9, 30, 60, 'Boodschappen', 'Markt', 'samen'),
      op(0, 13, 0, 240, 'Atelier open', 'Atelier Joy', 'p2'),
      op(0, 18, 30, 150, 'Tim komt eten', '', 'samen'),
      op(1, 0, 0, 1440, 'Verjaardag Henk', '', 'samen', true),
      op(1, 10, 0, 180, 'Motorrit', 'Veluwe', 'p1'),
      op(2, 8, 45, 30, 'Tandarts', 'Tandartspraktijk', 'p1'),
      op(2, 19, 30, 120, 'Yoga', 'Sportschool', 'p2'),
      op(3, 18, 0, 180, 'Eten bij vrienden', 'Zwolle', 'samen'),
      op(4, 0, 0, 1440, 'Sieradenbeurs', 'Utrecht', 'p2', true),
      op(5, 20, 0, 120, 'Voetbal kijken', '', 'p1'),
      op(6, 10, 30, 120, 'Fietsen', 'Rondje Apeldoorn', 'samen')
    ];
  }
  var afspraken = DEMO ? voorbeeldAgenda() : [];

  // ---------- echte agenda's (gedeelde iCloud-agenda's, via het doorgeefluik bij Cloudflare) ----------
  // Per persoon één of meer links (Agenda-app → (i) bij de agenda → Openbare agenda → Deel koppeling).
  // Staat dezelfde afspraak in de agenda van allebei, of in de gedeelde agenda, dan is hij 'samen'.
  var DOORGEEFLUIK = 'https://homeview-agenda.timev.workers.dev/';
  var agendaEcht = false, agendaFoutGemeld = false;
  function linksVan(t) { return String(t || '').split(/\s+/).filter(function (x) { return /^(webcal|https):\/\//i.test(x); }); }
  function heeftAgendaLinks() { return agendaSoorten().some(function (w) { return linksVan(agendaLinks[w]).length; }); }
  function haalAgenda() {
    if (DEMO) return;
    if (!heeftAgendaLinks() || !window.leesIcs) { agendaEcht = false; afspraken = []; tekenAgenda(); return; }
    var van = new Date(); van.setHours(0, 0, 0, 0);
    var tot = new Date(van); tot.setDate(tot.getDate() + 8);
    var klussen = [];
    agendaSoorten().forEach(function (wie) {
      linksVan(agendaLinks[wie]).forEach(function (link) {
        klussen.push(fetch(DOORGEEFLUIK + '?url=' + encodeURIComponent(link)).then(function (r) {
          if (!r.ok) throw new Error('agenda ' + r.status);
          return r.text();
        }).then(function (t) { return { wie: wie, items: window.leesIcs(t, van, tot) }; }));
      });
    });
    Promise.all(klussen.map(function (k) { return k.catch(function (e) { return { fout: e }; }); })).then(function (res) {
      var gelukt = res.filter(function (x) { return !x.fout; });
      if (!gelukt.length) {
        if (!agendaFoutGemeld) { meld('Agenda ophalen lukt nu niet'); agendaFoutGemeld = true; }
        if (!agendaEcht) tekenAgenda();
        return;
      }
      agendaFoutGemeld = false;
      var opSleutel = {}, lijst = [];
      gelukt.forEach(function (x) {
        x.items.forEach(function (a) {
          var k = (a.uid || a.titel) + '|' + a.start.getTime();
          var al = opSleutel[k];
          if (al) { if (al.wie !== x.wie) al.wie = 'samen'; return; }
          a.wie = x.wie; opSleutel[k] = a; lijst.push(a);
        });
      });
      afspraken = lijst; agendaEcht = true;
      tekenAgenda();
    });
  }
  setTimeout(haalAgenda, 300);
  setInterval(haalAgenda, 10 * 60 * 1000);

  // privé: standaard verborgen; één tik op 'Toon' laat alles zien, tot het paneel weer in rust gaat
  function zichtbaar() { return html.classList.contains('agenda-zichtbaar'); }
  function zetZichtbaar(aan) {
    html.classList.toggle('agenda-zichtbaar', aan);
    $('ag-prive-tekst').textContent = aan ? 'Verberg' : 'Toon';
    tekenAgenda();
  }
  // grijs balkje in plaats van tekst; breedte hangt af van de tekst, zodat het er natuurlijk uitziet
  function balk(tekst, max) {
    var lengte = Math.min(max || 9, 3 + String(tekst).length * 0.45);
    return '<span class="balk" style="width:' + lengte.toFixed(1) + 'em"></span>';
  }
  function titelHtml(a, max) { return zichtbaar() ? esc(a.titel) : balk(a.titel, max); }
  var filter = 'alles';
  var KLEUR = { samen: 'var(--kleur-samen)', p1: 'var(--kleur-p1)', p2: 'var(--kleur-p2)', p3: 'var(--kleur-p3)', p4: 'var(--kleur-p4)' };

  function tekenAgenda() {
    html.classList.toggle('geen-agenda', !DEMO && !heeftAgendaLinks());
    var nu = new Date(), vandaag = new Date(nu); vandaag.setHours(0, 0, 0, 0);
    var lijst = afspraken.filter(function (a) {
      return (filter === 'alles' || a.wie === filter) && a.eind > vandaag;
    }).sort(function (a, b) { return a.start - b.start; });

    var uit = '', huidigeDag = null;
    lijst.forEach(function (a) {
      var dag = new Date(a.start); dag.setHours(0, 0, 0, 0);
      if (dag < vandaag) dag = vandaag;
      if (!huidigeDag || dag.getTime() !== huidigeDag.getTime()) {
        if (huidigeDag) uit += '</div>';
        huidigeDag = dag;
        var verschil = Math.round((dag - vandaag) / 86400000);
        var naam = verschil === 0 ? 'Vandaag' : verschil === 1 ? 'Morgen' : fmtDagKort.format(dag);
        uit += '<div class="dag"><div class="dag-naam">' + esc(naam) + '</div>';
      }
      var tijd = a.heleDag ? 'Hele dag' : hhmm(a.start) + ' – ' + hhmm(a.eind);
      var wieNaam = a.wie === 'samen' ? 'Samen' : naamVan(a.wie);
      var sub = [tijd, zichtbaar() ? a.plek : '', filter === 'alles' ? wieNaam : ''].filter(Boolean).join(' · ');
      uit += '<div class="item' + (a.eind < nu ? ' voorbij' : '') + '" data-wie="' + a.wie + '">' +
        '<span class="item-streep"></span><span class="item-wat"><div class="item-titel">' + titelHtml(a, 11) + '</div>' +
        '<div class="item-sub">' + esc(sub) + '</div></span></div>';
    });
    if (huidigeDag) uit += '</div>';
    $('agenda-lijst').innerHTML = uit || (!DEMO && !heeftAgendaLinks()
      ? '<div class="leeg leeg-koppel"><p>Nog geen agenda gekoppeld</p><button class="leeg-knop" data-koppel>Koppel agenda</button></div>'
      : !DEMO && !agendaEcht ? '<div class="leeg">' + (agendaFoutGemeld ? 'Agenda ophalen lukt nu niet' : 'Agenda wordt opgehaald…') + '</div>'
      : '<div class="leeg">Geen afspraken</div>');
    tekenWeek(nu, vandaag);
    tekenKlokWidgets();
  }

  // groot: 7 dagen naast elkaar, zoals de weekweergave van Agenda
  function tekenWeek(nu, vandaag) {
    var uit = '';
    for (var i = 0; i < 7; i++) {
      var dag = new Date(vandaag); dag.setDate(dag.getDate() + i);
      var eind = new Date(dag); eind.setDate(eind.getDate() + 1);
      var items = afspraken.filter(function (a) {
        return (filter === 'alles' || a.wie === filter) && a.start < eind && a.eind > dag;
      }).sort(function (a, b) { return (b.heleDag - a.heleDag) || (a.start - b.start); });
      uit += '<div class="wk-dag' + (i === 0 ? ' vandaag' : '') + '"><div class="wk-kop">' +
        '<span class="wk-naam">' + esc(fmtWeekdagKort.format(dag).replace('.', '')) + '</span>' +
        '<span class="wk-nr">' + dag.getDate() + '</span></div><div class="wk-items">' +
        (items.map(function (a) {
          return '<div class="wk-item' + (a.eind < nu ? ' voorbij' : '') + '" data-wie="' + a.wie + '">' +
            '<div class="wk-titel">' + titelHtml(a, 6) + '</div>' +
            '<div class="wk-tijd">' + (a.heleDag ? 'Hele dag' : hhmm(a.start) + ' – ' + hhmm(a.eind)) + '</div>' +
            (a.plek && zichtbaar() ? '<div class="wk-plek">' + esc(a.plek) + '</div>' : '') + '</div>';
        }).join('') || '<div class="wk-leeg">–</div>') + '</div></div>';
    }
    $('ag-week').innerHTML = uit;
  }

  // ---------- agenda groot maken ----------
  // De widget komt los uit het raster en groeit naar alles boven de muziekspeler.
  function agendaIsOpen() { return html.classList.contains('agenda-open'); }
  var agendaVan = null, agendaTimer;
  function agendaDoel() {
    var o = $('paneel'), st = getComputedStyle(o), m = $('muziek');
    var top = parseFloat(st.paddingTop), links = parseFloat(st.paddingLeft);
    return { top: top, left: links, width: o.clientWidth - links - parseFloat(st.paddingRight),
      height: m.offsetTop - parseFloat(st.rowGap || st.gridRowGap || 16) - top };
  }
  function zetVak(el, r) { el.style.top = r.top + 'px'; el.style.left = r.left + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; }
  function agendaOpen() {
    if (agendaIsOpen() || opKlok()) return;
    ladeDicht();
    var a = $('agenda');
    clearTimeout(agendaTimer);
    if (!a.classList.contains('zwevend')) {
      agendaVan = { top: a.offsetTop, left: a.offsetLeft, width: a.offsetWidth, height: a.offsetHeight };
      a.style.transition = 'none'; a.classList.add('zwevend'); zetVak(a, agendaVan);
      void a.offsetWidth; a.style.transition = '';
    }
    html.classList.add('agenda-open');
    zetVak(a, agendaDoel());
    setTimeout(function () { zetFilter(filter); }, 0);
    agendaTimer = setTimeout(function () { zetFilter(filter); }, 700);
  }
  function agendaDicht() {
    if (!agendaIsOpen()) return;
    var a = $('agenda');
    html.classList.remove('agenda-open');
    zetVak(a, agendaVan);
    setTimeout(function () { zetFilter(filter); }, 0);
    clearTimeout(agendaTimer);
    agendaTimer = setTimeout(function () {
      a.classList.remove('zwevend'); a.style.top = a.style.left = a.style.width = a.style.height = '';
      zetFilter(filter);
    }, 700);
  }
  $('agenda').addEventListener('click', function (e) {
    if (gesleept) return;
    if (e.target.closest('#ag-dicht')) { agendaDicht(); return; }
    if (e.target.closest('#ag-prive')) { zetZichtbaar(!zichtbaar()); return; }
    if (e.target.closest('.segment')) return;
    if (!agendaIsOpen()) agendaOpen();
  });
  // tik naast de grote agenda (waar klok en weer stonden) sluit hem ook
  $('paneel').addEventListener('click', function (e) {
    if (!gesleept && agendaIsOpen() && !e.target.closest('#agenda, #muziek')) agendaDicht();
  });

  // de twee kleine widgets onder de grote klok
  function tekenKlokWidgets() {
    $('kw-weer').innerHTML = weerNu
      ? icoon(weerNu.soort, weerNu.dag) + '<span class="kw-groot">' + weerNu.temp + '°</span>' +
        '<span class="kw-klein">' + esc(weerNu.tekst) + '<br>H:' + weerNu.hoog + '° L:' + weerNu.laag + '°</span>'
      : '';
    var nu = new Date(), vandaag = new Date(nu); vandaag.setHours(0, 0, 0, 0);
    var grens = new Date(vandaag); grens.setDate(grens.getDate() + 2);
    var v = afspraken.filter(function (a) { return !a.heleDag && a.start > nu && a.start < grens; })
      .sort(function (a, b) { return a.start - b.start; })[0];
    $('kw-agenda').innerHTML = v
      ? '<span class="kw-streep" style="background:' + KLEUR[v.wie] + '"></span><span class="kw-tekst">' +
        '<div class="kw-klein">' + (zelfdeDag(v.start, nu) ? 'Vandaag' : 'Morgen') + ' ' + hhmm(v.start) + '</div>' +
        '<div class="kw-titel">' + titelHtml(v, 9) + '</div></span>'
      : '';
  }

  function zetFilter(wie) {
    filter = wie;
    var pil = document.querySelector('#agenda-filter .segment-pil');
    Array.prototype.forEach.call(document.querySelectorAll('#agenda-filter button'), function (k) {
      var aan = k.getAttribute('data-wie') === wie;
      k.classList.toggle('aan', aan);
      if (aan) { pil.style.width = k.offsetWidth + 'px'; pil.style.transform = 'translateX(' + k.offsetLeft + 'px)'; }
    });
    tekenAgenda();
  }
  $('agenda-filter').addEventListener('click', function (e) {
    var k = e.target.closest('button'); if (k) zetFilter(k.getAttribute('data-wie'));
  });
  function zetNamen() {
    var f = $('agenda-filter');
    // alleen knoppen voor agenda's die er echt zijn; met maar één soort agenda geen filter
    var met = DEMO ? leden : leden.filter(function (l) { return linksVan(agendaLinks[l.id]).length; });
    var samen = DEMO || linksVan(agendaLinks.samen).length > 0 || met.length > 1;
    var h = '<span class="segment-pil"></span><button data-wie="alles">Alles</button>';
    if (samen && leden.length > 1) h += '<button data-wie="samen">Samen</button>';
    met.forEach(function (l) { h += '<button data-wie="' + l.id + '" id="naam-' + l.id + '">' + esc(l.naam) + '</button>'; });
    f.innerHTML = h;
    f.hidden = f.querySelectorAll('button').length < 3;
    if (filter !== 'alles' && !f.querySelector('[data-wie="' + filter + '"]')) filter = 'alles';
    setTimeout(function () { zetFilter(filter); }, 0);
  }
  zetNamen();
  window.addEventListener('resize', function () {
    html.classList.add('geen-animatie'); zetFilter(filter);
    if (agendaIsOpen()) zetVak($('agenda'), agendaDoel());
    setTimeout(function () { html.classList.remove('geen-animatie'); }, 50);
  });

  // ---------- Spotify ----------
  // Bediening van de soundbar via Spotify Connect, plus de muzieklade: zoeken, artiesten, albums,
  // afspeellijsten, podcasts, wachtrij, shuffle/herhalen en "daarna vergelijkbare nummers".
  var spotify = (function () {
    var SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read user-read-recently-played user-top-read';
    var terug = location.origin + location.pathname;
    var token = lees('spotifyToken', null);   // {toegang, ververs, verloopt}
    var staat = null;                          // laatste /me/player
    var staatTijd = 0;
    var peilTimer;

    // ===== voorbeeldstand: een kleine nagemaakte muziekbibliotheek =====
    var voorbeeld = DEMO;
    html.classList.toggle('geen-muziek', !DEMO && !token);
    function verloop(a, b) { return 'linear-gradient(135deg,' + a + ',' + b + ')'; }
    // id, naam, genre, kleuren, album, jaar, nummers [titel, seconden]
    var KAT = [
      ['hazes', 'André Hazes', 'nl', '#7a2e1c', '#e0873c', 'Het beste van André Hazes', 2003, [['Zij gelooft in mij', 221], ['Een beetje verliefd', 196], ['Bloed, zweet en tranen', 224], ['Het is koud zonder jou', 201], ['De vlieger', 238]]],
      ['borsato', 'Marco Borsato', 'nl', '#1f3b6e', '#7aa6e0', 'Het beste van Marco Borsato', 2010, [['Dromen zijn bedrog', 263], ['Rood', 238], ['Afscheid nemen bestaat niet', 245], ['Wat zou je doen', 233]]],
      ['blof', 'BLØF', 'nl', '#0e3a4a', '#4fb3c9', 'Het beste van BLØF', 2017, [['Zoutelande', 191], ['Harder dan ik hebben kan', 216], ['Aan de kust', 254], ['Omarm', 232]]],
      ['golden', 'Golden Earring', 'rock', '#2a2a2a', '#c9a227', 'Het beste van Golden Earring', 2000, [['Radar Love', 383], ['Twilight Zone', 478], ['When the Lady Smiles', 300], ['Back Home', 237]]],
      ['eagles', 'Eagles', 'rock', '#3a2a12', '#d8a24a', 'Hotel California', 1976, [['Hotel California', 391], ['New Kid in Town', 304], ['Life in the Fast Lane', 286]]],
      ['dire', 'Dire Straits', 'rock', '#1c2b2b', '#5fa39b', 'Brothers in Arms', 1985, [['Brothers in Arms', 420], ['Money for Nothing', 506], ['Walk of Life', 252], ['So Far Away', 312]]],
      ['queen', 'Queen', 'rock', '#4a0e0e', '#d43c2c', 'Greatest Hits', 1981, [['Bohemian Rhapsody', 355], ['Don’t Stop Me Now', 209], ['Somebody to Love', 296], ['We Will Rock You', 122]]],
      ['abba', 'ABBA', 'pop', '#1c2a6e', '#c55bd6', 'Gold', 1992, [['Dancing Queen', 231], ['Mamma Mia', 213], ['The Winner Takes It All', 294], ['Waterloo', 168]]],
      ['fleetwood', 'Fleetwood Mac', 'pop', '#2b3a1c', '#a3c96a', 'Rumours', 1977, [['Dreams', 257], ['Go Your Own Way', 223], ['Don’t Stop', 193], ['The Chain', 270]]]
    ];
    var D = { artiesten: [], albums: [], nummers: [], lijsten: [], podcasts: [] };
    KAT.forEach(function (k) {
      var art = { soort: 'artiest', id: k[0], uri: 'demo:artiest:' + k[0], naam: k[1], sub: 'Artiest', genre: k[2], beeld: verloop(k[3], k[4]),
        letters: k[1].split(' ').map(function (w) { return w.charAt(0); }).join('').slice(0, 2) };
      D.artiesten.push(art);
      var alb = { soort: 'album', id: k[0] + '-a', uri: 'demo:album:' + k[0], naam: k[5], sub: k[1] + ' · ' + k[6], beeld: verloop(k[3], k[4]), artiestId: k[0], nummers: [] };
      var live = { soort: 'album', id: k[0] + '-l', uri: 'demo:album:' + k[0] + '-live', naam: 'Live', sub: k[1] + ' · Live', beeld: verloop(k[4], k[3]), artiestId: k[0], nummers: [] };
      k[7].forEach(function (n, i) {
        var nr = { soort: 'nummer', id: k[0] + i, uri: 'demo:nummer:' + k[0] + i, naam: n[0], sub: k[1], artiestId: k[0], artiestNaam: k[1],
          albumId: alb.id, beeld: alb.beeld, duur: n[1] * 1000, genre: k[2] };
        D.nummers.push(nr); alb.nummers.push(nr);
        if (i < 3) live.nummers.push(nr);
      });
      D.albums.push(alb, live);
    });
    function genreNummers(g) { return D.nummers.filter(function (n) { return !g || g.indexOf(n.genre) >= 0; }); }
    [['Zondagochtend', ['pop', 'nl'], '#d8a24a', '#7a4b1c'], ['Hollandse hits', ['nl'], '#e0873c', '#a3281c'], ['Rock classics', ['rock'], '#333', '#8a8a8a'],
     ['Koken met muziek', ['pop'], '#5fa39b', '#1c4b4b'], ['Jaren 80', ['pop', 'rock'], '#c55bd6', '#3c2b8a'], ['Rustig aan', ['pop'], '#7aa6e0', '#1f3b6e'],
     ['Top 2000', null, '#d43c2c', '#5a0e0e'], ['Radio 2 Hits', ['nl', 'pop'], '#4fcc92', '#0e5a3a']].forEach(function (l, i) {
      var nrs = genreNummers(l[1]);
      D.lijsten.push({ soort: 'lijst', id: 'l' + i, uri: 'demo:lijst:' + i, naam: l[0], sub: 'Spotify', beeld: verloop(l[2], l[3]), nummers: nrs });
    });
    [['dedag', 'De Dag', 'NPO Radio 1', '#0e2a5a', '#3c7ae0'], ['oog', 'Met het Oog op Morgen', 'NPO Radio 1', '#1a1a3a', '#6a6ad0'],
     ['boek', 'Boekestijn en De Wijk', 'BNR Nieuwsradio', '#3a1a0e', '#d0763c'], ['echt', 'Echt Gebeurd', 'Echt Gebeurd', '#0e3a2a', '#3cd08a']].forEach(function (p) {
      var pod = { soort: 'podcast', id: p[0], uri: 'demo:podcast:' + p[0], naam: p[1], sub: p[2], beeld: verloop(p[3], p[4]), afleveringen: [] };
      for (var i = 0; i < 6; i++) {
        var d = new Date(); d.setDate(d.getDate() - i * 2 - 1);
        pod.afleveringen.push({ soort: 'aflevering', id: p[0] + 'e' + i, uri: 'demo:aflevering:' + p[0] + i, naam: p[1] + ' van ' + fmtDagKort.format(d),
          sub: fmtDagKort.format(d), beeld: pod.beeld, duur: (24 + (i * 7) % 20) * 60000 });
      }
      D.podcasts.push(pod);
    });
    // echte gegevens (hoezen, nummers, podcasts uit de iTunes-catalogus, zie voorbeeld/muziek.js) als die er zijn
    var TOP = {};
    if (window.VOORBEELD_MUZIEK) D = bouwEcht(window.VOORBEELD_MUZIEK);
    function bouwEcht(V) {
      var E = { artiesten: [], albums: [], nummers: [], lijsten: [], podcasts: [] };
      function u(b) { return b ? 'url("' + b + '")' : ''; }
      function basis(t) { return t.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s*-\s*(Single|EP)$/i, '').trim(); }
      var namen = {};
      V.artiesten.forEach(function (a) {
        namen[a.id] = a.naam;
        E.artiesten.push({ soort: 'artiest', id: a.id, uri: 'demo:artiest:' + a.id, naam: a.naam, sub: 'Artiest', genre: a.genre, beeld: u(a.beeld) });
      });
      var genreVan = {}; V.artiesten.forEach(function (a) { genreVan[a.id] = a.genre; });
      // albums: per artiest dubbele (deluxe, jubileum) weglaten; de gewone uitgave krijgt voorrang
      var gezien = {};
      V.albums.slice().sort(function (a, b) { return (a.naam.length - basis(a.naam).length) - (b.naam.length - basis(b.naam).length); }).forEach(function (a) {
        var sleutel = a.artiestId + '|' + basis(a.naam).toLowerCase();
        if (gezien[sleutel]) { gezien[a.id] = gezien[sleutel]; return; }
        var alb = { soort: 'album', id: a.id, uri: 'demo:album:' + a.id, naam: basis(a.naam) || a.naam, sub: namen[a.artiestId] + (a.jaar ? ' · ' + a.jaar : ''),
          beeld: u(a.beeld), artiestId: a.artiestId, nummers: [] };
        gezien[sleutel] = gezien[a.id] = alb;
        var dubbel = {};
        a.nummers.forEach(function (n, i) {
          var nm = basis(n.naam); if (dubbel[nm.toLowerCase()]) return; dubbel[nm.toLowerCase()] = 1;
          var nr = { soort: 'nummer', id: a.id + '-' + i, uri: 'demo:nummer:' + a.id + '-' + i, naam: nm, sub: namen[a.artiestId], artiestId: a.artiestId,
            artiestNaam: namen[a.artiestId], albumId: a.id, beeld: alb.beeld, duur: n.duur, genre: genreVan[a.artiestId] };
          alb.nummers.push(nr); E.nummers.push(nr);
        });
        E.albums.push(alb);
      });
      // populaire nummers per artiest (zoals "Populair" in Spotify)
      Object.keys(V.top).forEach(function (aid) {
        var dubbel = {};
        TOP[aid] = V.top[aid].map(function (t) {
          var nm = basis(t.naam); if (dubbel[nm.toLowerCase()]) return null; dubbel[nm.toLowerCase()] = 1;
          var alb = gezien[t.albumId];
          var al = alb && alb.nummers.filter(function (x) { return x.naam.toLowerCase() === nm.toLowerCase(); })[0];
          if (al) return al;
          var nr = { soort: 'nummer', id: 'top-' + aid + '-' + nm, uri: 'demo:top:' + aid + ':' + nm, naam: nm, sub: namen[aid], artiestId: aid, artiestNaam: namen[aid],
            albumId: alb ? alb.id : null, beeld: alb ? alb.beeld : u(t.beeld), duur: t.duur, genre: genreVan[aid] };
          E.nummers.push(nr); return nr;
        }).filter(Boolean);
      });
      // afspeellijsten: populaire nummers per soort, met een hoes van vier albums (zoals Spotify dat doet)
      var gebruikt = {};
      [['Zondagochtend', ['pop', 'nl']], ['Hollandse hits', ['nl']], ['Rock classics', ['rock']], ['Koken met muziek', ['pop', 'rock']],
       ['Jaren 80', ['pop', 'rock']], ['Rustig aan', ['pop', 'nl']], ['Top 2000', null], ['Radio 2 Hits', ['nl', 'pop']]].forEach(function (l, i) {
        var nrs = [];
        Object.keys(TOP).forEach(function (aid) { if (!l[1] || l[1].indexOf(genreVan[aid]) >= 0) nrs = nrs.concat(TOP[aid].slice(0, 4)); });
        nrs = nrs.sort(function (a, b) { return ((a.naam.length * 7 + i * 13) % 11) - ((b.naam.length * 7 + i * 13) % 11); }).slice(0, 25);
        // vier hoezen per lijst; hoezen die al eerder als eerste stonden, komen achteraan, zodat de lijsten van elkaar verschillen
        var hoezen = [], kans = 2654435761 * (i + 3) >>> 0;
        nrs.forEach(function (n) { if (hoezen.indexOf(n.beeld) < 0 && n.beeld) hoezen.push(n.beeld); });
        hoezen.sort(function (x, y) {
          var gx = (gebruikt[x] || 0), gy = (gebruikt[y] || 0);
          if (gx !== gy) return gx - gy;
          return ((x.length * kans) % 97) - ((y.length * kans) % 97) || (x < y ? -1 : 1);
        });
        var vier = hoezen.slice(0, 4);
        vier.forEach(function (h) { gebruikt[h] = (gebruikt[h] || 0) + 1; });
        E.lijsten.push({ soort: 'lijst', id: 'l' + i, uri: 'demo:lijst:' + i, naam: l[0], sub: 'Spotify', beeld: vier[0] || '',
          collage: vier.length === 4 ? vier : null, nummers: nrs });
      });
      V.podcasts.forEach(function (p) {
        var pod = { soort: 'podcast', id: p.id, uri: 'demo:podcast:' + p.id, naam: p.naam, sub: p.maker, beeld: u(p.beeld), afleveringen: [] };
        p.afleveringen.forEach(function (e, i) {
          var d = e.datum ? new Date(e.datum) : null;
          pod.afleveringen.push({ soort: 'aflevering', id: p.id + 'e' + i, uri: 'demo:aflevering:' + p.id + i, naam: e.naam, sub: d ? fmtDagKort.format(d) : '',
            beeld: pod.beeld, duur: e.duur });
        });
        E.podcasts.push(pod);
      });
      return E;
    }
    function topVan(aid) { return TOP[aid] || D.nummers.filter(function (n) { return n.artiestId === aid; }); }
    function nummerVan(aid, deel) {
      var l = topVan(aid);
      return l.filter(function (n) { return n.naam.toLowerCase().indexOf(deel) >= 0; })[0] || l[0];
    }
    function albumVan(aid) { return D.albums.filter(function (a) { return a.artiestId === aid; })[0]; }
    function vind(lijst, id) { return lijst.filter(function (x) { return x.id === id; })[0]; }
    function schud(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

    var demo = {
      is_playing: true, volume: 35, apparaat: 'Samsung Soundbar', pos: 64000,
      wachtrij: [nummerVan('hazes', 'zij gelooft'), nummerVan('borsato', 'afscheid'), nummerVan('eagles', 'hotel'), nummerVan('dire', 'brothers')],
      nr: 0, shuffle: false, herhaal: 'off', context: null
    };
    // wat speelt er na het laatste nummer: vergelijkbare muziek (zelfde soort, af en toe dezelfde artiest)
    function demoVergelijkbaar(n) {
      var al = demo.wachtrij.map(function (x) { return x.uri; });
      var pop = [].concat.apply([], Object.keys(TOP).map(function (k) { return TOP[k]; }));
      if (!pop.length) pop = D.nummers;
      var zelfde = schud(pop.filter(function (x) { return x.artiestId === n.artiestId && al.indexOf(x.uri) < 0 && x.naam !== n.naam; })).slice(0, 2);
      var soort = schud(pop.filter(function (x) { return x.genre === n.genre && x.artiestId !== n.artiestId && al.indexOf(x.uri) < 0; })).slice(0, 6);
      if (soort.length + zelfde.length < 3) soort = soort.concat(schud(D.nummers.filter(function (x) { return al.indexOf(x.uri) < 0 && x.uri !== n.uri; })).slice(0, 6));
      return meng(zelfde, soort);
    }
    function meng(zelfde, soort) {   // om en om, zodat niet alles van één artiest achter elkaar komt
      var uit = [], z = 0, s = 0;
      while (z < zelfde.length || s < soort.length) {
        if (s < soort.length) uit.push(soort[s++]);
        if (s < soort.length) uit.push(soort[s++]);
        if (z < zelfde.length) uit.push(zelfde[z++]);
      }
      return uit;
    }
    function demoVolgende(auto) {
      demo.pos = 0; demo.is_playing = true;
      if (auto && demo.herhaal === 'track') return;
      if (demo.shuffle && demo.wachtrij.length > 1) {
        var j; do { j = Math.floor(Math.random() * demo.wachtrij.length); } while (j === demo.nr);
        demo.nr = j; return;
      }
      if (demo.nr + 1 < demo.wachtrij.length) { demo.nr++; return; }
      if (demo.herhaal === 'context') { demo.nr = 0; return; }
      demo.wachtrij = demo.wachtrij.concat(demoVergelijkbaar(demo.wachtrij[demo.nr]));
      demo.nr = Math.min(demo.nr + 1, demo.wachtrij.length - 1);
    }

    // ===== PKCE-koppeling =====
    function willekeurig(n) {
      var a = new Uint8Array(n); crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]; }).join('');
    }
    function b64url(buf) {
      return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function koppel() {
      if (!instellingen.clientId) { meld('Vul eerst de Spotify Client ID in'); return; }
      if (!window.crypto || !crypto.subtle) { meld('Koppelen kan alleen via https'); return; }
      var verifier = willekeurig(64);
      bewaar('pkce', verifier);
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (hash) {
        location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
          client_id: instellingen.clientId, response_type: 'code', redirect_uri: terug,
          scope: SCOPES, code_challenge_method: 'S256', code_challenge: b64url(hash)
        });
      });
    }
    function tokenAanvraag(params) {
      params.client_id = instellingen.clientId;
      return fetch('https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params)
      }).then(function (r) {
        if (!r.ok) throw new Error('token ' + r.status);
        return r.json();
      }).then(function (d) {
        token = { toegang: d.access_token, ververs: d.refresh_token || (token && token.ververs), verloopt: Date.now() + (d.expires_in - 60) * 1000 };
        bewaar('spotifyToken', token);
        return token.toegang;
      });
    }
    function verwerkTerugkomst() {
      var q = new URLSearchParams(location.search);
      if (!q.get('code') && !q.get('error')) return Promise.resolve();
      history.replaceState(null, '', terug);
      if (q.get('error')) { meld('Spotify-koppeling geannuleerd'); return Promise.resolve(); }
      return tokenAanvraag({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: terug, code_verifier: lees('pkce', '') })
        .then(function () { voorbeeld = false; meld('Spotify gekoppeld'); werkVoorbeeldLabelBij(); })
        .catch(function () { meld('Koppelen mislukt, probeer opnieuw'); });
    }
    function geldigToken() {
      if (!token) return Promise.reject(new Error('geen token'));
      if (Date.now() < token.verloopt) return Promise.resolve(token.toegang);
      return tokenAanvraag({ grant_type: 'refresh_token', refresh_token: token.ververs });
    }
    function api(pad, opties) {
      opties = opties || {};
      return geldigToken().then(function (t) {
        return fetch('https://api.spotify.com/v1' + pad, {
          method: opties.method || 'GET',
          headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
          body: opties.body ? JSON.stringify(opties.body) : undefined
        });
      }).then(function (r) {
        if (r.status === 401) { token.verloopt = 0; }
        if (r.status === 204 || r.status === 202) return null;
        if (!r.ok) {
          return r.text().then(function (t) {
            var bericht = ''; try { bericht = (JSON.parse(t).error || {}).message || ''; } catch (x) { bericht = t.slice(0, 120); }
            var f = new Error('spotify ' + r.status + ' ' + bericht); f.status = r.status; f.bericht = bericht; f.pad = pad.split('?')[0];
            if (window.console) console.warn('Spotify', r.status, pad, bericht);
            throw f;
          });
        }
        var type = r.headers.get('content-type') || '';
        return type.indexOf('json') >= 0 ? r.json() : null;
      });
    }
    function niets() { return null; }

    // ===== huidige stand =====
    function huidig() {
      if (voorbeeld) {
        var n = demo.wachtrij[demo.nr];
        return { titel: n.naam, artiest: n.sub, hoes: n.beeld, duur: n.duur, pos: demo.pos, apparaat: demo.apparaat, speelt: demo.is_playing,
          volume: demo.volume, shuffle: demo.shuffle, herhaal: demo.herhaal, uri: n.uri };
      }
      if (staat && staat.item) {
        var beelden = (staat.item.album && staat.item.album.images) || staat.item.images || [];
        var pos = staat.progress_ms || 0;
        if (staat.is_playing) pos += Date.now() - staatTijd;
        return {
          titel: staat.item.name,
          artiest: (staat.item.artists || []).map(function (a) { return a.name; }).join(', ') || (staat.item.show && staat.item.show.name) || '',
          hoes: beelden[0] ? 'url("' + beelden[0].url + '")' : '',
          duur: staat.item.duration_ms || 0, pos: Math.min(pos, staat.item.duration_ms || pos),
          apparaat: staat.device ? staat.device.name : '', speelt: staat.is_playing,
          volume: staat.device ? staat.device.volume_percent : null,
          shuffle: !!staat.shuffle_state, herhaal: staat.repeat_state || 'off', uri: staat.item.uri
        };
      }
      return { titel: 'Niets aan het spelen', artiest: 'Tik op ▶ of zoek iets om te luisteren', hoes: '', duur: 0, pos: 0, apparaat: '', speelt: false,
        volume: null, shuffle: false, herhaal: 'off', uri: '' };
    }

    var laatsteHoes = null, laatsteUri = null;
    function teken() {
      var h = huidig();
      $('titel').textContent = h.titel;
      $('artiest').textContent = h.artiest;
      $('apparaat').textContent = h.apparaat || 'Niet verbonden';
      if (h.hoes !== laatsteHoes) {
        $('hoes-beeld').style.backgroundImage = h.hoes;
        laatsteHoes = h.hoes;
      }
      $('muziek').classList.toggle('speelt', !!h.speelt);
      $('shuffle').classList.toggle('aan', h.shuffle);
      $('shuffle').setAttribute('aria-pressed', h.shuffle);
      $('herhaal').classList.toggle('aan', h.herhaal !== 'off');
      $('herhaal').classList.toggle('een', h.herhaal === 'track');
      $('herhaal').setAttribute('aria-label', { off: 'Herhalen staat uit', context: 'Herhaalt alles', track: 'Herhaalt dit nummer' }[h.herhaal]);
      if (h.volume != null && !volumeBezig) zetVolumeBalk(h.volume);
      tekenVoortgang(h);
      tekenNuSpelend(h);
      if (h.uri !== laatsteUri) { laatsteUri = h.uri; markeerSpelend(); }
    }

    function tekenVoortgang(h) {
      var deel = h.duur ? Math.min(1, h.pos / h.duur) : 0;
      Array.prototype.forEach.call(document.querySelectorAll('.voortgang'), function (v) {
        v.classList.toggle('leeg-vg', !h.duur);
        v.querySelector('[data-vg]').style.width = (deel * 100).toFixed(2) + '%';
        v.querySelector('[data-vg-nu]').textContent = mss(h.pos);
        v.querySelector('[data-vg-rest]').textContent = '-' + mss(h.duur - h.pos);
      });
    }
    setInterval(function () {
      if (voorbeeld && demo.is_playing) {
        demo.pos += 1000;
        if (demo.pos >= demo.wachtrij[demo.nr].duur) { demoVolgende(true); teken(); return; }
      }
      tekenVoortgang(huidig());
    }, 1000);

    // groot "Nu aan het spelen" op de klok; bij een ander nummer vloeit het over
    var groot = { sleutel: null }, wisselTimer;
    function tekenNuSpelend(h) {
      html.classList.toggle('muziek-groot', !!h.speelt);
      if (!h.speelt) return;
      $('np-route').textContent = h.apparaat;
      var sleutel = h.titel + '|' + h.artiest + '|' + h.hoes;
      if (sleutel === groot.sleutel) return;
      var eerste = groot.sleutel === null;
      groot.sleutel = sleutel;
      function vul() {
        $('np-hoes').style.backgroundImage = h.hoes;
        $('np-titel').textContent = h.titel;
        $('np-artiest').textContent = h.artiest;
        $('np').classList.remove('wissel');
      }
      clearTimeout(wisselTimer);
      if (eerste) { vul(); return; }
      $('np').classList.add('wissel');
      wisselTimer = setTimeout(vul, 380);
    }

    function peil() {
      clearTimeout(peilTimer);
      if (voorbeeld) { teken(); return; }
      if (!token) return;
      api('/me/player?additional_types=episode').then(function (d) { staat = d; staatTijd = Date.now(); teken(); radioBijvullen(); })
        .catch(function () {})
        .then(function () { peilTimer = setTimeout(peil, opKlok() ? 15000 : 4000); });
    }
    // terug in beeld (bv. na de Spotify-app): meteen kijken wat er speelt i.p.v. wachten op de volgende ronde
    function weerInBeeld() { if (!document.hidden) peil(); }
    document.addEventListener('visibilitychange', weerInBeeld);
    window.addEventListener('pageshow', weerInBeeld);
    window.addEventListener('focus', weerInBeeld);

    // ===== bediening =====
    function kiesApparaat() {
      return api('/me/player/devices').then(function (d) {
        var lijst = (d && d.devices) || [];
        var voorkeur = lees('apparaat', '');
        var gekozen = lijst.filter(function (a) { return a.name === voorkeur; })[0] ||
          lijst.filter(function (a) { return /samsung|soundbar/i.test(a.name); })[0] ||
          lijst.filter(function (a) { return a.type === 'Speaker' || a.type === 'AVR' || a.type === 'TV'; })[0];
        if (!gekozen) throw new Error('geen speaker');
        bewaar('apparaat', gekozen.name);
        return gekozen.id;
      });
    }
    function fout(e) {
      if (e && e.message === 'geen speaker') meld('Soundbar niet gevonden. Staat hij aan?');
      else if (e && e.status === 403) meld('Spotify staat dit nu niet toe');
      else if (e && e.status === 404) meld('Niets gevonden om af te spelen');
      else meld('Spotify reageert niet, probeer het zo nog eens');
    }
    function naActie() { setTimeout(peil, 600); }

    // ===== speaker kiezen (tik op de speakernaam onder het volume) =====
    var SOORT = { Speaker: 'Speaker', AVR: 'Versterker', TV: 'Tv', Smartphone: 'Telefoon', Computer: 'Computer', Tablet: 'Tablet', CastAudio: 'Speaker', GameConsole: 'Spelcomputer' };
    var apparatenLijst = [];
    function toonApparaten() {
      var box = $('apparaten'), route = $('route').getBoundingClientRect();
      box.style.right = Math.max(8, innerWidth - route.right - 12) + 'px';
      box.style.bottom = (innerHeight - route.top + 10) + 'px';
      box.innerHTML = '<div class="app-kop">Speel af op</div><div class="ld-laden"><span></span><span></span><span></span></div>';
      box.hidden = false;
      var lijst = voorbeeld ? Promise.resolve(['Samsung Soundbar', 'iPhone van Arjan', 'iPhone van Joyce'].map(function (n, i) {
        return { id: 'demo' + i, name: n, type: i ? 'Smartphone' : 'Speaker', is_active: demo.apparaat === n };
      })) : api('/me/player/devices').then(function (d) { return (d && d.devices) || []; });
      lijst.then(function (l) {
        apparatenLijst = l;
        box.innerHTML = '<div class="app-kop">Speel af op</div>' + (l.length ? l.map(function (a, i) {
          return '<button data-i="' + i + '"' + (a.is_active ? ' class="actief"' : '') + '><svg><use href="#s-speaker"/></svg>' +
            '<span class="app-naam">' + esc(a.name) + '<small>' + esc(SOORT[a.type] || a.type || '') + '</small></span>' +
            (a.is_active ? '<span class="app-vink">✓</span>' : '') + '</button>';
        }).join('') : '<p class="app-leeg">Geen speakers gevonden.<br>Staat de soundbar aan?</p>');
      }, function () { box.innerHTML = '<div class="app-kop">Speel af op</div><p class="app-leeg">Dit lukt nu even niet.</p>'; });
    }
    function sluitApparaten() { $('apparaten').hidden = true; }
    function kiesSpeaker(a) {
      sluitApparaten();
      if (a.is_active) return;
      bewaar('apparaat', a.name);
      meld('Speelt nu op ' + a.name);
      if (voorbeeld) { demo.apparaat = a.name; teken(); return; }
      api('/me/player', { method: 'PUT', body: { device_ids: [a.id], play: staat ? !!staat.is_playing : true } }).then(naActie, fout);
    }
    $('route').addEventListener('click', function (e) {
      e.stopPropagation();
      if ($('apparaten').hidden) toonApparaten(); else sluitApparaten();
    });
    $('apparaten').addEventListener('click', function (e) {
      e.stopPropagation();
      var k = e.target.closest('button[data-i]');
      if (k) kiesSpeaker(apparatenLijst[+k.getAttribute('data-i')]);
    });
    document.addEventListener('click', function (e) { if (!$('apparaten').hidden && !e.target.closest('#apparaten')) sluitApparaten(); });

    function speelPauze() {
      if (voorbeeld) { demo.is_playing = !demo.is_playing; teken(); return; }
      if (staat && staat.device) {
        var speelt = staat.is_playing;
        staat.progress_ms = huidig().pos; staatTijd = Date.now(); staat.is_playing = !speelt; teken();
        api('/me/player/' + (speelt ? 'pause' : 'play'), { method: 'PUT' }).then(naActie, fout);
      } else {
        kiesApparaat().then(function (id) {
          return api('/me/player', { method: 'PUT', body: { device_ids: [id], play: true } });
        }).then(naActie, fout);
      }
    }
    function sla(richting) {
      if (voorbeeld) {
        if (richting > 0) demoVolgende(false);
        else if (demo.pos > 3000) demo.pos = 0;
        else { demo.nr = Math.max(0, demo.nr - 1); demo.pos = 0; }
        demo.is_playing = true; teken(); return;
      }
      api('/me/player/' + (richting > 0 ? 'next' : 'previous'), { method: 'POST' }).then(naActie, fout);
    }
    function shuffle() {
      var aan = !huidig().shuffle;
      meld(aan ? 'Shuffle aan' : 'Shuffle uit');
      if (voorbeeld) { demo.shuffle = aan; teken(); return; }
      if (staat) { staat.shuffle_state = aan; teken(); }
      api('/me/player/shuffle?state=' + aan, { method: 'PUT' }).then(naActie, fout);
    }
    function herhaal() {
      var volgende = { off: 'context', context: 'track', track: 'off' }[huidig().herhaal] || 'off';
      meld({ off: 'Herhalen uit', context: 'Herhaalt alles', track: 'Herhaalt dit nummer' }[volgende]);
      if (voorbeeld) { demo.herhaal = volgende; teken(); return; }
      if (staat) { staat.repeat_state = volgende; teken(); }
      api('/me/player/repeat?state=' + volgende, { method: 'PUT' }).then(naActie, fout);
    }
    var volumeTimer, volumeBezig = false;
    function zetVolumeBalk(v) { $('volume-vul').style.width = v + '%'; $('volume').setAttribute('aria-valuenow', v); }
    function volume(v) {
      zetVolumeBalk(v); volumeBezig = true;
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(function () {
        if (voorbeeld) { demo.volume = v; volumeBezig = false; return; }
        api('/me/player/volume?volume_percent=' + v, { method: 'PUT' })
          .catch(fout).then(function () { setTimeout(function () { volumeBezig = false; }, 1500); });
      }, 200);
    }

    // afspelen op de soundbar (of het apparaat dat al speelt)
    function speel(body) {
      var apparaat = staat && staat.device ? Promise.resolve(staat.device.id) : kiesApparaat();
      return apparaat.then(function (id) {
        return api('/me/player/play?device_id=' + encodeURIComponent(id), { method: 'PUT', body: body });
      }).then(naActie);
    }

    // ===== "daarna vergelijkbare nummers" =====
    // Spotify geeft zelfgebouwde apps geen aanbevelingen meer, dus het paneel stelt zelf een mix samen:
    // populaire nummers van dezelfde artiest + nummers uit hetzelfde genre, om en om. Raakt de mix op, dan vult hij bij.
    var radio = null;   // { uris: [...], bijgevuld: {} }
    function nummersVan(d) { return ((d && d.tracks && d.tracks.items) || (d && d.tracks) || []).filter(Boolean).map(function (t) { return nrm.nummer(t); }); }
    function bouwMix(n) {
      var artiest = n.artiestId ? api('/artists/' + n.artiestId).catch(niets) : Promise.resolve(null);
      return artiest.then(function (a) {
        var naam = (a && a.name) || n.artiestNaam || '';
        var genres = (a && a.genres) || [];
        // (top-tracks heeft Spotify in februari 2026 weggehaald, dus zoeken op artiest)
        var zelfde = api('/search?type=track&limit=10&market=NL&q=' + encodeURIComponent('artist:"' + naam + '"')).then(nummersVan).catch(function () { return []; });
        var soort = Promise.all(genres.slice(0, 2).map(function (g) {
          var vanaf = Math.floor(Math.random() * 4) * 10;
          return api('/search?type=track&limit=10&market=NL&offset=' + vanaf + '&q=' + encodeURIComponent('genre:"' + g + '"')).then(nummersVan).catch(function () { return []; });
        }));
        return Promise.all([zelfde, soort]).then(function (r) {
          var gezien = {}; gezien[n.uri] = 1; gezien[(n.naam || '').toLowerCase()] = 1;
          function uniek(x) { var k = (x.naam || '').toLowerCase(); if (gezien[x.uri] || gezien[k]) return false; gezien[x.uri] = gezien[k] = 1; return true; }
          var z = schud(r[0]).filter(uniek).slice(0, 4);
          var s = schud([].concat.apply([], r[1])).filter(uniek).slice(0, 16);
          return meng(z, s);
        });
      });
    }
    function speelMetVergelijkbaar(n) {
      if (voorbeeld) {
        demo.wachtrij = [n].concat(demoVergelijkbaar(n)); demo.nr = 0; demo.pos = 0; demo.is_playing = true; demo.context = null;
        teken(); meld('▶  ' + n.naam + ' · daarna vergelijkbare muziek'); return;
      }
      meld('▶  ' + n.naam);
      bouwMix(n).catch(function () { return []; }).then(function (mix) {
        var uris = [n.uri].concat(mix.map(function (x) { return x.uri; }));
        radio = { uris: uris, bijgevuld: {} };
        return speel({ uris: uris });
      }).then(function () { meld('▶  ' + n.naam + ' · daarna vergelijkbare muziek'); }, fout);
    }
    function radioBijvullen() {
      if (!radio || !staat || !staat.item) return;
      if (staat.context && staat.context.uri) { radio = null; return; }   // er is iets anders gestart
      var i = radio.uris.indexOf(staat.item.uri);
      if (i < 0 || i < radio.uris.length - 3 || radio.bijgevuld[staat.item.uri]) return;
      radio.bijgevuld[staat.item.uri] = 1;
      bouwMix(nrm.nummer(staat.item)).then(function (mix) {
        mix = mix.filter(function (x) { return radio && radio.uris.indexOf(x.uri) < 0; }).slice(0, 8);
        return mix.reduce(function (p, x) {
          return p.then(function () { radio && radio.uris.push(x.uri); return api('/me/player/queue?uri=' + encodeURIComponent(x.uri), { method: 'POST' }); });
        }, Promise.resolve());
      }).catch(function () {});
    }

    // ===== spotify-gegevens omzetten naar één vorm =====
    function plaatje(arr) { return arr && arr.length ? 'url("' + (arr[1] || arr[0]).url + '")' : ''; }
    function namen(arr) { return (arr || []).map(function (a) { return a.name; }).join(', '); }
    var nrm = {
      nummer: function (t, beeld) {
        return { soort: 'nummer', id: t.id, uri: t.uri, naam: t.name, sub: namen(t.artists), artiestId: t.artists && t.artists[0] && t.artists[0].id,
          artiestNaam: t.artists && t.artists[0] && t.artists[0].name, albumId: t.album && t.album.id, beeld: plaatje(t.album && t.album.images) || beeld || '', duur: t.duration_ms };
      },
      aflevering: function (e, beeld) {
        var d = e.release_date ? new Date(e.release_date) : null;
        return { soort: 'aflevering', id: e.id, uri: e.uri, naam: e.name, sub: d ? fmtDagKort.format(d) : '', beeld: plaatje(e.images) || beeld || '', duur: e.duration_ms };
      },
      artiest: function (a) { return { soort: 'artiest', id: a.id, uri: a.uri, naam: a.name, sub: 'Artiest', beeld: plaatje(a.images) }; },
      album: function (a) { return { soort: 'album', id: a.id, uri: a.uri, naam: a.name, sub: namen(a.artists) + (a.release_date ? ' · ' + a.release_date.slice(0, 4) : ''), beeld: plaatje(a.images) }; },
      lijst: function (l) { return { soort: 'lijst', id: l.id, uri: l.uri, naam: l.name, sub: (l.owner && l.owner.display_name) || 'Afspeellijst', beeld: plaatje(l.images) }; },
      podcast: function (s) { return { soort: 'podcast', id: s.id, uri: s.uri, naam: s.name, sub: s.publisher || 'Podcast', beeld: plaatje(s.images) }; }
    };
    function items(d, sleutel, f) { return ((d && d[sleutel] && d[sleutel].items) || []).filter(Boolean).map(f); }

    // ===== mixen, toppers en favoriete artiesten =====
    var thuisCache = null, mixCache = {}, mixInfo = {}, favorieten = [];
    function maakMixItem(a) {
      return { soort: 'mix', id: a.id, uri: 'mix:' + a.id, naam: a.naam + ' Mix', sub: 'Met ' + a.naam + ' en meer', beeld: a.beeld };
    }
    function zetFavorieten(lijst) {   // lijst: [{ id, naam, beeld, genres }]
      favorieten = lijst;
      lijst.forEach(function (a) { mixInfo[a.id] = a; });
      return {
        artiesten: lijst.map(function (a) { return { soort: 'artiest', id: a.id, uri: 'spotify:artist:' + a.id, naam: a.naam, sub: 'Artiest', beeld: a.beeld }; }),
        mixen: lijst.slice(0, 6).map(maakMixItem)
      };
    }
    // Favoriete artiesten en toppers: van Spotify ('top'), of anders zelf geteld uit recent en 'vind ik leuk'
    function extraThuis(r) {
      var top = ((r[3] && r[3].items) || []).map(function (a) { return { id: a.id, naam: a.name, beeld: plaatje(a.images), genres: a.genres || [] }; });
      var toppers = ((r[4] && r[4].items) || []).map(function (t) { return nrm.nummer(t); });
      var tel = {}, telNr = {}, nrs = {};
      ((r[0] && r[0].items) || []).forEach(function (it) {
        var t = it.track; if (!t) return;
        (t.artists || []).slice(0, 1).forEach(function (a) { tel[a.id] = (tel[a.id] || 0) + 2; });
        telNr[t.id] = (telNr[t.id] || 0) + 1; nrs[t.id] = t;
      });
      ((r[5] && r[5].items) || []).forEach(function (it) { var t = it.track; if (t && t.artists && t.artists[0]) tel[t.artists[0].id] = (tel[t.artists[0].id] || 0) + 1; });
      if (!toppers.length) toppers = Object.keys(telNr).sort(function (a, b) { return telNr[b] - telNr[a]; }).slice(0, 10).map(function (id) { return nrm.nummer(nrs[id]); });
      if (top.length) { var z = zetFavorieten(top); z.toppers = toppers; return Promise.resolve(z); }
      var ids = Object.keys(tel).sort(function (a, b) { return tel[b] - tel[a]; }).slice(0, 8);
      return Promise.all(ids.map(function (id) { return api('/artists/' + id).catch(niets); })).then(function (lijst) {
        var z = zetFavorieten(lijst.filter(Boolean).map(function (a) { return { id: a.id, naam: a.name, beeld: plaatje(a.images), genres: a.genres || [] }; }));
        z.toppers = toppers; return z;
      });
    }

    // ===== bron: dezelfde vragen, voor voorbeeld én echt =====
    var bron = {
      thuis: function () {
        if (voorbeeld) return Promise.resolve({
          recent: [albumVan('eagles'), D.lijsten[1], vind(D.artiesten, 'hazes'), D.podcasts[0], albumVan('fleetwood'), D.lijsten[6], vind(D.artiesten, 'blof')].filter(Boolean),
          lijsten: [{ soort: 'leuk', id: 'leuk', uri: 'leuk', naam: 'Nummers die je leuk vindt', sub: '30 nummers', beeld: 'linear-gradient(135deg, #450af5, #8e8ee5 55%, #c4efd9)' }].concat(D.lijsten),
          podcasts: D.podcasts,
          mixen: zetFavorieten(D.artiesten.slice(0, 6).map(function (a) { return { id: a.id, naam: a.naam, beeld: a.beeld, genres: [a.genre] }; })).mixen,
          artiesten: D.artiesten.slice(0, 8),
          toppers: Object.keys(TOP).slice(0, 5).map(function (k) { return TOP[k][0]; }).filter(Boolean),
          albums: D.albums.slice(0, 10)
        });
        if (thuisCache && Date.now() - thuisCache.t < 5 * 60 * 1000) return Promise.resolve(thuisCache.d);
        return Promise.all([
          api('/me/player/recently-played?limit=50').catch(niets),
          api('/me/playlists?limit=50').catch(niets),
          api('/me/shows?limit=20').catch(niets),
          api('/me/top/artists?limit=8&time_range=medium_term').catch(niets),
          api('/me/top/tracks?limit=10&time_range=short_term').catch(niets),
          api('/me/tracks?limit=50&market=NL').catch(niets),
          api('/me/albums?limit=20&market=NL').catch(niets)
        ]).then(function (r) {
          var eigen = items(r[1], 'items', function (l) { return l; }).map(nrm.lijst);
          // recent: waar het nummer vandaan kwam (afspeellijst, album, artiest), afspeellijsten voorop.
          // Losse nummers zonder lijst eromheen tellen alleen als er verder weinig is.
          var bronnen = [], gezien = {}, los = [];
          ((r[0] && r[0].items) || []).forEach(function (it) {
            var c = it.context, t = it.track;
            if (c && c.uri && /^spotify:(playlist|album|artist):/.test(c.uri)) {
              if (!gezien[c.uri]) { gezien[c.uri] = 1; bronnen.push(c.uri); }
            } else if (t && t.album && !gezien[t.album.uri]) { gezien[t.album.uri] = 1; los.push(nrm.album(t.album)); }
          });
          var albumsUitNummers = {};
          ((r[0] && r[0].items) || []).forEach(function (it) { if (it.track && it.track.album) albumsUitNummers[it.track.album.uri] = it.track.album; });
          return Promise.all(bronnen.slice(0, 16).map(function (uri) {
            var d = uri.split(':'), soort = d[1], id = d[2];
            if (soort === 'playlist') {
              var bekend = eigen.filter(function (l) { return l.uri === uri; })[0];
              return bekend ? Promise.resolve(bekend) : api('/playlists/' + id + '?fields=id,uri,name,images,owner(display_name)').then(nrm.lijst).catch(niets);
            }
            if (soort === 'album') return Promise.resolve(albumsUitNummers[uri] ? nrm.album(albumsUitNummers[uri]) : null);
            return api('/artists/' + id).then(nrm.artiest).catch(niets);
          })).then(function (opgehaald) {
            opgehaald = opgehaald.filter(Boolean);
            var recent = opgehaald.filter(function (x) { return x.soort === 'lijst'; })
              .concat(opgehaald.filter(function (x) { return x.soort !== 'lijst'; }));
            if (recent.length < 8) recent = recent.concat(los.slice(0, 8 - recent.length));
            return { recent: recent.slice(0, 12), r: r, eigen: eigen };
          });
        }).then(function (x) {
          var r = x.r, eigen = x.eigen;
          return extraThuis(r).then(function (extra) {
          var leuk = r[5] && r[5].total ? [{ soort: 'leuk', id: 'leuk', uri: 'leuk', naam: 'Nummers die je leuk vindt', sub: r[5].total + ' nummers',
            beeld: 'linear-gradient(135deg, #450af5, #8e8ee5 55%, #c4efd9)' }] : [];
          var d = {
            mixen: extra.mixen, toppers: extra.toppers, artiesten: extra.artiesten,
            albums: ((r[6] && r[6].items) || []).map(function (x) { return x.album && nrm.album(x.album); }).filter(Boolean),
            recent: x.recent,
            lijsten: leuk.concat(eigen),
            podcasts: ((r[2] && r[2].items) || []).map(function (x) { return nrm.podcast(x.show); })
          };
          thuisCache = { t: Date.now(), d: d };
          return d;
          });
        });
      },
      // zelfgemaakte mix rond één favoriete artiest (Spotify's eigen mixen zijn niet beschikbaar)
      mix: function (id) {
        if (mixCache[id]) return Promise.resolve(mixCache[id]);
        var a = mixInfo[id] || { id: id, naam: '', beeld: '', genres: [] };
        var item = maakMixItem(a);
        if (voorbeeld) {
          var anderen = D.artiesten.filter(function (x) { return x.id !== id && x.genre === (vind(D.artiesten, id) || {}).genre; }).slice(0, 2);
          var zelf = schud(topVan(id)).slice(0, 8), rest = schud([].concat.apply([], anderen.map(function (x) { return topVan(x.id).slice(0, 6); })));
          mixCache[id] = { item: item, nummers: meng(zelf, rest) };
          return Promise.resolve(mixCache[id]);
        }
        var anderen = favorieten.filter(function (f) { return f.id !== id; });
        var verwant = anderen.filter(function (f) { return (f.genres || []).some(function (g) { return (a.genres || []).indexOf(g) >= 0; }); });
        var kies = (verwant.length >= 2 ? verwant : verwant.concat(anderen.filter(function (f) { return verwant.indexOf(f) < 0; }))).slice(0, 3);
        function vanArtiest(naam) {
          return api('/search?type=track&limit=10&market=NL&q=' + encodeURIComponent('artist:"' + naam + '"')).then(nummersVan).catch(function () { return []; });
        }
        return Promise.all([vanArtiest(a.naam)].concat(kies.map(function (f) { return vanArtiest(f.naam); }))
          .concat((a.genres || []).slice(0, 1).map(function (g) {
            return api('/search?type=track&limit=10&market=NL&q=' + encodeURIComponent('genre:"' + g + '"')).then(nummersVan).catch(function () { return []; });
          }))).then(function (lijsten) {
          var gezien = {};
          function uniek(x) { var k = (x.naam || '').toLowerCase() + '|' + x.artiestId; if (gezien[x.uri] || gezien[k]) return false; gezien[x.uri] = gezien[k] = 1; return true; }
          var zelf = schud(lijsten[0]).filter(uniek).slice(0, 9);
          var rest = schud([].concat.apply([], lijsten.slice(1))).filter(uniek).slice(0, 16);
          mixCache[id] = { item: item, nummers: meng(zelf, rest) };
          return mixCache[id];
        });
      },
      leuk: function () {
        var item = { soort: 'leuk', id: 'leuk', uri: 'leuk', naam: 'Nummers die je leuk vindt', sub: '', beeld: 'linear-gradient(135deg, #450af5, #8e8ee5 55%, #c4efd9)' };
        if (voorbeeld) return Promise.resolve({ item: item, nummers: schud(D.nummers).slice(0, 30) });
        function pagina(vanaf, tot) {
          return api('/me/tracks?limit=50&market=NL&offset=' + vanaf).then(function (d) {
            var nieuw = ((d && d.items) || []).map(function (x) { return x.track && nrm.nummer(x.track); }).filter(Boolean);
            tot = tot.concat(nieuw);
            if (nieuw.length === 50 && tot.length < 200) return pagina(vanaf + 50, tot);
            item.aantal = (d && d.total) || tot.length; item.compleet = tot.length >= item.aantal;
            return tot;
          });
        }
        return pagina(0, []).then(function (n) { item.sub = (item.aantal || n.length) + ' nummers'; return { item: item, nummers: n }; });
      },
      zoek: function (q) {
        if (voorbeeld) {
          var w = q.toLowerCase();
          function past(t) { return t.toLowerCase().indexOf(w) >= 0; }
          var art = D.artiesten.filter(function (a) { return past(a.naam); });
          var artIds = art.map(function (a) { return a.id; });
          return Promise.resolve({
            nummers: (function () {
              var al = {}, uit = [];
              artIds.forEach(function (aid) { topVan(aid).forEach(function (n) { if (!al[n.artiestId + n.naam.toLowerCase()]) { al[n.artiestId + n.naam.toLowerCase()] = 1; uit.push(n); } }); });
              D.nummers.forEach(function (n) { if (past(n.naam) && !al[n.artiestId + n.naam.toLowerCase()]) { al[n.artiestId + n.naam.toLowerCase()] = 1; uit.push(n); } });
              return uit.slice(0, 8);
            })(),
            artiesten: art.length ? art : D.artiesten.filter(function (a) { return D.nummers.some(function (n) { return n.artiestId === a.id && past(n.naam); }); }),
            albums: D.albums.filter(function (a) { return past(a.naam) || artIds.indexOf(a.artiestId) >= 0; }),
            lijsten: D.lijsten.filter(function (l) { return past(l.naam) || l.nummers.some(function (n) { return artIds.indexOf(n.artiestId) >= 0; }); }).slice(0, 6),
            podcasts: D.podcasts.filter(function (p) { return past(p.naam) || past(p.sub); })
          });
        }
        var soorten = ['track', 'artist', 'album', 'playlist', 'show'], eersteFout = null;
        return Promise.all(soorten.map(function (t) {
          return api('/search?type=' + t + '&limit=10&market=NL&q=' + encodeURIComponent(q)).catch(function (e) { eersteFout = eersteFout || e; return null; });
        })).then(function (r) {
          if (r.every(function (x) { return !x; })) throw eersteFout;
          var d = {}; r.forEach(function (x) { if (x) for (var k in x) d[k] = x[k]; });
          return {
            nummers: items(d, 'tracks', function (t) { return nrm.nummer(t); }).slice(0, 8),
            artiesten: items(d, 'artists', nrm.artiest), albums: items(d, 'albums', nrm.album),
            lijsten: items(d, 'playlists', nrm.lijst), podcasts: items(d, 'shows', nrm.podcast)
          };
        });
      },
      artiest: function (id) {
        if (voorbeeld) {
          var a = vind(D.artiesten, id);
          return Promise.resolve({ item: a, nummers: topVan(id),
            albums: D.albums.filter(function (x) { return x.artiestId === id; }) });
        }
        return api('/artists/' + id).then(function (a) {
          var item = nrm.artiest(a);
          return Promise.all([
            api('/search?type=track&limit=10&market=NL&q=' + encodeURIComponent('artist:"' + a.name + '"')).then(nummersVan).catch(function () { return []; }),
            api('/artists/' + id + '/albums?include_groups=album,single,compilation&limit=10&market=NL').then(function (d) { return ((d && d.items) || []).map(nrm.album); }).catch(function () { return []; })
          ]).then(function (r) { return { item: item, nummers: r[0].slice(0, 10), albums: r[1] }; });
        });
      },
      album: function (id) {
        if (voorbeeld) { var a = vind(D.albums, id); return Promise.resolve({ item: a, nummers: a.nummers }); }
        return api('/albums/' + id + '?market=NL').then(function (a) {
          var item = nrm.album(a);
          return { item: item, nummers: ((a.tracks && a.tracks.items) || []).map(function (t) { var n = nrm.nummer(t, item.beeld); n.albumId = a.id; return n; }) };
        });
      },
      lijst: function (id) {
        if (voorbeeld) { var l = vind(D.lijsten, id); return Promise.resolve({ item: l, nummers: l.nummers }); }
        function alsNummers(rijen) { return rijen.map(function (r) { return r.track || r.item; }).filter(function (t) { return t && t.type === 'track'; }).map(function (t) { return nrm.nummer(t); }); }
        return api('/playlists/' + id + '?market=NL').then(function (l) {
          var item = nrm.lijst(l);
          var rijen = (l.tracks && l.tracks.items) || (l.items && l.items.items) || [];
          var totaal = (l.items && l.items.total) || (l.tracks && l.tracks.total) || 0;
          function pagina(vanaf, tot) {   // de rest ophalen, 50 per keer, tot hooguit 500 nummers
            if (tot.length && (!totaal || tot.length >= totaal || tot.length >= 500)) return Promise.resolve(tot);
            return api('/playlists/' + id + '/items?limit=50&offset=' + vanaf + '&market=NL').then(function (d) {
              var nieuw = (d && d.items) || [];
              if (d && d.total) totaal = d.total;
              if (!nieuw.length) return tot;
              return pagina(vanaf + nieuw.length, tot.concat(nieuw));
            }).catch(function () { return tot; });
          }
          return pagina(rijen.length, rijen).then(function (rijen) {
            var nummers = alsNummers(rijen);
            if (nummers.length) { item.aantal = totaal || nummers.length; item.compleet = nummers.length >= item.aantal; return { item: item, nummers: nummers }; }
            // Sinds 2026 laat Spotify bij lijsten van anderen de nummers niet meer zien.
            // Speelt deze lijst nu, dan tonen we wat er hierna komt (de wachtrij).
            if (!(staat && staat.context && staat.context.uri === item.uri)) return { item: item, nummers: [] };
            return api('/me/player/queue').then(function (q) {
              var t = [];
              if (q && q.currently_playing && q.currently_playing.type === 'track') t.push(q.currently_playing);
              ((q && q.queue) || []).forEach(function (x) { if (x && x.type === 'track') t.push(x); });
              return { item: item, nummers: t.map(function (x) { return nrm.nummer(x); }), viaWachtrij: true };
            }).catch(function () { return { item: item, nummers: [] }; });
          });
        });
      },
      podcast: function (id) {
        if (voorbeeld) { var p = vind(D.podcasts, id); return Promise.resolve({ item: p, nummers: p.afleveringen }); }
        return api('/shows/' + id + '?market=NL').then(function (s) {
          var item = nrm.podcast(s);
          return { item: item, nummers: ((s.episodes && s.episodes.items) || []).filter(Boolean).map(function (e) { return nrm.aflevering(e, item.beeld); }) };
        });
      }
    };

    // ===== de muzieklade =====
    var stapel = [{ soort: 'thuis' }];
    var reg = [];      // alles wat in de lade staat, op nummer, voor de klikken
    var beurt = 0;
    function r(x) { reg.push(x); return reg.length - 1; }
    function achtergrond(b) { return b ? ' style="background-image:' + esc(b) + '"' : ''; }
    function hoes(x, klasse) {
      var leeg = !x.beeld ? '<span class="hoes-leeg">' + esc(x.letters || (x.soort === 'artiest' ? (x.naam || '?').charAt(0) : '♪')) + '</span>' :
        (x.letters ? '<span class="hoes-letters">' + esc(x.letters) + '</span>' : '');
      if (x.soort === 'mix') return '<span class="' + klasse + ' mixhoes"' + achtergrond(x.beeld) + '><span class="mix-label">Mix</span></span>';
      if (x.collage) return '<span class="' + klasse + ' collage"' + achtergrond(x.collage.join(',')) + '></span>';
      return '<span class="' + klasse + (x.soort === 'artiest' ? ' rond' : '') + '"' + achtergrond(x.beeld) + '>' + leeg + '</span>';
    }
    function tegel(x) {
      return '<button class="tegel" data-r="' + r(x) + '" data-a="open">' + hoes(x, 'tegel-hoes') +
        '<span class="tegel-naam">' + esc(x.naam) + '</span><span class="tegel-sub">' + esc(x.sub || '') + '</span></button>';
    }
    function sectie(titel, inhoud, raster) {
      if (!inhoud) return '';
      return '<section class="ld-sectie"><h3>' + esc(titel) + '</h3><div class="' + (raster ? 'ld-raster' : 'ld-rij') + '">' + inhoud + '</div></section>';
    }
    function nummerRijen(nummers, ctx, metHoes) {
      var c = r(ctx || null);
      return '<div class="ld-nummers">' + nummers.map(function (n, i) {
        return '<div class="ld-nummer" data-r="' + r(n) + '" data-c="' + c + '" data-uri="' + esc(n.uri) + '">' +
          '<button class="ld-nummer-hoofd" data-a="speel">' +
          (metHoes ? hoes(n, 'ld-nummer-hoes') : '<span class="ld-nr">' + (i + 1) + '</span>') +
          '<span class="ld-nummer-tekst"><span class="ld-nummer-naam">' + esc(n.naam) + '</span><span class="ld-nummer-sub">' + esc(n.sub || '') + '</span></span>' +
          '<span class="ld-duur">' + (n.duur ? mss(n.duur) : '') + '</span></button>' +
          '<button class="ld-meer" data-a="menu" aria-label="Meer"><svg><use href="#s-meer"/></svg></button></div>';
      }).join('') + '</div>';
    }
    function kop(x, extra) {
      var c = r(x);
      return '<header class="ld-kop">' + hoes(x, 'ld-kop-hoes') + '<div class="ld-kop-tekst"><span class="ld-soort">' +
        { artiest: 'Artiest', album: 'Album', lijst: 'Afspeellijst', podcast: 'Podcast', mix: 'Mix voor jou', leuk: 'Afspeellijst' }[x.soort] + '</span><h2>' + esc(x.naam) + '</h2>' +
        (x.soort !== 'artiest' ? '<p>' + esc(x.sub || '') + '</p>' : '') + (x.info ? '<p class="ld-info">' + esc(x.info) + '</p>' : '') +
        '<div class="ld-acties"><button class="ld-knop" data-r="' + c + '" data-a="speel-alles"><svg><use href="#s-speel"/></svg>' + (x.soort === 'podcast' ? 'Nieuwste' : 'Speel') + '</button>' +
        (x.soort !== 'podcast' ? '<button class="ld-knop zacht" data-r="' + c + '" data-a="shuffle-alles"><svg><use href="#s-shuffle"/></svg>Shuffle</button>' : '') +
        '</div></div>' + (extra || '') + '</header>';
    }
    function laden() { $('lade-inhoud').innerHTML = '<div class="ld-laden"><span></span><span></span><span></span></div>'; }

    function tekenLade() {
      var v = stapel[stapel.length - 1], mijn = ++beurt;
      reg = []; sluitMenu();
      $('lade-terug').hidden = stapel.length < 2;
      $('lade-titel').textContent = { thuis: 'Muziek', zoek: 'Zoeken' }[v.soort] || '';
      $('lade-titel').hidden = !{ thuis: 1, zoek: 1 }[v.soort];
      var inh = $('lade-inhoud');
      var wacht;
      if (v.soort === 'thuis') wacht = bron.thuis().then(function (d) {
        var toppersCtx = { soort: 'toppers', item: { soort: 'toppers', uri: 'toppers', naam: 'Je toppers' }, nummers: d.toppers || [] };
        return sectie('Recent gespeeld', d.recent.map(tegel).join('')) +
          sectie('Mixen voor jou', (d.mixen || []).map(tegel).join('')) +
          ((d.toppers || []).length ? '<section class="ld-sectie"><h3>Je toppers</h3>' + nummerRijen(d.toppers.slice(0, 5), toppersCtx, true) + '</section>' : '') +
          sectie('Favoriete artiesten', (d.artiesten || []).map(tegel).join('')) +
          sectie('Afspeellijsten', d.lijsten.map(tegel).join(''), true) +
          sectie('Opgeslagen albums', (d.albums || []).map(tegel).join('')) +
          sectie('Podcasts', d.podcasts.map(tegel).join('')) ||
          '<div class="ld-leeg">Nog niets gevonden in Spotify.<br>Zoek hierboven een artiest of nummer.</div>';
      });
      else if (v.soort === 'zoek') wacht = bron.zoek(v.q).then(function (d) {
        var h = sectie('Artiesten', d.artiesten.map(tegel).join('')) +
          (d.nummers.length ? '<section class="ld-sectie"><h3>Nummers</h3>' + nummerRijen(d.nummers, null, true) + '</section>' : '') +
          sectie('Albums', d.albums.map(tegel).join('')) +
          sectie('Afspeellijsten', d.lijsten.map(tegel).join('')) +
          sectie('Podcasts', d.podcasts.map(tegel).join(''));
        return h || '<div class="ld-leeg">Niets gevonden voor “' + esc(v.q) + '”.</div>';
      });
      else wacht = bron[v.soort](v.id).then(function (d) {
        v.item = d.item; v.nummers = d.nummers;
        if (v.soort === 'artiest') return kop(d.item) +
          '<section class="ld-sectie"><h3>Populair</h3>' + nummerRijen(d.nummers, { soort: 'artiest', item: d.item, nummers: d.nummers }, true) + '</section>' +
          sectie('Albums', d.albums.map(tegel).join(''));
        var ctx = { soort: v.soort, item: d.item, nummers: d.nummers };
        if (/^(lijst|album|mix|leuk)$/.test(v.soort) && d.nummers.length && !d.viaWachtrij) {
          var ms = d.nummers.reduce(function (t, n) { return t + (n.duur || 0); }, 0), aantal = d.item.aantal || d.nummers.length;
          var min = Math.round(ms / 60000), u = Math.floor(min / 60);
          var duur = u ? u + ' u ' + (min % 60) + ' min' : min + ' min';
          d.item.info = aantal + (aantal === 1 ? ' nummer' : ' nummers') + (ms ? ' · ' + (d.item.compleet === false ? 'ruim ' : '') + duur : '');
        }
        if (d.viaWachtrij) return kop(d.item) + '<section class="ld-sectie"><h3>Nu en hierna</h3>' + nummerRijen(d.nummers, ctx, true) + '</section>';
        return kop(d.item) + (d.nummers.length ? nummerRijen(d.nummers, ctx, v.soort !== 'album') :
          '<div class="ld-leeg">' + (v.soort === 'lijst' ? 'Spotify laat de nummers van deze lijst niet zien.<br>Tik op Speel of Shuffle, dan zie je wat er komt.' :
            'Spotify laat de inhoud hiervan niet zien.<br>Met Speel hoor je hem wel.') + '</div>');
      });
      laden();
      inh.scrollTop = 0;
      wacht.then(function (h) {
        if (mijn !== beurt) return;
        inh.innerHTML = h; inh.scrollTop = v.scroll || 0; markeerSpelend();
      }, function (e) {
        if (mijn !== beurt) return;
        inh.innerHTML = '<div class="ld-leeg">' + (e && e.status === 403 ? 'Spotify geeft hier geen toegang toe.' : e && e.status === 429 ? 'Even te veel verzoeken, probeer het zo opnieuw.' : 'Dit lukt nu even niet.') +
          (e && e.status ? '<small class="ld-fout">' + esc(e.status + ' · ' + (e.pad || '') + (e.bericht ? ' · ' + e.bericht : '')) + '</small>' : '') + '</div>';
      });
    }
    function markeerSpelend() {
      var uri = huidig().uri;
      Array.prototype.forEach.call(document.querySelectorAll('.ld-nummer'), function (el) { el.classList.toggle('speelt-nu', el.getAttribute('data-uri') === uri); });
    }
    function open(x) {
      if (x.soort === 'nummer' || x.soort === 'aflevering') return;
      stapel[stapel.length - 1].scroll = $('lade-inhoud').scrollTop;
      stapel.push({ soort: x.soort, id: x.id });
      tekenLade();
    }
    function terugInLade() {
      if (stapel.length < 2) return;
      var weg = stapel.pop();
      if (weg.soort === 'zoek') { $('zoek').value = ''; $('zoek-wis').hidden = true; getypt = ''; }
      tekenLade();
    }

    // afspelen vanuit de lade
    function speelNummer(n, ctx) {
      if (voorbeeld) {
        if (ctx && ctx.nummers) { demo.wachtrij = ctx.nummers.slice(); demo.nr = Math.max(0, demo.wachtrij.indexOf(n)); demo.context = ctx.item; }
        else { speelMetVergelijkbaar(n); return; }
        demo.pos = 0; demo.is_playing = true; teken(); meld('▶  ' + n.naam); return;
      }
      if (!ctx) { speelMetVergelijkbaar(n); return; }
      radio = null;
      var body = /^(artiest|mix|leuk|toppers)$/.test(ctx.soort) ? { uris: ctx.nummers.slice(0, 100).map(function (x) { return x.uri; }), offset: { uri: n.uri } } :
        { context_uri: ctx.item.uri, offset: { uri: n.uri } };
      meld('▶  ' + n.naam);
      speel(body).catch(fout);
    }
    function speelAlles(x, gemengd) {
      var v = stapel[stapel.length - 1];
      var nummers = v.item === x ? v.nummers || [] : [];
      if (voorbeeld) {
        if (!nummers.length && x.nummers) nummers = x.nummers;
        if (!nummers.length) return;
        demo.wachtrij = nummers.slice(); demo.shuffle = !!gemengd;
        demo.nr = gemengd ? Math.floor(Math.random() * nummers.length) : 0; demo.pos = 0; demo.is_playing = true; demo.context = x;
        teken(); meld((gemengd ? '⤨  ' : '▶  ') + x.naam); return;
      }
      radio = null;
      var body = /^(artiest|mix|leuk)$/.test(x.soort) ? { uris: nummers.slice(0, 100).map(function (n) { return n.uri; }) } :
        x.soort === 'podcast' && nummers[0] ? { uris: [nummers[0].uri] } : { context_uri: x.uri };
      meld((gemengd ? '⤨  ' : '▶  ') + x.naam);
      var p = gemengd ? api('/me/player/shuffle?state=true', { method: 'PUT' }).catch(niets) : Promise.resolve();
      p.then(function () { return speel(body); }).then(function () {
        // lijst zonder zichtbare nummers: na het starten de wachtrij laten zien
        if (x.soort !== 'lijst' || nummers.length) return;
        setTimeout(function () {
          api('/me/player?additional_types=episode').then(function (d) {
            staat = d; staatTijd = Date.now();
            var t = stapel[stapel.length - 1];
            if (t.soort === 'lijst' && t.id === x.id && document.documentElement.classList.contains('lade-open')) tekenLade();
          }).catch(niets);
        }, 1500);
      }).catch(fout);
    }
    function speelItem(x) {   // tik op een tegel speelt niet meteen; die opent. Afspeellijsten op thuis: ook openen.
      open(x);
    }
    function inWachtrij(n) {
      if (voorbeeld) { demo.wachtrij.splice(demo.nr + 1, 0, n); meld('Speelt hierna: ' + n.naam); return; }
      api('/me/player/queue?uri=' + encodeURIComponent(n.uri), { method: 'POST' })
        .then(function () { if (radio) radio.uris.splice(radio.uris.indexOf(huidig().uri) + 1, 0, n.uri); meld('Speelt hierna: ' + n.naam); }, fout);
    }

    // menu bij ⋯
    var menuNummer = null;
    function sluitMenu() { $('ld-menu').hidden = true; menuNummer = null; }
    function toonMenu(n, knop) {
      menuNummer = n;
      var m = $('ld-menu'), lade = $('lade').getBoundingClientRect(), k = knop.getBoundingClientRect();
      $('menu-artiest').hidden = !n.artiestId;
      $('menu-album').hidden = !n.albumId;
      m.hidden = false;
      var hoog = m.offsetHeight, boven = k.bottom - lade.top + 6;
      if (boven + hoog > lade.height - 10) boven = k.top - lade.top - hoog - 6;
      m.style.top = Math.max(10, boven) + 'px';
      m.style.right = Math.max(10, lade.right - k.right) + 'px';
    }
    $('ld-menu').addEventListener('click', function (e) {
      e.stopPropagation();
      var a = e.target.closest('[data-m]'); if (!a || !menuNummer) return;
      var n = menuNummer, soort = a.getAttribute('data-m'); sluitMenu();
      if (soort === 'hierna') inWachtrij(n);
      else if (soort === 'artiest') open({ soort: 'artiest', id: n.artiestId });
      else if (soort === 'album') open({ soort: 'album', id: n.albumId });
    });

    $('lade-inhoud').addEventListener('click', function (e) {
      e.stopPropagation();   // de inhoud wordt zo vervangen; de klik mag de lade niet dichtdoen
      var knop = e.target.closest('[data-a]'); if (!knop) return;
      var a = knop.getAttribute('data-a'), houder = knop.closest('[data-r]');
      var x = houder ? reg[+houder.getAttribute('data-r')] : null;
      if (a !== 'menu') sluitMenu();
      if (!x) return;
      if (a === 'open') speelItem(x);
      else if (a === 'speel') speelNummer(x, reg[+houder.getAttribute('data-c')]);
      else if (a === 'menu') { if (menuNummer === x) sluitMenu(); else toonMenu(x, knop); }
      else if (a === 'speel-alles') speelAlles(x, false);
      else if (a === 'shuffle-alles') speelAlles(x, true);
    });
    $('lade-inhoud').addEventListener('scroll', sluitMenu, { passive: true });
    $('lade-terug').addEventListener('click', terugInLade);

    // zoeken: tijdens het typen, na een korte pauze
    var zoekTimer;
    function zoekNu(q) {
      q = q.trim();
      $('zoek-wis').hidden = !$('zoek').value;
      if (q.length < 2) { if (stapel[stapel.length - 1].soort !== 'thuis' || stapel.length > 1) { stapel = [{ soort: 'thuis' }]; tekenLade(); } return; }
      stapel = [{ soort: 'thuis' }, { soort: 'zoek', q: q }];
      tekenLade();
    }
    $('zoek').addEventListener('input', function () {
      var q = this.value; $('zoek-wis').hidden = !q;
      clearTimeout(zoekTimer); zoekTimer = setTimeout(function () { zoekNu(q); }, 400);
    });
    $('zoek').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(zoekTimer); zoekNu(this.value); this.blur(); }   // toetsenbord weg, resultaten in beeld
    });
    $('zoek-wis').addEventListener('click', function () { $('zoek').value = ''; zoekNu(''); $('zoek').focus(); });

    function toonLade() {
      if (stapel.length === 1) tekenLade();
    }
    // voor de rondleiding: typt een zoekopdracht en opent eventueel de eerste artiest
    var typTimer, getypt = '';
    function zetLade(o) {
      clearTimeout(typTimer);
      var q = o.zoek || '';
      if (q !== getypt) {
        getypt = q;
        if (!q) { $('zoek').value = ''; zoekNu(''); }
        else {
          var i = 0; $('zoek').value = '';
          (function typ() {
            $('zoek').value = q.slice(0, ++i); $('zoek-wis').hidden = false;
            if (i < q.length) typTimer = setTimeout(typ, 110);
            else { zoekNu(q); if (o.artiest) typTimer = setTimeout(function () { openEerste(); }, 700); }
          })();
          return;
        }
      }
      var top = stapel[stapel.length - 1];
      if (o.artiest && top.soort === 'zoek') openEerste();
      else if (!o.artiest && top.soort === 'artiest') terugInLade();
    }
    function openEerste() {
      var t = document.querySelector('#lade-inhoud .tegel-hoes.rond');
      var knop = t && t.closest('[data-r]');
      if (knop) open(reg[+knop.getAttribute('data-r')]);
    }

    return {
      start: function () { verwerkTerugkomst().then(peil); },
      peil: peil, koppel: koppel, speelPauze: speelPauze, sla: sla, volume: volume, shuffle: shuffle, herhaal: herhaal,
      toonLade: toonLade, zetLade: zetLade, sluitMenu: sluitMenu,
      isVoorbeeld: function () { return voorbeeld; },
      zetVoorbeeldSpeelt: function (aan) { if (voorbeeld && demo.is_playing !== aan) { demo.is_playing = aan; teken(); } },
      gekoppeld: function () { return !!token; },
      // sleutel die via de telefoon is binnengekomen (zie koppel.html)
      zetToken: function (d) {
        token = { toegang: d.access_token, ververs: d.refresh_token, verloopt: Date.now() + ((d.expires_in || 3600) - 60) * 1000 };
        bewaar('spotifyToken', token);
      }
    };
  })();

  $('speel').addEventListener('click', spotify.speelPauze);
  $('vorige').addEventListener('click', function () { spotify.sla(-1); });
  $('volgende').addEventListener('click', function () { spotify.sla(1); });
  $('shuffle').addEventListener('click', spotify.shuffle);
  $('herhaal').addEventListener('click', spotify.herhaal);

  // volume: slepen over de capsule, zoals in iOS
  (function () {
    var schuif = $('volume'), baan = $('volume-baan'), actief = null;
    function waarde(e) {
      var r = baan.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100);
    }
    schuif.addEventListener('pointerdown', function (e) {
      actief = e.pointerId; schuif.classList.add('vast');
      try { schuif.setPointerCapture(e.pointerId); } catch (x) {}
      spotify.volume(waarde(e)); e.preventDefault();
    });
    schuif.addEventListener('pointermove', function (e) { if (actief === e.pointerId) spotify.volume(waarde(e)); });
    function los(e) { if (actief === e.pointerId) { actief = null; schuif.classList.remove('vast'); } }
    schuif.addEventListener('pointerup', los);
    schuif.addEventListener('pointercancel', los);
  })();

  // ---------- lade met afspeellijsten ----------
  function ladeIsOpen() { return html.classList.contains('lade-open'); }
  // De lade mag het hele scherm gebruiken: de muziekkaart overspant dan alle rijen.
  // De rijhoogtes worden eerst vastgezet, zodat klok, weer en agenda niet verspringen terwijl ze vervagen.
  var ruimTimer;
  function ladeRuimte(aan) {
    clearTimeout(ruimTimer);
    var p = $('paneel');
    if (aan) {
      if (html.classList.contains('lade-ruim')) return;
      p.style.gridTemplateRows = getComputedStyle(p).gridTemplateRows;
      html.classList.add('lade-ruim');
    } else {
      html.classList.remove('lade-ruim'); p.style.gridTemplateRows = '';
    }
  }
  function ladeOpen() {
    if (html.classList.contains('geen-muziek')) return;
    if (ladeIsOpen()) return;
    agendaDicht();
    ladeRuimte(true);
    html.classList.add('lade-open');
    spotify.toonLade();
  }
  function ladeDicht() {
    html.classList.remove('lade-open'); spotify.sluitMenu();
    ruimTimer = setTimeout(function () { if (!ladeIsOpen() && !html.classList.contains('sleept')) ladeRuimte(false); }, 750); var z = $('zoek'); if (document.activeElement === z) z.blur(); }
  var gesleept = false;
  $('muziek').addEventListener('click', function (e) {
    if (gesleept || !document.contains(e.target)) return;
    if (e.target.closest('.knoppen, .volume, .muziek-lade')) return;
    if (ladeIsOpen()) ladeDicht(); else ladeOpen();
  });
  $('lade-dicht').addEventListener('click', ladeDicht);
  $('paneel').addEventListener('click', function (e) {
    if (!gesleept && ladeIsOpen() && document.contains(e.target) && !e.target.closest('#muziek')) ladeDicht();
  });
  // tik op de klok-wijzerplaat → naar het overzicht
  $('klok-gezicht').addEventListener('click', function () { if (!gesleept) gaNaar(false); });

  // ---------- vegen en slepen ----------
  // Horizontaal vegen: tussen klok en overzicht. Verticaal op de muziekbalk: de lade.
  // Alles volgt de vinger, met elastiek voorbij de rand, en klikt bij loslaten op zijn plek.
  (function () {
    var pager = $('pager'), lade = $('lade');
    var g = null;
    function rem() { return parseFloat(getComputedStyle(html).fontSize); }
    function ladeMax() { return window.innerHeight - 12.6 * rem(); }
    var vervagen = ['.klok-blok', '.weer-widget', '.agenda'].map(function (s) { return document.querySelector(s); });

    document.addEventListener('pointerdown', function (e) {
      if (!$('instellingen').hidden) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.volume, input, .ld-menu')) return;
      var inLade = !!e.target.closest('.lade-inhoud');
      var inMuziek = !!e.target.closest('#muziek') && !inLade && !e.target.closest('.knoppen, #lade-dicht, .zoekveld, #lade-terug');
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: e.timeStamp,
        v: 0, soort: null, inMuziek: inMuziek, inLijsten: inLade };
    });
    document.addEventListener('pointermove', function (e) {
      if (!g || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.soort) {
        if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
        if (Math.abs(dx) > Math.abs(dy) && !ladeIsOpen() && !agendaIsOpen() && !g.inLijsten) g.soort = 'pagina';
        else if (Math.abs(dy) >= Math.abs(dx) && g.inMuziek && !opKlok() && !html.classList.contains('geen-muziek')) g.soort = 'lade';
        else { g.soort = 'niets'; return; }
        html.classList.add('sleept');
        if (g.soort === 'lade') { agendaDicht(); ladeRuimte(true); g.max = ladeMax(); g.h0 = ladeIsOpen() ? g.max : 0; if (!ladeIsOpen()) spotify.toonLade(); }
        if (g.soort === 'pagina') { g.w = window.innerWidth; g.x0p = opKlok() ? 0 : -g.w; }
      }
      if (g.soort === 'niets') return;
      var dt = e.timeStamp - g.lt;
      if (g.soort === 'pagina') {
        var x = g.x0p + dx;
        if (x > 0) x *= 0.25;
        if (x < -g.w) x = -g.w + (x + g.w) * 0.25;
        pager.style.transform = 'translateX(' + x + 'px)';
        if (dt > 0) g.v = 0.8 * ((e.clientX - g.lx) / dt) + 0.2 * g.v;
        g.pos = x;
      } else {
        var h = g.h0 - dy;
        if (h > g.max) h = g.max + (h - g.max) * 0.25;
        if (h < 0) h *= 0.25;
        h = Math.max(0, h);
        lade.style.height = h + 'px';
        lade.style.opacity = Math.min(1, h / (g.max * 0.25));
        var rest = String(Math.max(0, 1 - h / (g.max * 0.6)));
        vervagen.forEach(function (el) { el.style.opacity = rest; });
        if (dt > 0) g.v = 0.8 * ((g.ly - e.clientY) / dt) + 0.2 * g.v;
        g.pos = h;
      }
      g.lx = e.clientX; g.ly = e.clientY; g.lt = e.timeStamp;
      e.preventDefault();
    }, { passive: false });
    function los(e) {
      if (!g || e.pointerId !== g.id) return;
      var b = g; g = null;
      if (!b.soort || b.soort === 'niets') { html.classList.remove('sleept'); return; }
      gesleept = true; setTimeout(function () { gesleept = false; }, 350);
      html.classList.remove('sleept');
      if (b.soort === 'pagina') {
        var naarKlok = b.v > 0.35 ? true : b.v < -0.35 ? false : b.pos > -b.w / 2;
        pager.style.transform = '';
        if (naarKlok !== opKlok()) gaNaar(naarKlok);
      } else {
        var open = b.v > 0.35 ? true : b.v < -0.35 ? false : b.pos > b.max * 0.4;
        if (open) { if (!ladeIsOpen()) html.classList.add('lade-open'); } else ladeDicht();
        lade.style.height = ''; lade.style.opacity = '';
        vervagen.forEach(function (el) { el.style.opacity = ''; });
      }
    }
    document.addEventListener('pointerup', los);
    document.addEventListener('pointercancel', los);
  })();

  // ---------- instellingen ----------
  Array.prototype.forEach.call(document.querySelectorAll('.blad'), function (blad) {
    blad.addEventListener('click', function (e) {
      if (e.target === blad || e.target.hasAttribute('data-sluit')) blad.hidden = true;
    });
  });
  function openInstellingen() {
    $('in-plaats').value = instellingen.plaats.naam;
    $('st-leden').textContent = leden.length ? leden.map(function (l) { return l.naam; }).join(', ') : 'Nog niet ingesteld';
    var gekoppeld = spotify.gekoppeld();
    $('spotify-status').textContent = gekoppeld ? 'Gekoppeld' : 'Niet gekoppeld';
    $('spotify-status').classList.toggle('goed', gekoppeld);
    $('spotify-koppel').textContent = gekoppeld ? 'Opnieuw' : 'Koppel';
    $('in-code').value = lees('code', '');
    var met = agendaSoorten().filter(function (w) { return linksVan(agendaLinks[w]).length; })
      .map(function (w) { return w === 'samen' ? 'Samen' : naamVan(w); });
    $('ag-status').textContent = !met.length ? 'Niet gekoppeld' : agendaEcht ? met.join(', ') : 'Lukt nog niet';
    $('ag-status').classList.toggle('goed', !!met.length && agendaEcht);
    $('wis-alles').textContent = 'Alles wissen…'; wisKlaar = false;
    $('instellingen').hidden = false;
  }
  var wisKlaar = false;
  $('wis-alles').addEventListener('click', function () {
    if (!wisKlaar) { wisKlaar = true; $('wis-alles').textContent = 'Tik nogmaals: alles wissen'; return; }
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('paneel.') === 0) localStorage.removeItem(k); }); } catch (e) {}
    location.href = location.pathname;
  });
  // instellingen achter een code (als die is ingesteld)
  function vraagCode(daarna) {
    if (typeof daarna !== 'function') daarna = openInstellingen;
    var code = lees('code', '');
    if (!code) { daarna(); return; }
    var invoer = '';
    function teken() {
      var h = '';
      for (var i = 0; i < code.length; i++) h += '<i class="' + (i < invoer.length ? 'vol' : '') + '"></i>';
      $('code-stippen').innerHTML = h;
    }
    teken();
    $('code-toetsen').onclick = function (e) {
      var k = e.target.closest('[data-c]'); if (!k) return;
      var c = k.getAttribute('data-c');
      if (c === 'wis') invoer = invoer.slice(0, -1);
      else if (invoer.length < code.length) invoer += c;
      teken();
      if (invoer.length === code.length) {
        if (invoer === code) { setTimeout(function () { $('codeblad').hidden = true; daarna(); }, 150); }
        else {
          var st = $('code-stippen'); st.classList.remove('fout'); void st.offsetWidth; st.classList.add('fout');
          setTimeout(function () { invoer = ''; teken(); }, 450);
        }
      }
    };
    $('codeblad').hidden = false;
  }
  // ---------- koppelen met de telefoon (QR-code) ----------
  // Het paneel maakt een tijdelijk 'koppelkastje' bij het doorgeefluik en toont een QR-code.
  // De telefoon (koppel.html) logt in bij Spotify en plakt agenda-links; het paneel haalt ze op.
  var KASTJE = 'https://homeview-agenda.timev.workers.dev/koppel/';
  var koppel = null;
  function laadQr() {
    if (window.QRCode) return Promise.resolve();
    return new Promise(function (ok, nee) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = ok; s.onerror = nee; document.head.appendChild(s);
    });
  }
  function koppelStatus() {
    var rijen = [['Huishouden' + (leden.length ? ': ' + leden.map(function (l) { return l.naam; }).join(', ') : ''), leden.length > 0],
      ['Muziek (Spotify)', spotify.gekoppeld()]];
    leden.forEach(function (l) { rijen.push(['Agenda ' + l.naam, !!linksVan(agendaLinks[l.id]).length]); });
    if (linksVan(agendaLinks.samen).length) rijen.push(['Gedeelde agenda', true]);
    $('koppel-status').innerHTML = rijen.map(function (r) {
      return '<li class="' + (r[1] ? 'klaar' : '') + '"><span class="ks-teken">' + (r[1] ? '✓' : '') + '</span>' + esc(r[0]) + '</li>';
    }).join('');
  }
  function ingesteld() { return leden.length > 0 || spotify.gekoppeld() || heeftAgendaLinks(); }
  function openKoppelen(welkom) {
    welkom = welkom === true;
    $('instellingen').hidden = true;
    $('koppelblad').classList.toggle('welkom', welkom);
    $('koppel-titel').textContent = welkom ? 'Welkom bij HomeView' : 'Instellen met je telefoon';
    $('koppel-klaar').textContent = welkom ? 'Later' : 'Klaar';
    var tekens = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', a = new Uint8Array(32), code = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) code += tekens.charAt(a[i] % tekens.length);
    var g = new Uint8Array(32), geheim = '';   // ophaalgeheim: blijft op het paneel, staat niet in de QR-code
    crypto.getRandomValues(g);
    for (var j = 0; j < g.length; j++) geheim += tekens.charAt(g[j] % tekens.length) + (g[j] % 10);
    if (koppel) clearInterval(koppel.timer);
    koppel = { code: code, geheim: geheim, herladen: false, start: Date.now(), welkom: welkom };
    var adres = location.origin + location.pathname.replace(/[^\/]*$/, '') + 'koppel.html?c=' + code;
    $('qr').innerHTML = '<div class="ld-laden"><span></span><span></span><span></span></div>';
    $('qr-fout').hidden = true;
    koppelStatus();
    $('koppelblad').hidden = false;
    Promise.all([
      fetch(KASTJE + code, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leden: leden.map(function (l) { return l.naam; }), plaats: lees('plaats', null) ? instellingen.plaats.naam : '', geheim: geheim }) })
        .then(function (r) { if (!r.ok) throw new Error('kastje'); }),
      laadQr()
    ]).then(function () {
      $('qr').innerHTML = '';
      new window.QRCode($('qr'), { text: adres, width: 440, height: 440, colorDark: '#000000', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
      koppel.timer = setInterval(haalKoppeling, 2000);
    }).catch(function () { $('qr').innerHTML = ''; $('qr-fout').hidden = false; });
  }
  function haalKoppeling() {
    if (!koppel) return;
    if (Date.now() - koppel.start > 14 * 60 * 1000) {   // code verloopt: nieuwe maken (welkom) of sluiten
      if (koppel.welkom && !koppel.herladen) { openKoppelen(true); return; }
      sluitKoppelen(); return;
    }
    fetch(KASTJE + koppel.code, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ophalen: true, geheim: koppel.geheim }) })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        if (d.instellingen) {
          var namen = (d.instellingen.leden || []).slice(0, 4);
          if (namen.length) {
            leden = namen.map(function (n, i) { return { id: 'p' + (i + 1), naam: n }; });
            Object.keys(agendaLinks).forEach(function (k) { if (k !== 'samen' && !naamVan(k)) delete agendaLinks[k]; });
            bewaar('leden', leden); bewaar('agendaLinks', agendaLinks);
            zetNamen(); tekenAgenda();
          }
          var pl = d.instellingen.plaats;
          if (pl && pl.naam && isFinite(pl.lat) && isFinite(pl.lon)) { instellingen.plaats = { naam: pl.naam, lat: +pl.lat, lon: +pl.lon }; bewaar('plaats', instellingen.plaats); haalWeer(); }
          $('koppel-klaar').textContent = 'Klaar';
        }
        if (d.spotify && d.spotify.refresh_token) { spotify.zetToken(d.spotify); koppel.herladen = true; meld('Spotify gekoppeld'); $('koppel-klaar').textContent = 'Klaar'; }
        if (d.agenda && d.agenda.length) {
          d.agenda.forEach(function (x) {
            if (linksVan(agendaLinks[x.wie]).indexOf(x.link) < 0) agendaLinks[x.wie] = (agendaLinks[x.wie] ? agendaLinks[x.wie] + ' ' : '') + x.link;
          });
          bewaar('agendaLinks', agendaLinks); zetNamen(); haalAgenda();
          meld('Agenda toegevoegd'); $('koppel-klaar').textContent = 'Klaar';
        }
        koppelStatus();
      }).catch(function () {});
  }
  function sluitKoppelen() {
    $('koppelblad').hidden = true;
    if (!koppel) return;
    clearInterval(koppel.timer);
    var opnieuw = koppel.herladen; koppel = null;
    if (opnieuw) location.reload();   // muziek opnieuw opstarten met de nieuwe Spotify-sleutel
  }
  $('koppelblad').addEventListener('click', function (e) {
    if (e.target === $('koppelblad') || e.target.closest('[data-sluit]')) { e.stopPropagation(); sluitKoppelen(); }
  }, true);
  $('koppel-open').addEventListener('click', function () { openKoppelen(); });
  // overal waar iets nog niet gekoppeld is, staat een knop met data-koppel
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('[data-koppel]')) return;
    e.stopPropagation(); e.preventDefault();
    vraagCode(function () { openKoppelen(); });
  }, true);

  $('in-code').addEventListener('change', function () {
    var c = $('in-code').value.replace(/\D/g, '');
    if (c && (c.length < 4 || c.length > 6)) { meld('Kies een code van 4 tot 6 cijfers'); $('in-code').value = lees('code', ''); return; }
    bewaar('code', c); meld(c ? 'Code ingesteld' : 'Code uitgezet');
  });
  $('plaats-zoek').addEventListener('click', function (e) {
    e.preventDefault();
    var naam = $('in-plaats').value.trim(); if (!naam) return;
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=nl&countryCode=NL&name=' + encodeURIComponent(naam))
      .then(function (r) { return r.json(); }).then(function (d) {
        var p = d.results && d.results[0];
        if (!p) { meld('Plaats niet gevonden'); return; }
        instellingen.plaats = { naam: p.name, lat: p.latitude, lon: p.longitude };
        bewaar('plaats', instellingen.plaats); $('in-plaats').value = p.name;
        meld('Weer voor ' + p.name); haalWeer();
      }).catch(function () { meld('Zoeken lukt nu niet'); });
  });
  // koppelen gaat altijd via de telefoon (QR-code); zo is in Spotify maar één terugkeeradres nodig (koppel.html)
  $('spotify-koppel').addEventListener('click', function () { openKoppelen(); });

  // ---------- voorbeeld-label ----------
  function werkVoorbeeldLabelBij() {
    var label = document.querySelector('.voorbeeld-label');
    if (DEMO && !label) {
      label = document.createElement('div'); label.className = 'voorbeeld-label'; label.textContent = 'Voorbeeld';
      $('klok').appendChild(label);
    }
  }

  // ---------- aansturing door de voorbeeldpagina ----------
  // stand({ klok, speelt, zichtbaar, agenda, filter, lade, nacht }): zet het paneel in één keer in die toestand
  window.paneelStand = function (o) {
    gestuurd = true;
    if (o.filter) o.filter = { papa: 'p1', joyce: 'p2' }[o.filter] || o.filter;
    if (o.presentatie !== undefined) html.classList.toggle('presentatie', o.presentatie);
    if (o.nacht !== undefined && o.nacht !== nachtGeforceerd) { nachtGeforceerd = o.nacht; html.classList.toggle('nacht', o.nacht); }
    if (o.speelt !== undefined) spotify.zetVoorbeeldSpeelt(o.speelt);
    if (o.klok !== undefined && o.klok !== opKlok()) gaNaar(o.klok);
    if (o.lade !== undefined && o.lade !== ladeIsOpen()) { if (o.lade) ladeOpen(); else ladeDicht(); }
    if (o.zoek !== undefined || o.artiest !== undefined) spotify.zetLade({ zoek: o.zoek || '', artiest: !!o.artiest });
    if (o.agenda !== undefined && o.agenda !== agendaIsOpen()) { if (o.agenda) agendaOpen(); else agendaDicht(); }
    if (o.filter !== undefined && o.filter !== filter) zetFilter(o.filter);
    if (o.zichtbaar !== undefined && o.zichtbaar !== zichtbaar()) zetZichtbaar(o.zichtbaar);
  };

  // ---------- start ----------
  html.classList.add('geen-animatie');
  tikKlok();
  zetFilter('alles');
  // ?klok = meteen de klok, ?lade = meteen de afspeellijsten (handig om te bekijken)
  if (/[?&](klok|rust)/.test(location.search)) html.classList.add('op-klok');
  if (/[?&]lade/.test(location.search)) ladeOpen();
  if (/[?&]agenda/.test(location.search)) setTimeout(agendaOpen, 50);
  if (/[?&]pauze/.test(location.search)) setTimeout(spotify.speelPauze, 0);
  requestAnimationFrame(function () { requestAnimationFrame(function () { html.classList.remove('geen-animatie'); }); });
  werkVoorbeeldLabelBij();
  spotify.start();
  zetNamen();

  // ---------- zelf bijwerken ----------
  // Elke 5 minuten kijken of er een nieuwe versie online staat; zo ja, herladen zodra het paneel in rust is
  // (klokscherm, niets open). Zo komen verbeteringen vanzelf op de iPad.
  (function () {
    if (DEMO) return;
    var mijn = (/paneel\.js\?v=(\d+)/.exec(Array.prototype.map.call(document.scripts, function (x) { return x.src; }).join(' ')) || [])[1];
    if (!mijn) return;
    var nieuw = false;
    function inRust() { return opKlok() && $('instellingen').hidden && $('koppelblad').hidden && $('codeblad').hidden; }
    setInterval(function () {
      if (nieuw) { if (inRust()) location.reload(); return; }
      fetch(location.pathname + '?versie=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
        var v = (/paneel\.js\?v=(\d+)/.exec(t) || [])[1];
        if (v && v !== mijn) { nieuw = true; if (inRust()) location.reload(); }
      }).catch(function () {});
    }, 5 * 60 * 1000);
  })();
  $('vernieuw').addEventListener('click', function () { location.reload(); });
  if (!DEMO && !ingesteld()) setTimeout(function () { openKoppelen(true); }, 400);
})();
