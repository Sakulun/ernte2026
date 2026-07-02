const OB_STEPS = {
  drescher: [
    {
      icon: '👋',
      title: 'Willkommen, Drescherfahrer!',
      subtitle: 'Diese kurze Einführung zeigt dir alles was du für die Ernte brauchst.',
      steps: []
    },
    {
      icon: '🌾',
      title: 'Fuhre zuweisen',
      subtitle: 'So startest du eine neue Fuhre:',
      steps: [
        { icon:'📍', title:'Schlag wählen', desc:'Wähle den aktuellen Schlag aus der Dropdown-Liste. Nur aktive Schläge werden angezeigt.' },
        { icon:'🚛', title:'Abfahrer wählen', desc:'Wähle einen freien Abfahrer. Bereits belegte Abfahrer sind ausgegraut.' },
        { icon:'▶', title:'Fuhre starten', desc:'Klick auf „Fuhre starten" – der Abfahrer sieht die Fuhre sofort auf seinem Handy.' },
      ]
    },
    {
      icon: '📋',
      title: 'Meine Fuhren',
      subtitle: 'Im Tab „Fuhren" siehst du alle deine Fuhren.',
      steps: [
        { icon:'🟡', title:'Offen', desc:'Die Fuhre ist unterwegs – der Abfahrer wiegt noch.' },
        { icon:'✓', title:'Fertig', desc:'Abfahrer hat gewogen und abgeschlossen. Du kannst eine neue Fuhre zuweisen.' },
        { icon:'🧭', title:'Navigation', desc:'Im Tab „Schlag" findest du alle aktiven Schläge auf einer Karte – tippe auf 🧭 Los für die Navigation.' },
      ]
    },
    {
      icon: '✅',
      title: 'Alles klar!',
      subtitle: 'Du bist bereit für die Ernte. Bei Fragen wende dich an den Betriebsleiter.',
      steps: []
    }
  ],
  abfahrer: [
    {
      icon: '👋',
      title: 'Willkommen, Abfahrer!',
      subtitle: 'Diese kurze Einführung zeigt dir alles was du für die Ernte brauchst.',
      steps: []
    },
    {
      icon: '📬',
      title: 'Neue Fuhre',
      subtitle: 'Wenn der Drescher eine Fuhre für dich anlegt:',
      steps: [
        { icon:'🔔', title:'Benachrichtigung', desc:'Du siehst sofort „Neue Fuhre zugewiesen!" oben auf dem Bildschirm.' },
        { icon:'📋', title:'Tab „Offen"', desc:'Die Fuhre erscheint im Tab Offen mit Schlag, Fruchtart und Fuhren-Nummer.' },
        { icon:'🧭', title:'Navigation', desc:'Tippe auf „Zum Schlag navigieren" um direkt zu Google Maps / Apple Maps zu gelangen.' },
      ]
    },
    {
      icon: '⚖️',
      title: 'Wiegung eintragen',
      subtitle: 'Nach dem Abladen auf der Waage:',
      steps: [
        { icon:'🔢', title:'Vollgewicht', desc:'Trag das Vollgewicht ein. Die App zeigt den 1.000er-Punkt automatisch an.' },
        { icon:'🔢', title:'Leergewicht', desc:'Dann das Leergewicht – das Netto wird sofort berechnet und angezeigt.' },
        { icon:'💧', title:'Qualität', desc:'Je nach Fruchtart: Feuchte, Protein, Gluten oder Ölgehalt eintragen. Alles optional, aber wichtig für den Betrieb.' },
      ]
    },
    {
      icon: '✅',
      title: 'Fuhre abschließen',
      subtitle: 'Letzte Schritte:',
      steps: [
        { icon:'✓', title:'Abschließen', desc:'Klick auf „Fuhre abschließen". Fehlende Qualitätsangaben werden nochmal abgefragt.' },
        { icon:'📂', title:'Erledigt', desc:'Die Fuhre wandert in den Tab „Erledigt" – der Drescher kann sofort die nächste anlegen.' },
        { icon:'🔋', title:'Bildschirm anlassen', desc:'Lass den Bildschirm an! Die App hält ihn automatisch wach, damit dein GPS-Standort übertragen wird.' },
      ]
    },
    {
      icon: '🎉',
      title: 'Alles klar!',
      subtitle: 'Du bist bereit für die Ernte. Gute Fahrt!',
      steps: []
    }
  ]
};

let _obStep = 0;
let _obRole = null;

export function showOnboarding(role) {
  _obRole = role;
  _obStep = 0;
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const steps = OB_STEPS[_obRole];
  if(!steps) return;
  const step = steps[_obStep];
  const total = steps.length;
  const pct = ((_obStep + 1) / total * 100).toFixed(0);
  const isLast = _obStep === total - 1;
  const isFirst = _obStep === 0;

  const stepsHtml = step.steps.map((s, i) =>
    `<div class="ob-step" style="animation-delay:${i * 0.08}s">
      <div class="ob-step-icon">${s.icon}</div>
      <div class="ob-step-text">
        <div class="ob-step-title">${s.title}</div>
        <div class="ob-step-desc">${s.desc}</div>
      </div>
    </div>`
  ).join('');

  const dotsHtml = steps.map((_, i) =>
    `<div class="ob-dot ${i === _obStep ? 'active' : ''}"></div>`
  ).join('');

  document.getElementById('onboarding-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.innerHTML = `
    <div id="onboarding-card">
      <div class="ob-progress">
        <div class="ob-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="ob-header">
        <span class="ob-icon">${step.icon}</span>
        <div class="ob-title">${step.title}</div>
        <div class="ob-subtitle">${step.subtitle}</div>
      </div>
      <div class="ob-body">${stepsHtml}</div>
      <div class="ob-footer">
        <div class="ob-dots">${dotsHtml}</div>
        <div style="display:flex;gap:8px">
          ${!isFirst ? `<button class="btn btn-outline btn-sm" onclick="obPrev()">← Zurück</button>` : ''}
          ${!isLast
            ? `<button class="btn btn-primary btn-sm" onclick="obNext()">Weiter →</button>`
            : `<button class="btn btn-sm" style="background:var(--green);color:var(--text);border:none;font-weight:700" onclick="closeOnboarding()">Los geht's! 🌾</button>`
          }
        </div>
      </div>
      <div style="text-align:center;padding-bottom:14px">
        <button onclick="closeOnboarding()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:11px">Überspringen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

export function obNext() {
  const steps = OB_STEPS[_obRole];
  if(_obStep < steps.length - 1) { _obStep++; renderOnboardingStep(); }
}

export function obPrev() {
  if(_obStep > 0) { _obStep--; renderOnboardingStep(); }
}

export function closeOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if(overlay) {
    overlay.style.animation = 'ob-fade-in 0.2s ease reverse forwards';
    setTimeout(() => overlay.remove(), 200);
  }
  localStorage.setItem('ob_seen_' + _obRole, '1');
}

export function checkShowOnboarding(role) {
  if(role === 'drescher' || role === 'abfahrer') {
    if(!localStorage.getItem('ob_seen_' + role)) {
      setTimeout(() => showOnboarding(role), 800);
    }
  }
}
