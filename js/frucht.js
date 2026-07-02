const fruchtFarbe = {
  'Winterweichweizen': {bg:'rgba(196,160,60,0.12)', border:'rgba(196,160,60,0.4)', dot:'#a07828'},
  'Wintergerste':      {bg:'rgba(180,130,40,0.12)', border:'rgba(180,130,40,0.4)', dot:'#8a6010'},
  'Winterraps':        {bg:'rgba(140,180,40,0.12)', border:'rgba(140,180,40,0.4)', dot:'#607a10'},
  'Winterdurum':       {bg:'rgba(200,140,60,0.12)', border:'rgba(200,140,60,0.4)', dot:'#a07030'},
  'Wintertriticale':   {bg:'rgba(140,100,180,0.12)',border:'rgba(140,100,180,0.4)',dot:'#7050a0'},
  'Sommerweichweizen': {bg:'rgba(200,160,60,0.12)', border:'rgba(200,160,60,0.4)', dot:'#906820'},
  'Sommerdurum':       {bg:'rgba(210,150,40,0.12)', border:'rgba(210,150,40,0.4)', dot:'#906018'},
  'Erbsen':            {bg:'rgba(60,150,80,0.12)',  border:'rgba(60,150,80,0.4)',  dot:'#306a40'},
  'Sojabohnen':        {bg:'rgba(80,140,60,0.12)',  border:'rgba(80,140,60,0.4)',  dot:'#406030'},
  'Mais':              {bg:'rgba(200,170,20,0.12)', border:'rgba(200,170,20,0.4)', dot:'#806800'},
  'Sonnenblumen':      {bg:'rgba(200,150,10,0.12)', border:'rgba(200,150,10,0.4)', dot:'#805000'},
  'Zuckerrüben':       {bg:'rgba(60,130,180,0.12)', border:'rgba(60,130,180,0.4)', dot:'#205880'},
};

export function getFruchtFarbe(fa) {
  if(!fa) return {bg:'rgba(100,100,100,0.15)', border:'rgba(100,100,100,0.4)', dot:'#888'};
  if(fruchtFarbe[fa]) return fruchtFarbe[fa];
  for(const key of Object.keys(fruchtFarbe)) {
    if(fa.includes(key.replace('Winter','').replace('Sommer',''))) return fruchtFarbe[key];
  }
  return {bg:'rgba(100,100,100,0.15)', border:'rgba(100,100,100,0.4)', dot:'#888'};
}
