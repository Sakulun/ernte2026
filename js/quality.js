export function getQualitaetsfelder(fruchtart) {
  const fa = (fruchtart||'').toLowerCase();
  if(fa.includes('raps') || fa.includes('sonnenblume')) {
    return {
      feuchte:  {label:'Feuchte (%)',    ph:'8.5',   step:'0.1'},
      oelgehalt:{label:'Ölgehalt (%)',   ph:'42.0',  step:'0.1'},
      hl:       {label:'HL-Gewicht',     ph:'64.0',  step:'0.1'},
    };
  }
  if(fa.includes('erbse') || fa.includes('soja') || fa.includes('bohne')) {
    return {
      feuchte:  {label:'Feuchte (%)',    ph:'14.0',  step:'0.1'},
      protein:  {label:'Protein (%)',    ph:'35.0',  step:'0.1'},
      oelgehalt:{label:'Ölgehalt (%)',   ph:'20.0',  step:'0.1'},
    };
  }
  if(fa.includes('mais') || fa.includes('rübe') || fa.includes('ruebe')) {
    return {
      feuchte:  {label:'Feuchte (%)',    ph:'30.0',  step:'0.1'},
    };
  }
  if(fa.includes('gerste')) {
    return {
      feuchte:  {label:'Feuchte (%)',    ph:'14.5',  step:'0.1'},
      protein:  {label:'Protein (%)',    ph:'11.0',  step:'0.1'},
      hl:       {label:'HL-Gewicht',     ph:'64.0',  step:'0.1'},
    };
  }
  return {
    feuchte:  {label:'Feuchte (%)',    ph:'14.5',  step:'0.1'},
    protein:  {label:'Protein (%)',    ph:'13.5',  step:'0.1'},
    gluten:   {label:'Gluten (%)',     ph:'28.0',  step:'0.1'},
    hl:       {label:'HL-Gewicht',     ph:'78.0',  step:'0.1'},
  };
}

export function qualitaetsFehlende(felder, werte) {
  return Object.entries(felder)
    .filter(([key]) => !werte[key])
    .map(([,f]) => f.label);
}

export function feuchteGrenzwert(fruchtart) {
  const fa = (fruchtart||'').toLowerCase();
  if(fa.includes('raps') || fa.includes('sonnenblume')) return 9.0;
  if(fa.includes('erbse') || fa.includes('soja') || fa.includes('bohne')) return 13.0;
  return 15.0;
}

export function feuchteZuHoch(f) {
  if(!f.feuchte) return false;
  return f.feuchte > feuchteGrenzwert(f.fruchtart);
}
