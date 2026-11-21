/* Leest een iCloud-agenda (.ics) en geeft de afspraken in een periode terug.
   Kan ook herhalende afspraken aan (dagelijks, wekelijks, maandelijks, jaarlijks),
   met uitzonderingen en verplaatste exemplaren. Tijden met een tijdzone (TZID) worden
   gelezen als tijd op de iPad zelf; die staat in Nederland, net als de agenda's. */
(function () {
  'use strict';

  function regels(tekst) {
    // regels die doorlopen (beginnen met spatie of tab) aan elkaar plakken
    return tekst.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  }
  function ontsnap(w) {
    return w.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  }
  function leesTijd(waarde, params) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(waarde.trim());
    if (!m) return null;
    var heleDag = !m[4] || /VALUE=DATE(?!-)/.test(params || '');
    if (heleDag) return { d: new Date(+m[1], +m[2] - 1, +m[3]), heleDag: true };
    if (m[7]) return { d: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])), heleDag: false };
    return { d: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), heleDag: false };
  }
  function duurMs(w) {
    var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(w.trim());
    if (!m) return 0;
    var ms = (((+m[2] || 0) * 7 + (+m[3] || 0)) * 24 * 3600 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
    return m[1] === '-' ? -ms : ms;
  }
  function sleutel(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + 'T' + d.getHours() + ':' + d.getMinutes(); }

  function leesEvents(tekst) {
    var uit = [], ev = null, diepte = 0;
    regels(tekst).forEach(function (r) {
      if (r === 'BEGIN:VEVENT') { ev = { exdate: [] }; diepte = 0; return; }
      if (!ev) return;
      if (/^BEGIN:/.test(r)) { diepte++; return; }      // bv. VALARM overslaan
      if (/^END:/.test(r) && r !== 'END:VEVENT') { diepte--; return; }
      if (r === 'END:VEVENT') { uit.push(ev); ev = null; return; }
      if (diepte > 0) return;
      var i = r.indexOf(':'); if (i < 0) return;
      var kop = r.slice(0, i), waarde = r.slice(i + 1);
      var naam = kop.split(';')[0].toUpperCase(), params = kop.slice(naam.length);
      if (naam === 'SUMMARY') ev.titel = ontsnap(waarde);
      else if (naam === 'LOCATION') ev.plek = ontsnap(waarde).split(/\s*[\n,]\s*/)[0];
      else if (naam === 'UID') ev.uid = waarde.trim();
      else if (naam === 'DTSTART') ev.start = leesTijd(waarde, params);
      else if (naam === 'DTEND') ev.eind = leesTijd(waarde, params);
      else if (naam === 'DURATION') ev.duur = duurMs(waarde);
      else if (naam === 'RRULE') ev.rrule = waarde.trim();
      else if (naam === 'STATUS') ev.status = waarde.trim().toUpperCase();
      else if (naam === 'RECURRENCE-ID') ev.recId = leesTijd(waarde, params);
      else if (naam === 'EXDATE') waarde.split(',').forEach(function (w) { var t = leesTijd(w, params); if (t) ev.exdate.push(t.d); });
    });
    return uit;
  }

  function regel(rrule) {
    var o = {};
    rrule.split(';').forEach(function (p) { var kv = p.split('='); o[kv[0].toUpperCase()] = kv[1]; });
    return o;
  }
  var DAGEN = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  // Alle begintijden van een herhalende afspraak tussen 'vanaf' en 'tot'.
  // Loopt dag voor dag en kijkt per dag of hij bij de regel past (FREQ, INTERVAL, BYDAY met of zonder
  // nummer, BYMONTHDAY, BYMONTH, BYSETPOS, COUNT, UNTIL). Zo gaan ook 'elke werkdag', 'laatste vrijdag
  // van de maand' en 'eerste werkdag van de maand' goed.
  function herhalingen(start, rr, tot, vanaf) {
    var r = regel(rr), freq = r.FREQ, stap = Math.max(1, +(r.INTERVAL || 1));
    if (!/^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(freq)) return [start];
    var aantal = r.COUNT ? +r.COUNT : Infinity;
    var tm = r.UNTIL ? leesTijd(r.UNTIL) : null, grens = tm ? tm.d : null;
    if (grens && tm.heleDag) grens = new Date(grens.getTime() + 86400000 - 1);
    var wkst = DAGEN[r.WKST || 'MO'];
    var bydag = r.BYDAY ? r.BYDAY.split(',').map(function (x) {
      var m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim()); return m ? { n: m[1] ? +m[1] : 0, dag: DAGEN[m[2]] } : null;
    }).filter(Boolean) : null;
    var bymaanddag = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
    var bymaand = r.BYMONTH ? r.BYMONTH.split(',').map(function (x) { return +x - 1; }) : null;
    var bysetpos = r.BYSETPOS ? r.BYSETPOS.split(',').map(Number) : null;
    var u = start.getHours(), mi = start.getMinutes(), se = start.getSeconds();
    var dag0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());

    function dagenTussen(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000); }
    function weekBegin(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() - wkst + 7) % 7)); }
    function inPeriode(d) {   // valt deze dag in een periode die meedoet (INTERVAL)?
      if (freq === 'DAILY') return dagenTussen(dag0, d) % stap === 0;
      if (freq === 'WEEKLY') return Math.round(dagenTussen(weekBegin(dag0), weekBegin(d)) / 7) % stap === 0;
      var maanden = (d.getFullYear() - dag0.getFullYear()) * 12 + d.getMonth() - dag0.getMonth();
      if (freq === 'MONTHLY') return maanden % stap === 0;
      return (d.getFullYear() - dag0.getFullYear()) % stap === 0;
    }
    function nInMaand(d) {   // de hoeveelste (en hoeveelste van achteren) deze weekdag in de maand is
      var laatste = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return { voor: Math.floor((d.getDate() - 1) / 7) + 1, achter: -(Math.floor((laatste - d.getDate()) / 7) + 1) };
    }
    function past(d) {
      if (bymaand && bymaand.indexOf(d.getMonth()) < 0) return false;
      if (bymaanddag) {
        var laatste = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        if (!bymaanddag.some(function (x) { return x > 0 ? d.getDate() === x : d.getDate() === laatste + x + 1; })) return false;
      }
      if (bydag) {
        var nm = nInMaand(d);
        if (!bydag.some(function (b) { return b.dag === d.getDay() && (!b.n || b.n === nm.voor || b.n === nm.achter); })) return false;
      }
      // standaardwaarden uit de startdatum als er niets anders is opgegeven
      if (freq === 'WEEKLY' && !bydag) return d.getDay() === dag0.getDay();
      if (freq === 'MONTHLY' && !bydag && !bymaanddag) return d.getDate() === dag0.getDate();
      if (freq === 'YEARLY' && !bydag && !bymaanddag) return d.getDate() === dag0.getDate() && (bymaand || d.getMonth() === dag0.getMonth());
      return true;
    }
    function pastMetPositie(d) {
      if (!past(d)) return false;
      if (!bysetpos) return true;
      // BYSETPOS: alle passende dagen in deze maand (of dit jaar) op een rij, dan de gevraagde plek
      var jaar = freq === 'YEARLY' && !bymaand, lijst = [];
      var b = jaar ? new Date(d.getFullYear(), 0, 1) : freq === 'WEEKLY' ? weekBegin(d) : new Date(d.getFullYear(), d.getMonth(), 1);
      var e = jaar ? new Date(d.getFullYear() + 1, 0, 1) : freq === 'WEEKLY' ? new Date(b.getFullYear(), b.getMonth(), b.getDate() + 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
      for (var x = new Date(b); x < e; x = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1)) if (past(x)) lijst.push(x.getTime());
      var plek = lijst.indexOf(d.getTime());
      return bysetpos.some(function (p) { return p > 0 ? plek === p - 1 : plek === lijst.length + p; });
    }

    var uit = [], n = 0;
    // met COUNT moeten we vanaf het begin tellen; anders kunnen we pas vlak voor de gevraagde periode beginnen
    var d = isFinite(aantal) ? new Date(dag0) : new Date(Math.max(dag0.getTime(), new Date(vanaf.getFullYear(), vanaf.getMonth(), vanaf.getDate()).getTime()));
    for (var veilig = 0; veilig < 40000; veilig++) {
      var moment = new Date(d.getFullYear(), d.getMonth(), d.getDate(), u, mi, se);
      if (moment > tot || (grens && moment > grens) || n >= aantal) break;
      if (moment >= start && inPeriode(d) && pastMetPositie(d)) {
        n++;
        if (moment >= vanaf) uit.push(moment);
      }
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    // de startdatum zelf is altijd de eerste keer, ook als hij niet precies bij de regel past
    if (start >= vanaf && start <= tot && !uit.some(function (x) { return x.getTime() === start.getTime(); })) uit.unshift(start);
    return uit;
  }

  // leesIcs(tekst, van, tot) -> [{ start, eind, titel, plek, heleDag, uid }]
  window.leesIcs = function (tekst, van, tot) {
    var events = leesEvents(tekst).filter(function (e) { return e.start && e.status !== 'CANCELLED'; });
    var verplaatst = {};
    events.forEach(function (e) { if (e.recId && e.uid) verplaatst[e.uid + '|' + sleutel(e.recId.d)] = 1; });
    var uit = [];
    events.forEach(function (e) {
      var s = e.start.d, heleDag = e.start.heleDag;
      var lengte = e.eind ? e.eind.d - s : e.duur || (heleDag ? 86400000 : 0);
      // ook herhalingen die al vóór 'van' begonnen en er nog doorheen lopen
      var vanaf = new Date(van.getTime() - Math.max(lengte, 0) - 86400000);
      var starts = e.rrule && !e.recId ? herhalingen(s, e.rrule, tot, vanaf) : [s];
      var weg = {};
      e.exdate.forEach(function (d) { weg[sleutel(d)] = 1; });
      starts.forEach(function (b) {
        if (weg[sleutel(b)]) return;
        if (e.rrule && !e.recId && verplaatst[e.uid + '|' + sleutel(b)]) return;
        var eind = new Date(b.getTime() + lengte);
        if (heleDag && lengte >= 86400000) {   // hele dagen: op middernacht houden, ook rond zomer-/wintertijd
          eind = new Date(b.getFullYear(), b.getMonth(), b.getDate() + Math.round(lengte / 86400000));
        }
        if (eind <= van || b >= tot) return;
        uit.push({ start: b, eind: eind, titel: e.titel || '(Geen titel)', plek: e.plek || '', heleDag: heleDag, uid: e.uid || '' });
      });
    });
    return uit;
  };
})();
