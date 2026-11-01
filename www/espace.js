/* espace.js — le fond spatial du tableau de bord, et l habillage du contenu
   qui va avec (verre, relief, etat du homelab). Mis au point du 27/10 au
   01/11/2026 avec Alexis, choix par choix ; ce qui a ete essaye et refuse est
   note la ou ca s applique, pour ne pas le reproposer.
   Sans WebGL ou sans ce fichier, la page garde son fond et son verre
   d origine (fond.css).

   La scene est peinte UNE FOIS par un shader WebGL, recopiee dans un canevas 2D,
   puis le contexte WebGL est rendu : un contexte garde ouvert peut etre perdu
   (iPhone en arriere-plan) et le fond deviendrait noir.
   ⚠️ PAS D IMAGE `blob:` : la CSP de la page (`img-src 'self' data:`) la
   refuse, et le fond restait invisible. Un canevas n y est pas soumis.
   Seuls quelques petits elements bougent ensuite, en CSS : etoiles qui
   scintillent, vaisseaux.
   ⚠️ Le verre des cartes recalcule son flou des que ce qui est dessous change :
   tout ce qui bouge reste petit et lent.

   L AMBIANCE : Star Citizen melange de Cyberpunk. L espace, la planete a
   anneaux et la lune viennent du premier ; du second, les villes cyan et
   magenta sur la face de nuit et le magenta de la nebuleuse (une constante
   du shader, « neon », ramene a Star Citizen seul).
   Retires a la demande d Alexis : la trame de lignes (un voile blanc qui
   ternissait l image), l anneau orbital en pointilles, la station (avec ses
   feux et son repere « HOMELAB »), la petite lune devant la planete et le
   soleil visible.
   ⚠️ LA PLANETE EST CELLE DU DEUXIEME RENDU, preferee par Alexis a une version
   « realiste » (atmosphere physique, calottes, villes sur les cotes) : ne pas
   la refaire sans le lui demander. La lune, elle, est en relief.
   Etoiles : le melange de deux styles essayes, « realistes » et « cinema ».

   L ETAT DU HOMELAB est integre au decor, comme une meteo spatiale, a la place
   des halos qui teintaient toute la page : une aurore sur le haut de la
   planete (violette au calme, ambre en incident, rouge en panne), et en
   panne la moitie des villes dans le noir.

   LE CONTENU (en CSS, plus bas) : un verre adapte a une scene nette, et un
   relief avec une lumiere qui vient d en haut, fait d OMBRES SEULES, sans aucun
   blanc. Tout est en relief, sauf les pastilles, les rails et la carte Jellyfin,
   creuses (point 3 bis). Les menus deroulants prennent la matiere de leur parent. */
(() => {
  "use strict";
  const aurora = document.querySelector(".aurora");
  if (!aurora) return;

  // Le verre adapte et le relief : leurs regles (plus bas)
  // sont prefixees par ces classes du body, posees ici. Sans ce script, la
  // page garde son verre et son fond d origine.
  // ⚠️ Garder les prefixes : ils donnent aux regles la specificite qui les
  // fait passer devant celles de fond.css et de style.css.
  document.body.classList.add("verre-scene", "relief", "final");
  // les reglages memorises par les panneaux d essai (10 et 11/2026) ne servent plus
  try {
    for (const k of ["fond", "etoiles", "etoiles-2", "verre", "relief", "creuse"]) localStorage.removeItem("homelab.essai-" + k);
    localStorage.removeItem("homelab.test-infos"); localStorage.removeItem("homelab.test-infos-2");
  } catch (x) { /* stockage refuse */ }


  /* 1. LE SHADER
     Unites de scene : la hauteur de l ecran vaut 1, l origine est au centre,
     y vers le haut. Les positions arrivent de `plan()`, qui sert aussi a
     placer les elements HTML : les deux restent alignes. */
  const VS = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
  const FS = `
precision highp float;
uniform vec2 uRes;
uniform float uDpr, uEtat;   // uEtat : 0 calme, 1 incident, 2 panne
uniform vec3 uPlanete, uLune1;

// le soleil : a droite, un peu en hauteur et devant
const vec3 L = vec3(.832, .512, .213);

float h12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 h32(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yxz+33.33);return fract((q.xxy+q.yzz)*q.zyx);}
float h13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
vec3 h33(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}

float b2(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(h12(i),h12(i+vec2(1,0)),u.x),mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),u.x),u.y);}
float b3(vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(mix(h13(i),h13(i+vec3(1,0,0)),u.x),mix(h13(i+vec3(0,1,0)),h13(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(h13(i+vec3(0,0,1)),h13(i+vec3(1,0,1)),u.x),mix(h13(i+vec3(0,1,1)),h13(i+vec3(1,1,1)),u.x),u.y),u.z);}
// ⚠️ Six octaves : la planete et la nebuleuse retenues ont ete peintes ainsi,
// une septieme deplacerait les cotes.
float f2(vec2 p){float s=0.,a=.5;for(int k=0;k<6;k++){s+=a*b2(p);p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,1.7);a*=.5;}return s;}
float f3(vec3 p){float s=0.,a=.5;for(int k=0;k<6;k++){s+=a*b3(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
float worley(vec3 p){vec3 i=floor(p),f=fract(p);float d=1.;
  for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec3 o=vec3(float(x),float(y),float(z));vec3 r=o+h33(i+o)-f;d=min(d,dot(r,r));}
  return sqrt(d);}

// Une couche d etoiles : une au plus par cellule, cellules en pixels CSS.
// base et expo reglent la repartition des eclats : un grand exposant donne
// beaucoup d etoiles faibles et tres peu de brillantes, comme le ciel.
// halo : lueur douce autour ; pointes : aigrettes, portee : leur longueur.
// (Pas d accent grave dans ces commentaires : ils sont dans une chaine JS.)
vec3 etoiles(vec2 fc, float cel, float proba, float eclat, float base, float expo, float halo, float pointes, float portee){
  vec3 s=vec3(0.);
  vec2 id=floor(fc/cel);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 c=id+vec2(float(i),float(j));
    vec3 h=h32(c+cel);
    if(h.z>proba)continue;
    vec2 d=(fc-(c+.15+.7*h.xy)*cel)/uDpr;
    float r2=dot(d,d);
    float b=eclat*(base+(1.-base)*pow(h12(c*1.7+cel),expo));
    float e=exp(-r2*1.4)+halo*.07*exp(-sqrt(r2)*.45);
    if(pointes>0.){vec2 a=abs(d);e+=pointes*.16*(exp(-a.y*2.2-a.x*portee)+exp(-a.x*2.2-a.y*portee));}
    float t=h12(c+9.1);
    vec3 teinte=t<.6?mix(vec3(.72,.82,1.),vec3(1.),t/.6):mix(vec3(1.),vec3(1.,.82,.64),(t-.6)/.4);
    s+=teinte*b*e;
  }
  return s;
}

// Densite des anneaux selon le rayon (en rayons de planete) : des annelets
// et deux divisions.
float anneau(float r){
  if(r<1.45||r>2.25)return 0.;
  float d=smoothstep(1.45,1.55,r)*smoothstep(2.25,2.12,r);
  d*=.35+.65*b2(vec2(r*55.,.5));
  d*=.65+.35*b2(vec2(r*210.,7.5));
  d*=smoothstep(.010,.028,abs(r-1.86));
  d*=1.-.5*smoothstep(.06,0.,abs(r-1.66));
  return d;
}

// Une lune : relief de crateres en BOSSELAGE (la normale suit le relief), sinon
// les crateres ne sont que des taches et la lune parait peinte.
float cratere(float d,float r){float x=d/r;return x<1.?(x*x-1.)+.35*smoothstep(.55,1.,x):.35*exp(-(x-1.)*5.);}
float relief(vec3 n,float g){
  return .25*f3(n*5.+g)+.45*cratere(worley(n*2.5+g),.42)+.22*cratere(worley(n*6.+g*1.7),.34)+.10*cratere(worley(n*14.+g*2.3),.28);}
vec4 lune(vec2 p,vec3 m,float g){
  if(m.z<=0.)return vec4(0.);
  vec2 q=(p-m.xy)/m.z;float r=length(q);
  float couv=1.-smoothstep(1.-1.5/(uRes.y*m.z),1.,r);
  if(couv<=0.)return vec4(0.);
  vec3 n=vec3(q,sqrt(max(0.,1.-r*r)));
  vec3 t1=normalize(cross(n,vec3(0.,1.,.001))),t2=cross(n,t1);
  float e=.006,h0=relief(n,g);
  float dx=(relief(normalize(n+e*t1),g)-h0)/e,dy=(relief(normalize(n+e*t2),g)-h0)/e;
  vec3 nb=normalize(n-.035*(dx*t1+dy*t2));
  float mers=smoothstep(.45,.62,f3(n*1.6+g*3.));     // grandes plaines sombres
  vec3 alb=mix(vec3(.50,.50,.56),vec3(.30,.30,.37),mers)*(.85+.3*f3(n*9.+g));
  float lum=max(dot(nb,L),0.)*smoothstep(-.03,.10,dot(n,L));
  // + lumiere renvoyee par la planete ; x 1,6 pour garder l eclat valide avec
  // l autre courbe de rendu, revenue avec la planete
  return vec4((alb*lum*1.25+alb*vec3(.03,.04,.08))*1.6,couv);
}

// Repere propre a la planete : axe incline, puis un quart de tour.
vec3 repereP(vec3 n){
  n.xy=vec2(.939*n.x+.343*n.y,-.343*n.x+.939*n.y);
  n.xz=vec2(.622*n.x-.783*n.z,.783*n.x+.622*n.z);
  return n;
}
// L AURORE dit l etat du homelab, comme une meteo spatiale : violette et
// discrete au calme, ambre et vive en incident (tempete solaire), rouge en
// panne. Des rideaux stries qui se levent au-dessus du bord, comme sur les
// photos prises depuis l orbite, sur le haut de la planete (angle th autour
// de 85 degres : le sommet, un peu a droite).
// ⚠️ Pas un ovale autour du pole, plus juste : il tombait surtout sur la face
// eclairee, ou une aurore ne se voit pas, et l etat devenait illisible.
// ⚠️ Pas centree a gauche du sommet non plus (106 degres) : sur un grand
// ecran, la page ne grandit pas avec la hauteur et cet arc passait derriere
// les cartes. Le sommet et sa droite restent degages. Intensite triplee apres
// un premier essai juge « a peine visible ».
vec3 teinteAurore(){return uEtat<.5?vec3(.45,.40,1.):uEtat<1.5?vec3(1.,.58,.16):vec3(1.,.20,.14);}
float forceAurore(){return uEtat<.5?.45:uEtat<1.5?2.:2.4;}
float rideau(float th){
  float fenetre=exp(-pow((th-1.48)/.55,2.));
  return fenetre*(.35+.65*pow(b2(vec2(th*90.,4.)),2.)*(.6+.4*b2(vec2(th*240.,9.))));
}

void main(){
  vec2 fc=gl_FragCoord.xy;
  vec2 p=(fc-.5*uRes)/uRes.y;
  // la part Cyberpunk (villes cyan et magenta, nebuleuse magenta) : a 0, la
  // scene redevient Star Citizen seul
  const float neon=1.;

  // 1. le fond de l espace, a peine plus clair en haut
  vec3 col=mix(vec3(.008,.010,.026),vec3(.016,.018,.050),smoothstep(-.6,.6,p.y));

  // nebuleuse : un bruit deforme par lui-meme, en haut et a gauche
  vec2 q=p*1.3+vec2(3.1,1.7);
  vec2 w=vec2(f2(q),f2(q+vec2(5.2,1.3)));
  float neb=f2(q+2.2*w);
  float zone=smoothstep(-.30,.45,p.y+.35*(w.x-.5))*smoothstep(.95,-.2,p.x+.2*w.y);
  float dense=smoothstep(.42,.82,neb)*zone;
  vec3 tn=mix(vec3(.13,.18,.58),vec3(.40,.19,.68),smoothstep(.35,.65,w.y));
  tn=mix(tn,vec3(.85,.16,.60),neon*.7*smoothstep(.55,.80,w.x));
  float pouss=smoothstep(.48,.70,f2(p*3.4+w*1.6+11.));
  col+=tn*dense*.40*(1.-.8*pouss);
  float fil=pow(1.-abs(2.*f2(p*4.2+w*2.)-1.),7.);
  col+=mix(tn,vec3(.25,.85,1.),neon*.35)*fil*zone*.10;

  // voie lactee : une bande en diagonale, poussiereuse
  vec2 dir=normalize(vec2(1.,-.45));
  float dist=dot(p-vec2(-.05,.12),vec2(-dir.y,dir.x));
  float bande=exp(-dist*dist/.03);
  float poussB=smoothstep(.45,.75,f2(p*6.+7.));
  col+=vec3(.28,.32,.55)*bande*.09*(.4+.6*f2(p*9.))*(1.-.7*poussB);

  // etoiles : le melange retenu de deux styles essayes. Des « realistes »,
  // la repartition (presque toutes faibles, la voie lactee dense, le reste du
  // ciel clairseme) ; du style « cinema », les etoiles moyennes voilees et
  // les aigrettes douces sur les brillantes, renforcees a la demande
  // d Alexis (plus marquees et plus longues).
  float mw=bande*(1.-poussB);
  vec3 et=etoiles(fc,5.*uDpr,.45,.22,.2,3.,0.,0.,0.)*mw*1.3;
  et+=etoiles(fc,14.*uDpr,.32,.9,.05,6.,0.,0.,0.);
  et+=etoiles(fc,34.*uDpr,.28,.55,.2,3.,.5,0.,0.);
  et+=etoiles(fc,130.*uDpr,.28,1.75,.05,4.,1.2,1.8,.055);
  col+=vec3(.30,.33,.52)*mw*.05;                // la lumiere des etoiles non resolues
  col+=et*(1.-.6*dense*pouss);

  // 2. PAS DE SOLEIL VISIBLE, retire a la demande d Alexis : peint dans la
  // scene, sa lueur passait derriere la barre et delavait les cartes ; en
  // element HTML place dans un coin libre, il ne trouvait pas toujours de
  // place. Il reste hors champ, a droite : c est lui qui eclaire (L).

  // 3. la planete (celle du deuxieme rendu, voir l en-tete)
  vec3 NA=normalize(vec3(-.18,.86,.48));      // plan des anneaux
  vec2 qp=(p-uPlanete.xy)/uPlanete.z;
  float rp=length(qp);
  float unPx=1./(uRes.y*uPlanete.z);          // un pixel, en rayons de planete
  float couv=1.-smoothstep(1.-1.5*unPx,1.,rp);
  float zS=rp<1.?sqrt(1.-rp*rp):-9.;

  // anneaux : le regard est parallele a z, on coupe le plan des anneaux
  float zA=-(qp.x*NA.x+qp.y*NA.y)/NA.z;
  vec3 XA=vec3(qp,zA);float rA=length(XA);
  float dA=anneau(rA);
  vec3 cA=vec3(0.);
  if(dA>0.){
    float bb=dot(XA,L),cc=dot(XA,XA)-1.;
    // La planete leur fait de l ombre, avec une PENOMBRE : la distance du
    // centre de la planete au rayon vers le soleil decide, en fondu.
    // ⚠️ Pas en tout ou rien : a 88 % d un coup, l ombre tranchait l anneau
    // d une ligne droite, en bas a gauche, et il paraissait coupe. L anneau
    // reste visible dedans (lumiere diffusee), a 45 %.
    float dmin=sqrt(max(cc+1.-bb*bb,0.));
    float ombre=(1.-smoothstep(.82,1.18,dmin))*smoothstep(0.,-.35,bb);
    cA=mix(vec3(.52,.58,.80),vec3(.62,.56,.84),b2(vec2(rA*28.,3.)))*(.30+.70*abs(dot(NA,L)))*(1.-.55*ombre)*.75;
    cA=mix(cA,cA*vec3(.95,.75,1.15),neon*.35);
  }
  float alA=dA*.50;
  bool aDevant=zA>zS;
  if(dA>0.&&!(aDevant&&rp<1.))col=mix(col,cA,alA);

  // atmosphere vue de l exterieur
  float dd=max(rp-1.,0.);
  float eB=smoothstep(-.45,.75,dot(vec3(qp/max(rp,1e-4),0.),L));
  vec3 atB=mix(vec3(.42,.30,.95),vec3(.35,.68,1.),eB);
  col+=atB*(exp(-dd*40.)*(.05+.70*eB)+exp(-dd*8.)*.07*eB)*(1.-couv);
  col+=vec3(.9,.2,.7)*exp(-dd*25.)*(1.-eB)*neon*.10*(1.-couv);
  // l aurore au-dessus du bord : des rideaux aux sommets inegaux, plus clairs
  // a la base
  float th=atan(qp.y,qp.x),ra=rideau(th);
  // ⚠️ Aucune borne nette en distance : un premier essai s arretait a 1,35
  // rayon, la ou la lueur valait encore quelques pour cent, et l arc de la
  // coupure se voyait. Elle s eteint maintenant jusqu a zero, en douceur.
  if(ra>.001&&rp>=1.-1.5*unPx){
    float haut=.035+.07*b2(vec2(th*25.,2.));
    float lueur=exp(-pow((th-1.48)/.55,2.))*exp(-dd/.12)*.18;   // la lueur diffuse autour des rideaux
    col+=mix(teinteAurore(),vec3(1.),.25*exp(-dd/.006))*forceAurore()*(ra*exp(-dd/haut)*1.1+lueur)
        *smoothstep(.9,.35,dd)*(1.-couv);
  }

  if(rp<1.){
    vec3 n=vec3(qp,zS);
    vec3 m=repereP(n);
    float ndl=dot(n,L);
    vec3 wv=vec3(f3(m*2.+1.3),f3(m*2.+7.7),f3(m*2.+4.1));
    float hh=f3(m*2.4+1.7*wv);
    float terre=smoothstep(.50,.53,hh);
    vec3 surf=mix(mix(vec3(.018,.035,.12),vec3(.035,.075,.20),smoothstep(.30,.50,hh)),
                  mix(vec3(.09,.09,.15),vec3(.17,.15,.24),smoothstep(.55,.72,hh)),terre);
    float nuages=smoothstep(.50,.76,f3(vec3(m.x*3.2,m.y*8.,m.z*3.2)+2.2*wv));
    surf=mix(surf,vec3(.50,.55,.78),nuages*.85);
    float jour=smoothstep(-.10,.28,ndl);
    vec3 c=surf*(.015+jour*(.25+1.05*max(ndl,0.)));
    // reflet du soleil sur les oceans
    c+=vec3(.55,.65,.95)*pow(max(reflect(-L,n).z,0.),50.)*(1.-terre)*(1.-nuages)*.45;

    // les villes, sur la face de nuit (neon seulement)
    // ⚠️ Des points, presque pas de halo : un premier essai a 1,1 de voile
    // faisait de la face de nuit une nappe cyan et magenta sous les cartes.
    float nuit=1.-smoothstep(-.18,.10,ndl);
    float urb=terre*smoothstep(.48,.66,f3(m*4.5+3.3));
    float pts=step(.80,h13(floor(m*230.)))+.6*step(.90,h13(floor(m*470.)+3.));
    float voile=pow(f3(m*26.+5.),3.);
    vec3 cn=mix(vec3(.15,.85,1.),vec3(1.,.22,.72),smoothstep(.42,.58,f3(m*1.4+9.)));
    cn=mix(cn,vec3(1.,.86,.72),.3*step(.75,h13(floor(m*230.)+7.)));
    // en panne, la moitie des quartiers s eteint ; des feux de secours rouges
    // y restent allumes
    float allume=1.-step(1.5,uEtat)*(1.-step(.47,f3(m*2.2+7.)));
    c+=cn*urb*allume*((pts*.75+voile*.35)*(1.-.75*nuages)*.9+.035)*nuit*neon;
    c+=vec3(1.,.12,.08)*urb*(1.-allume)*step(.93,h13(floor(m*160.)+11.))*(1.-.75*nuages)*nuit*neon*.9;

    // l aurore vue a travers, juste en dedans du bord
    c+=teinteAurore()*forceAurore()*ra*exp(-(1.-rp)/.045)*.9;

    // atmosphere vue de l interieur du disque
    float fr=pow(1.-n.z,3.);
    float eA=smoothstep(-.35,.60,ndl);
    c+=mix(vec3(.42,.30,.95),vec3(.35,.68,1.),eA)*fr*(.12+.85*eA);
    c+=vec3(.9,.2,.7)*fr*nuit*neon*.12;

    // ombre des anneaux sur la planete
    float t=-dot(n,NA)/dot(L,NA);
    if(t>0.)c*=1.-.6*anneau(length(n+t*L));
    col=mix(col,c,couv);
  }
  if(dA>0.&&aDevant&&rp<1.)col=mix(col,cA,alA);

  // 4. la lune
  vec4 l1=lune(p,uLune1,3.7);col=mix(col,l1.rgb,l1.a);

  // le bas, sous les cartes, reste plus sombre pour la lecture
  col*=mix(.72,1.,smoothstep(-.35,.20,p.y));
  col=1.-exp(-col*1.2);
  col+=(h12(fc+17.)-.5)/255.;                 // tramage contre les paliers
  gl_FragColor=vec4(col,1.);
}`;


  /* 2. LA COMPOSITION
     Planete en bas a droite, lune dans la marge de gauche : ce qui doit se
     voir tombe hors des cartes. */
  function plan(w, h) {
    const a = w / h;
    if (a < 1) return { planete: [a / 2 - .12, -.56, .60], lune1: [-a / 2 + .09, .30, .032] };   // telephone
    return { planete: [a / 2 - .30, -.56, .78], lune1: [-a / 2 + .17, .20, .05] };
  }


  /* 3. LA PEINTURE, une fois par taille d ecran et par etat du homelab.
     Rend le canevas WebGL peint, ou null si WebGL manque : le fond d origine
     reste alors en place. */
  function peint(w, h, etat) {
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    while (w * h * dpr * dpr > 5e6) dpr *= .85;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const gl = cv.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    if (!gl) return null;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn("espace.js :", gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn("espace.js :", gl.getProgramInfoLog(pr)); return null; }
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(pr, "a");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    const P = plan(w, h), u = (n) => gl.getUniformLocation(pr, n);
    gl.uniform2f(u("uRes"), W, H);
    gl.uniform1f(u("uDpr"), W / w);
    gl.uniform1f(u("uEtat"), ["ok", "warn", "crit"].indexOf(etat));
    gl.uniform3fv(u("uPlanete"), P.planete);
    gl.uniform3fv(u("uLune1"), P.lune1);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return cv;
  }


  /* 4. CE QUI BOUGE, en HTML par-dessus l image */
  const css = document.createElement("style");
  css.textContent = `
.espace{position:absolute;inset:0;opacity:0;transition:opacity 1.2s ease}
.espace.pret{opacity:1}
.espace-image{position:absolute;left:0;top:0;display:block}
/* Quelques etoiles scintillent, a peine (une sur deux des points tires), sur
   des points fins : le scintillement leger retenu pour les etoiles. */
.espace .scint{position:absolute;width:1.5px;height:1.5px;margin:-1px 0 0 -1px;border-radius:50%;background:#fff;
  box-shadow:0 0 2px 1px rgba(170,200,255,.45);opacity:.4;will-change:opacity;
  animation:esp-scint var(--t) ease-in-out var(--d) infinite alternate}
.espace .scint:nth-child(even){display:none}
@keyframes esp-scint{from{opacity:.4}to{opacity:.8}}
/* Vaisseaux : un vol horizontal, dans un couloir LIBRE mesure sur la page
   (entre la barre et les raccourcis, entre la recherche et les filtres).
   Valable page en haut : le fond est fixe, la page defile par-dessus. */
.espace .vaisseau{position:absolute;left:0;width:48px;height:10px;margin-top:-5px;opacity:0;
  animation:esp-passe var(--duree) linear var(--d) infinite}
.espace .vaisseau .coque{position:absolute;inset:0}
.espace .vaisseau.retour .coque{transform:scaleX(-1)}
.espace .vaisseau i{position:absolute;left:4px;top:4px;width:20px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,transparent,rgba(140,190,255,.55))}
.espace .vaisseau i::after{content:"";position:absolute;right:-1px;top:-1px;width:4px;height:4px;border-radius:50%;
  background:#fff;box-shadow:0 0 4px 2px rgba(130,190,255,.85),0 0 10px 3px rgba(90,150,255,.35)}
.espace .vaisseau svg{position:absolute;left:21px;top:0;width:27px;height:10px}
@keyframes esp-passe{
  0%{opacity:0;transform:translateX(var(--x0))}
  3%,37%{opacity:1}
  40%,100%{opacity:0;transform:translateX(var(--x1))}}
/* LE VERRE SUR LA SCENE. Celui de fond.css (flou 6 px, 2 a 7 % de blanc) est
   regle pour un fond de grands degrades ; sur une scene nette (etoiles, villes,
   bord de planete), le detail passe au travers et gene la lecture. Verre
   ADAPTE : le flou double pour effacer le detail, la couleur passe toujours,
   a peine d ombre dessous. (Ses aretes brillantes sont retirees, point 6.)
   ⚠️ PAS DE VERRE FUME : un essai a flou 18 px, luminosite 78 % et 34 a 42 %
   de teinte sombre etait « beaucoup trop sombre », l aspect verre perdu. */
body.verre-scene :is(.card,.bar,.search,.t .i){
  backdrop-filter:blur(12px) saturate(1.35) brightness(.96);
  -webkit-backdrop-filter:blur(12px) saturate(1.35) brightness(.96);
  background:var(--dalle),linear-gradient(rgba(10,12,26,.08),rgba(10,12,26,.13))}
/* une ombre legere sous le texte des cartes */
body.verre-scene .card{text-shadow:0 1px 1px rgba(0,0,0,.35)}
/* LE GRIS SUR LA SCENE (01/11/2026). Choisi pour un fond sombre et uni, #8a94a6
   passait sous un contraste de 4,5 sur un cinquieme des positions mesurees (chaque
   texte, au fil du defilement, derriere le verre), et jusqu a 1,4 devant le bord
   eclaire de la planete. #b8c2d2, le gris que fond.css donne deja aux boutons de la
   barre : la hierarchie tient, le blanc reste bien au-dessus.
   Les adresses et les sous-titres etaient en plus translucides, alors que ce sont
   les plus petits textes de la page : ils passent au meme gris, opaque. */
body.verre-scene{--mut:#b8c2d2}
body.verre-scene .adr{color:var(--mut)!important}
body.verre-scene .sub2,
body.verre-scene #groups.compact .card:not(:has(.adr)) .head p{color:var(--mut)}
body.verre-scene h2{color:#c4cdda}
/* LE RELIEF, sur TOUT le contenu : la lumiere vient d en haut, comme sur les
   icones des raccourcis et les jauges creusees de fond.css. Pose sur le
   verre : ombre dessous. Creuse : ombre a l interieur, en haut.
   ⚠️ JAMAIS de filter sur un element qui CONTIENT du verre (carte, barre,
   section, page) : il deviendrait la racine du fond et le verre de ses
   enfants passerait au noir (fond.css, paragraphe 2). Le filtre ne va que
   sur des FEUILLES : icones, images, graphiques, reperes. */
/* Intensites baissees d un tiers apres un premier essai juge trop marque. */
/* 1. tout le texte, boutons et champs compris : le navigateur leur retire
   l ombre heritee, d ou la seconde regle.
   ⚠️ Le texte des CARTES garde l ombre douce du verre adapte (posee sur
   .card, elle prime sur celle-ci par heritage) : c est le rendu retenu par
   Alexis. Une TRANCHE (la lettre redoublee un pixel plus bas dans une
   version sombre de sa couleur) a ete essayee et refusee : « c etait mieux
   avant ». Ne pas la reproposer. */
/* ⚠️ OMBRES DOUCES (flou d un pixel), jamais NETTES : sous un trait fin
   (lettre, fleche, coche), une copie sombre decalee d un pixel se lit comme
   un dedoublement. Vu sur la barre de filtres le 01/11/2026. Hors des cartes,
   le texte prend donc l ombre que le verre adapte donne au texte des cartes. */
body.relief :is(main,.dlg),
body.relief :is(main,.dlg) :is(button,input,select,textarea),
body.relief :is(main,.dlg) ::placeholder{text-shadow:0 1px 1px rgba(0,0,0,.35)}
/* pose a meme le fond, sans verre : plus marquee, et un halo sombre en plus.
   (Les pastilles des filtres sont en verre : elles suivent la regle d avant.) */
body.relief :is(.t .l,h2,.fige){text-shadow:0 1px 1px rgba(0,0,0,.55),0 0 6px rgba(0,0,0,.35)}
/* ⚠️ RELIEF SANS AUCUN BLANC, a la demande d Alexis : ni filet clair, ni
   reflet, ni tranche grise sous les icones blanches. Le volume ne vient que
   d ombres sombres : dessous a l exterieur, et au bas des formes a
   l interieur. Ne pas remettre de lumiere. */
/* 2. tout ce qui est dessine : icones, logos, points, reperes. Le filtre suit
   la forme et garde les halos lumineux. Les graphiques et les barres sont a
   part, au point 5. */
body.relief :is(main,.dlg) :is(svg,i,.pt,.ep,img,canvas):not(.gr):not(.batt):not(.b > i){
  filter:drop-shadow(0 1px 1px rgba(0,0,0,.5)) drop-shadow(0 2px 2px rgba(0,0,0,.25))}
/* les points d etat deviennent des billes : leur bas s assombrit (une
   couleur posee en ligne par le script reste mate) */
/* ⚠️ « :is(main,.dlg) .pt » : le texte d une proposition de recherche porte aussi
   la classe pt, et prenait ce degrade en fond, une bande sombre derriere le mot. */
body.relief :is(.dot,.hp .line i,:is(main,.dlg) .pt,.ep,.pil i){background-image:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.3))}
/* 3. les blocs poses sur le verre (pastilles, notes, notifications) : la
   MEME recette que le verre du point 6 bis, a leur echelle. Avec une simple
   ombre dessous, ils detonnaient a cote des cartes en volume. */
body.relief :is(.st,.note,.past span,.wgt,.calme,.pil,.periode .on,.card button,.chk li,.rg .p,.ses span,.faits span,.verdict em,.search .moteur,.fige){box-shadow:
  inset 0 0 0 1px rgba(0,0,0,.18),
  inset 0 -1px 0 rgba(0,0,0,.15),
  inset 0 -6px 8px -7px rgba(0,0,0,.26),
  0 1px 0 rgba(0,0,0,.26),
  0 2px 4px -1px rgba(0,0,0,.2)}
/* 3 bis. RELIEF OU CREUX, la version retenue le 01/11/2026 (classe « final »
   du body) : TOUT LE CONTENU EN RELIEF, sauf les PASTILLES et la carte
   JELLYFIN, creusees. Les rails (jauges, barres, selecteur de periode)
   restent creuses partout, les boutons en relief.
   Essayes avant d y arriver, tous ecartes par Alexis : tout creuser (trop
   sombre a 17 % de noir), un mixte (ce qu on lit creuse, les etiquettes en
   relief), tout en 3D.
   ⚠️ L encadre « tout va bien » (.calme, ex. « Aucune demande en attente »
   de Seerr) et les notes sont du CONTENU, pas des pastilles : en relief.
   « :not(#_) » ne filtre rien : il ajoute le poids d un identifiant, pour
   passer devant des regles plus precises posees plus haut.
   Les regles suivent : le rebord en relief (pastilles d abord, puis le
   reste du contenu), puis les creux. */
/* LE REBORD EN RELIEF : fait d ombres, le meme partout et quel que soit le
   fond. Un degrade sombre, leger en haut et profond en bas, comme l arete
   d un galet vu de dessus ; une arete nette dessous donne l epaisseur, le bas
   s assombrit dedans. Avant : une bordure plate (sombre, verte ou ambre)
   doublee d un anneau, qui changeait d aspect selon ce que le verre de la
   carte laissait passer. La couleur des blocs d etat reste dans leur fond.
   (Rebord en ::after masque en anneau, comme les aretes de fond.css : un
   degrade pose en bordure passerait aussi sous le fond translucide.)
   Ici l encadre « tout va bien » ; les pastilles perdent aussi leur bordure
   mais sont creusees plus bas. */
body.relief :is(.past span,.faits span,.ses span,.verdict em,.calme,.card .pil){
  position:relative;border-color:transparent;
  box-shadow:inset 0 -6px 8px -7px rgba(0,0,0,.3),0 1px 0 rgba(0,0,0,.32),0 2px 4px -1px rgba(0,0,0,.22)}
body.relief .calme::after{
  content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.14),rgba(0,0,0,.52));
  -webkit-mask:var(--anneau);-webkit-mask-composite:xor;mask:var(--anneau);mask-composite:exclude}
/* le RESTE DU CONTENU (chiffres, notes, tuiles d etat, lignes de Securite)
   prend le meme rebord en relief. Neutre, son fond fonce (16 % de noir) le
   detache de la carte : a 4 % de blanc, il s y confondait. */
body.relief.final :is(.st,.note,.wgt,.chk li){position:relative;
  box-shadow:inset 0 -6px 8px -7px rgba(0,0,0,.3),0 1px 0 rgba(0,0,0,.32),0 2px 4px -1px rgba(0,0,0,.22)}
body.relief.final :is(.st,.note,.wgt,.chk li):not(#_){border-color:transparent}
body.relief.final :is(.st,.note,.wgt,.chk li)::after{
  content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.14),rgba(0,0,0,.52));
  -webkit-mask:var(--anneau);-webkit-mask-composite:xor;mask:var(--anneau);mask-composite:exclude}
/* (.chk li.ok n est pas une couleur : la ligne « ok » de Securite est neutre) */
body.relief.final :is(.st,.note,.wgt):not(.ok):not(.wn):not(.on),
body.relief.final .chk li:not(.wn){background-color:rgba(0,0,0,.16)}
/* LES CREUX : les rails des barres ; les PASTILLES, sans leur rebord ; la
   carte JELLYFIN (tuiles films / series / episodes, note). Recette de ses
   creux, reprise telle quelle : fond a peine plus sombre que le verre (6 %),
   c est l ombre interieure qui fait le creux, pas la couleur. Les pastilles
   colorees gardent leur teinte. */
body.relief.final .rg .p{background:rgba(0,0,0,.1);box-shadow:inset 0 1px 2px rgba(0,0,0,.3),inset 0 0 0 1px rgba(0,0,0,.1)}
body.relief.final :is(.past span,.faits span,.ses span,.verdict em,.card .pil){
  box-shadow:inset 0 1px 2px rgba(0,0,0,.3),inset 0 0 0 1px rgba(0,0,0,.1)}
body.relief.final :is(.past span,.faits span,.ses span,.verdict em,.card .pil)::after{content:none}
body.relief.final :is(.past span,.faits span,.verdict em,.card .pil):not(.ok):not(.wn):not(.cr):not(.crit):not(.inc),
body.relief.final .ses span.vide{background-color:rgba(0,0,0,.06)}
body.relief.final .card[data-carte="jellyfin"] :is(.st,.note){box-shadow:inset 0 1px 2px rgba(0,0,0,.3),inset 0 0 0 1px rgba(0,0,0,.1)}
body.relief.final .card[data-carte="jellyfin"] :is(.st,.note)::after{content:none}
body.relief.final .card[data-carte="jellyfin"] :is(.st,.note):not(.ok):not(.wn):not(.on){background-color:rgba(0,0,0,.06)}
body.relief.final .card[data-carte="jellyfin"] :is(.st,.note):is(.ok,.wn){
  background-image:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.08) 70%);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.12)}
/* LES BLOCS COLORES n ont pas de TRAIT DE COULEUR, mais le MEME contour
   sombre que les blocs neutres (l anneau des creux, ou le rebord). Leur
   couleur reste dans le fond. Concerne la tuile active de WireGuard (vert),
   les lignes de Securite en alerte et l avertissement des mises a jour.
   ⚠️ Essayes puis annules le 01/11/2026 : retirer toutes les bordures des
   creux, et retirer l anneau ou le rebord des blocs colores. Ne pas les
   reproposer sans demander a Alexis. */
body.relief :is(.wgt.on,.chk li.wn,.st:is(.ok,.wn),.note:is(.ok,.wn),.motif):not(#_){border-color:transparent}
/* LES CREUX COLORES : sur une teinte, l ombre du haut ne suffisait pas a lire
   un creux. La teinte, plus claire que le verre de la carte, faisait
   paraitre le bloc POSE dessus. Leur fond s assombrit donc du haut vers le
   bas, comme un puits ; la teinte reste dessous. (Compare a la loupe avec le
   creux simple et le relief : c est le seul qui se lit en creux.) */
body.relief.final :is(.past span,.faits span,.verdict em,.card .pil):is(.ok,.wn,.cr,.crit,.inc),
body.relief.final .ses span:not(.vide),
body.relief .dlg .motif:not(#_){background-image:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.08) 70%);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.12)}
/* 3 ter. PLUS DE BORDURE BLANCHE : separateurs et contours fins (pastilles
   d incident, selecteur de periode, boutons du PC, lignes du journal, des
   disques, de Securite, separateurs de la barre) deviennent sombres, graves
   dans le verre. Les bordures colorees (ambre, rouge) gardent leur couleur.
   Restent clairs les traits qui DESSINENT quelque chose : la fleche
   « ouvrir » (.ouvre) et le repere du jour (.jours .b). */
body.relief :is(.pcb button,.t button.e,.jr > div,.jx .cr,.jx .ok,.dqs .dq,.dqb,.blocs .libre,.bar .met,.chk li,.periode,.pil):not(.wn):not(.inc):not(.crit){
  border-color:rgba(0,0,0,.28)}
/* 4. creuse : les rails des jauges ; leur remplissage s assombrit en bas,
   comme un tube */
body.relief :is(.jauge-b,.tr):not(.vide){box-shadow:inset 0 1px 2px rgba(0,0,0,.45)}
body.relief :is(.jauge-b i,.tr i){box-shadow:inset 0 -1px 0 rgba(0,0,0,.22),inset 0 -2px 2px rgba(0,0,0,.12)}
/* 5. les graphiques et leurs barres : ombre au bas de la forme, dedans, et
   un liseré d ombre qui ne depasse que dessous.
   ⚠️ Pas d ombre portee pleine : sous une barre posee sur l axe elle ne se
   voit pas, et sous une barre translucide (les visites) elle apparaissait A
   TRAVERS, comme une tache decalee. Graphiques SVG : filtre #esp-biseau
   (pose par le script) ; barres HTML : l ombre en bas, dedans. */
body.relief :is(svg.gr,svg.batt){filter:url(#esp-biseau)}
body.relief .b > i{box-shadow:inset 0 -1px 0 rgba(0,0,0,.22),inset 0 -3px 3px -1px rgba(0,0,0,.15)}
/* 6. LE VERRE SANS REFLET BLANC, a la demande d Alexis : plus d arete
   speculaire (::after des cartes, de la barre, de la recherche, des icones,
   des pastilles, des fleches et des fenetres), plus de filet clair dans les
   ombres du verre. Ses ombres sombres restent, et sa dalle aussi : c est
   elle qui fait voir le verre.
   ⚠️ Les pastilles des filtres sont ciblees par #filters dans fond.css
   (specificite 1,1,1 et 1,2,1 pour .on) : d ou l identifiant repris ici. */
/* (sauf le soulignement du bouton Compact, qui dit s il est actif : c est
   lui aussi un ::after) */
body.relief :is(.card,.bar,.search,.t .i,.fl,.filters button:not(#compact),.filters > span,.panneau button,dialog.dlg)::after{opacity:0}
body.relief :is(#filters,.filters)::before{background-image:none;box-shadow:none}
body.relief h2 svg{box-shadow:0 1px 2px rgba(0,0,0,.26),0 5px 12px -7px rgba(0,0,0,.42),inset 0 -1px 0 rgba(0,0,0,.28)}
/* 6 bis. LE VOLUME DU VERRE, sans son arete brillante : tout en ombres.
   - un contour sombre d un pixel, dedans : la forme du panneau ;
   - un liseré sombre en bas : la tranche de la dalle ;
   - le bas qui s assombrit en douceur : la dalle parait bombee ;
   - une ombre portee plus dense mais COURTE (7 px au plus, 9 au survol) :
     fond.css explique pourquoi, les cartes sont espacees de 11 a 13 px et
     l ombre d une voisine se verrait a travers le verre.
   Intensites baissees d un quart apres un essai « un poil trop prononce ». */
body.relief :is(.card,.bar,.search,.search:focus-within){box-shadow:
  inset 0 0 0 1px rgba(0,0,0,.21),
  inset 0 -2px 0 rgba(0,0,0,.15),
  inset 0 -16px 22px -18px rgba(0,0,0,.32),
  0 1px 0 rgba(0,0,0,.32),
  0 3px 6px -1px rgba(0,0,0,.25),
  0 8px 14px -8px rgba(0,0,0,.35)}
body.relief :is(a.card,.card.clic):hover{box-shadow:
  inset 0 0 0 1px rgba(0,0,0,.21),
  inset 0 -2px 0 rgba(0,0,0,.15),
  inset 0 -16px 22px -18px rgba(0,0,0,.32),
  0 1px 0 rgba(0,0,0,.32),
  0 4px 8px -1px rgba(0,0,0,.3),
  0 10px 16px -8px rgba(0,0,0,.42)}
/* les petites tuiles (icones des raccourcis, pastilles de filtres, fleches) :
   la meme recette, a leur echelle */
body.relief :is(.t .i,.fl){box-shadow:
  inset 0 0 0 1px rgba(0,0,0,.21),
  inset 0 -2px 0 rgba(0,0,0,.15),
  inset 0 -9px 12px -10px rgba(0,0,0,.32),
  0 1px 0 rgba(0,0,0,.32),
  0 3px 6px -2px rgba(0,0,0,.3)}
/* LA BARRE DE FILTRES, SANS CONTOUR (demande du 01/11/2026) : ni anneau
   sombre, ni tranche, ni trait colore. Le volume tient au bombe et a une
   ombre douce dessous. Les pastilles d incident gardent leur sens par une
   teinte rouge ou ambre, en plus de leur point.
   ⚠️ Pas de matiere pleine bleu nuit non plus (essayee le 01/11/2026 pour un
   rendu identique sur tout fond, jugee « moche ») : elles restent en verre.
   ⚠️ « .filters > span » et pas « .filters span » : la pastille de la cloche
   est le SEUL span enfant direct. Le second selecteur prenait aussi le nom
   du menu (« Tout »), le support de la cloche et le compteur, qui portaient
   alors un rectangle sombre. */
body.relief :is(#filters button,.filters button,.filters > span,.filters .pil),
body.relief #filters button.on{border-color:transparent;box-shadow:
  inset 0 -7px 9px -8px rgba(0,0,0,.3),
  0 2px 6px -1px rgba(0,0,0,.32)}
body.relief #filters .pil.crit{background-color:rgba(255,69,58,.16)}
body.relief #filters .pil.inc{background-color:rgba(255,159,10,.14)}
/* LES MENUS DEROULANTS, DANS LA MATIERE DE LEUR PARENT (01/11/2026) : ils
   detonnaient avec leurs fonds presque opaques et leurs anneaux blancs.
   - les listes de la recherche (moteurs, propositions) prennent le verre de la
     barre : meme dalle, meme volume, contour sombre compris ;
   - le menu des groupes prend celui de son bouton : bombe, ombre douce, sans
     contour ; il garde sa teinte de fond.css.
   Tous passent au-dessus des cartes, dont le texte ne doit pas se lire au
   travers : flou plus fort, un voile sombre de plus, et la grande ombre portee
   d un element qui flotte.
   Dedans, tout pareil et sans blanc : un choix survole ou actif devient un bloc
   en relief, le moteur choisi garde sa teinte bleue.
   ⚠️ Ces listes sont dans body, hors de main : les regles de relief du point 1
   et du point 2 ne les atteignent pas, d ou leurs ombres de texte et de logo. */
body.relief :is(#moteurs,#propositions){
  background:var(--dalle),linear-gradient(rgba(10,12,26,.34),rgba(10,12,26,.4));
  backdrop-filter:blur(20px) saturate(1.35) brightness(.96);
  -webkit-backdrop-filter:blur(20px) saturate(1.35) brightness(.96);
  text-shadow:0 1px 1px rgba(0,0,0,.35);
  box-shadow:
    inset 0 0 0 1px rgba(0,0,0,.21),
    inset 0 -2px 0 rgba(0,0,0,.15),
    inset 0 -16px 22px -18px rgba(0,0,0,.32),
    0 1px 2px rgba(0,0,0,.34),
    0 16px 34px -14px rgba(0,0,0,.62)}
body.relief #filters .panneau{
  background-image:var(--dalle);
  box-shadow:
    inset 0 -16px 22px -18px rgba(0,0,0,.32),
    0 1px 2px rgba(0,0,0,.34),
    0 16px 34px -14px rgba(0,0,0,.62)}
body.relief :is(#moteurs li.actif,#moteurs li[role="option"]:hover,#propositions li[aria-selected="true"],#propositions li:not(.sep):hover){
  background:rgba(0,0,0,.2);
  box-shadow:inset 0 -6px 8px -7px rgba(0,0,0,.26),0 1px 3px rgba(0,0,0,.24)}
body.relief #moteurs li[aria-selected="true"]{
  background:rgba(77,151,238,.16);
  box-shadow:inset 0 -6px 8px -7px rgba(0,0,0,.26),0 1px 3px rgba(0,0,0,.24)}
body.relief #moteurs li[aria-selected="true"]:is(.actif,:hover){background:rgba(77,151,238,.24)}
body.relief #propositions li.sep{background:rgba(0,0,0,.28)}
body.relief #moteurs .pastille{background:rgba(0,0,0,.16);
  box-shadow:inset 0 -5px 7px -6px rgba(0,0,0,.28),0 1px 2px rgba(0,0,0,.26)}
body.relief :is(#moteurs svg,#propositions .pi :is(svg,img)){filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
/* le bouton du moteur, dans la barre : un bloc en relief comme les autres, sans voile blanc */
body.relief .search .moteur{background:rgba(0,0,0,.16)}
body.relief .search .moteur:is(:hover,[aria-expanded="true"]){background:rgba(0,0,0,.26)}
/* les choix du menu des groupes : a plat, puis comme ceux des deux autres listes */
@media (max-width:980px){
  body.relief #filters .panneau button:not(#menu):not(#compact){box-shadow:none}
  body.relief #filters .panneau button:not(#menu):not(#compact):is(:hover,:active):not(#_){background:rgba(0,0,0,.2);
    box-shadow:inset 0 -6px 8px -7px rgba(0,0,0,.26),0 1px 3px rgba(0,0,0,.24)}
}
/* LE TEXTE AU MILIEU. Boite centree, mais la police garde de la place au-
   dessus des lettres (accents) : « Tout » paraissait 1 a 2 px trop bas. Le
   texte remonte d un pixel, les icones et les points ne bougent pas.
   (Le rognage text-box ne remontait que d un demi-pixel, et seulement sur
   un span, pas sur un texte pose directement dans un bouton.) */
body.relief #filters :is(.menu-nom,.n,.pil b){position:relative;top:-1px}
/* (un pixel de rembourrage passe du haut au bas : la hauteur ne change pas) */
@media (min-width:981px){
  body.relief #filters .panneau button:not(#menu):not(#compact),
  body.relief #filters #compact{padding-top:calc(.34rem - 1px);padding-bottom:calc(.34rem + 1px)}
}
@media (max-width:980px){
  body.relief #filters #compact{padding-top:0;padding-bottom:2px}
  body.relief #filters .panneau button:not(#menu):not(#compact){padding-top:calc(.62rem - 1px);padding-bottom:calc(.62rem + 1px)}
}
body.relief #filters #compact svg{translate:0 1px}
body.relief dialog.dlg{box-shadow:
  inset 0 0 0 1px rgba(0,0,0,.22),
  inset 0 -2px 0 rgba(0,0,0,.16),
  inset 0 -24px 30px -26px rgba(0,0,0,.34),
  0 1px 2px rgba(0,0,0,.36),
  0 24px 60px -18px rgba(0,0,0,.72),
  0 64px 128px -44px rgba(0,0,0,.62)}
/* 7. LES EMOJI ET LA COCHE : une ombre de texte dedouble ces caracteres (le
   systeme les dessine en emoji). La coche des encadres « tout va bien »
   (.k, dans sa pastille ronde), celle du chiffre des sondes (b.ok) et les
   emoji de la fenetre Mises a jour (avertissement, sablier, coche verte)
   prennent leur ombre par un filtre, qui suit leur vraie forme. Ce sont des
   feuilles, sans verre dedans. */
body.relief :is(.k,b.ok,.dlg #mst,.dlg .motif > div){text-shadow:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.45))}
/* 7 bis. JAMAIS DEUX OMBRES SUR UN TEXTE, regle generale (01/11/2026) : un
   texte pose dans un element qui porte deja une ombre en filtre (icones,
   points, graphiques, coches) perd son ombre de texte. Sinon le filtre
   ombrait le texte ET son ombre, et le caractere paraissait dedouble : vu
   sur la coche, puis sur la fleche « → » entre deux versions, dans un <i>
   que la regle des icones prenait pour une icone.
   Un <i> qui contient du texte prend l ombre unique de la coche. */
body.relief :is(main,.dlg) :is(svg,i,.pt,.ep,.chev),
body.relief :is(main,.dlg) :is(svg,i,.pt,.ep,.k,b.ok,.chev) *{text-shadow:none}
body.relief :is(main,.dlg) i:not(:empty):not(.b > i){filter:drop-shadow(0 1px 1px rgba(0,0,0,.45))}
/* 8. LES FENETRES, meme partage que les cartes (releve du 01/11/2026 sur
   raccourci, mises a jour, conteneurs, acces, journal, graphe, disque,
   espace, PC).
   - En relief : tout ce qui se clique (boutons, croix, filtres du journal,
     modes des mises a jour) et les etiquettes (pastilles des acces, des
     requetes). Le bouton de periode inactif reste a plat dans son rail.
   - Creuse : ce qu on remplit ou qu on lit (champs, cases, lignes a cocher,
     avertissement, code d erreur, tuiles de mesure des disques) et les
     rails (barres de memoire, selecteur de periode). */
body.relief .dlg button:not([data-per]),
body.relief dialog.dlg > button.dlg-x,
body.relief :is(.dlg .mode,.acm span,.hist .rq){box-shadow:
  inset 0 0 0 1px rgba(0,0,0,.18),
  inset 0 -1px 0 rgba(0,0,0,.15),
  inset 0 -6px 8px -7px rgba(0,0,0,.26),
  0 1px 0 rgba(0,0,0,.26),
  0 2px 4px -1px rgba(0,0,0,.2)}
body.relief .dlg button:disabled{box-shadow:none}
/* leurs bordures blanches passent au sombre ; les colorees (rouge, ambre,
   vert, bleu) gardent leur couleur, elle porte un sens */
body.relief .dlg button:not([data-per]):not(.danger):not(.go):not(.ok):not(.auto),
body.relief .dlg button.go:disabled,
body.relief :is(.dlg .mode,.acm span,.hist .rq):not(.auto):not(.ri),
body.relief :is(.st,.note,.wgt):not(.ok):not(.wn):not(.on){border-color:rgba(0,0,0,.28)}
/* creuse */
body.relief .dlg :is(input:not([type=checkbox]):not([type=file]),textarea,select,code,.motif,.dtu),
body.relief .hist input[type=checkbox]:not(:checked),
body.relief :is(.majl,.hist) li.att:not(:has(:checked)){box-shadow:inset 0 1px 2px rgba(0,0,0,.3),inset 0 0 0 1px rgba(0,0,0,.1)}
body.relief .dlg :is(input:not([type=checkbox]):not([type=file]),textarea,select,code,.dtu),
body.relief .hist input[type=checkbox]:not(:checked){background-color:rgba(0,0,0,.08);border-color:rgba(0,0,0,.28)}
body.relief :is(.majl,.hist) li.att:not(:hover):not(:has(:checked)){background-color:rgba(0,0,0,.06);border-color:transparent}
/* le champ qui a la main : un contour bleu, pas blanc.
   ⚠️ « :not(#_) » pour passer devant la regle des creux juste au-dessus, plus
   precise : sans lui, le trait sombre recouvrait le bleu et le champ actif ne
   se distinguait plus (defaut trouve le 01/11/2026). */
body.relief .dlg :is(input,textarea,select):focus:not(#_){border-color:rgba(77,151,238,.65)}
/* les rails : barres de memoire des conteneurs, selecteur de periode (son
   bouton actif reste en relief, comme un curseur dans sa glissiere) */
body.relief :is(.grp-h .gb,.periode){background-color:rgba(0,0,0,.1);box-shadow:inset 0 1px 2px rgba(0,0,0,.35)}
body.relief :is(.acb i,.gb i,.gb u){box-shadow:inset 0 -1px 0 rgba(0,0,0,.22)}
/* les separateurs, graves */
body.relief :is(.grp-h,details.grp:not([open])>summary.grp-h){border-bottom-color:rgba(0,0,0,.3)}
body.relief :is(.ln+.ln,.ln.lnh,.jr>div,.jx>div,.dint>div,.acr,.acx-b,.dpt>*,.dkv>*){border-color:rgba(0,0,0,.3)}
/* les chevrons dessines au trait : une ombre comme les icones */
body.relief .chev{filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
/* LE JOURNAL, dans sa fenetre : chaque evenement dans son propre creux, comme
   les lignes de Securite. Avec de simples separateurs, la premiere ligne de
   chaque jour n en avait pas au-dessus, et certaines lignes paraissaient
   encadrees, d autres non. (Pas dans la carte : sa hauteur est comptee par
   le rangement, des ecarts en plus la feraient deborder.) */
body.relief .dlg .jx{gap:5px}
body.relief .dlg .jx>div{border:0;border-radius:8px;padding:7px 10px;background:rgba(0,0,0,.06);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.3),inset 0 0 0 1px rgba(0,0,0,.1)}
/* (version retenue : les evenements en relief, comme le reste du contenu) */
body.relief.final .dlg .jx>div{position:relative;background:rgba(0,0,0,.12);
  box-shadow:inset 0 -6px 8px -7px rgba(0,0,0,.3),0 1px 0 rgba(0,0,0,.32),0 2px 4px -1px rgba(0,0,0,.22)}
/* Ses espacements, sur une echelle reguliere (mesures du 01/11/2026 : le
   titre du jour etait COLLE a ses lignes, 0 px, avec 20 px au-dessus, et se
   lisait avec le jour d avant ; le haut de la fenetre alternait 10, 15 et
   6 px). Titre et sous-titre forment une paire serree, puis 14 px avant les
   filtres, 16 avant la liste ; le titre du jour a 8 px sous lui et 18 au-
   dessus, aligne sur le texte des lignes (leur rembourrage, 10 px). */
body.relief #dlg:has(.jx) > h3{margin-bottom:6px}
body.relief #dlg:has(.jx) > .sub{margin-bottom:0}
body.relief #dlg:has(.jx) .jf{margin:14px 0 0}
body.relief #dlg:has(.jx) > .scroll{margin-top:16px}
body.relief #dlg:has(.jx) .psec{margin:18px 10px 8px}
body.relief #dlg:has(.jx) .psec:first-child{margin-top:0}
/* Changement d etat : la scene repeinte se pose par-dessus en fondu de 2,4 s,
   la duree de l ancien fond. */
.espace .espace-image.fondu{opacity:0;transition:opacity 2.4s ease}
.espace .espace-image.fondu.visible{opacity:1}
@media (max-width:700px){.espace .vaisseau{display:none}}
@media (prefers-reduced-motion:reduce){.espace *,.espace *::after{animation:none!important}.espace .vaisseau{display:none}}`;
  document.head.append(css);

  // Le biseau des graphiques (relief, point 5), en ombres seules : le bas de
  // chaque forme s assombrit dedans (la forme moins elle-meme remontee d un
  // pixel), et un liseré d ombre ne depasse QUE dessous (operateur out), pour
  // ne pas assombrir les aires translucides par transparence.
  // ⚠️ Plus de reflet speculaire : le relief est fait SANS blanc.
  document.body.insertAdjacentHTML("beforeend", `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<filter id="esp-biseau" x="-2%" y="-10%" width="104%" height="125%" color-interpolation-filters="sRGB">
  <feOffset in="SourceAlpha" dy="-1" result="remonte"/>
  <feComposite in="SourceAlpha" in2="remonte" operator="out" result="basDedans"/>
  <feFlood flood-color="#000" flood-opacity=".3"/>
  <feComposite in2="basDedans" operator="in" result="ombreDedans"/>
  <feOffset in="SourceAlpha" dy="1" result="decale"/>
  <feComposite in="decale" in2="SourceAlpha" operator="out" result="bord"/>
  <feFlood flood-color="#000" flood-opacity=".38"/>
  <feComposite in2="bord" operator="in" result="ombre"/>
  <feMerge><feMergeNode in="ombre"/><feMergeNode in="SourceGraphic"/><feMergeNode in="ombreDedans"/></feMerge>
</filter></svg>`);

  // Vaisseau sans contour : coque sombre, eclairee par le haut (le soleil),
  // un aileron, et un reacteur qui brille. Les identifiants de degrade
  // different d un vaisseau a l autre.
  const VAISSEAU = (k) => `<span class="coque"><i></i><svg viewBox="0 0 27 10" aria-hidden="true">
  <defs><linearGradient id="esp-v${k}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9aaed6"/><stop offset=".4" stop-color="#2b3454"/><stop offset="1" stop-color="#0a0e1b"/></linearGradient></defs>
  <path d="M1 5.5 4 3.7 13 3 22 4.3 26 5.2 22 6.1 13 6.9 4 6.6Z" fill="url(#esp-v${k})"/>
  <path d="M10 3.2 15 1.4 17 3.5Z" fill="#232b47"/></svg></span>`;

  const espace = document.createElement("div");
  espace.className = "espace";
  const image = document.createElement("canvas");
  image.className = "espace-image";
  espace.append(image);
  aurora.append(espace);

  // positions tirees une fois pour toutes, toujours les memes
  let graine = 7;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const tirage = Array.from({ length: 28 }, () => [hasard(), hasard(), hasard(), hasard()]);

  // Le milieu de l espace libre entre deux elements, page en haut ; null s il
  // n y a pas la place de passer.
  function couloir(dessus, dessous) {
    if (!dessus || !dessous) return null;
    const y0 = dessus.getBoundingClientRect().bottom + scrollY;
    const y1 = dessous.getBoundingClientRect().top + scrollY;
    return y1 - y0 >= 16 ? (y0 + y1) / 2 : null;
  }
  function couloirs() {
    const fige = document.getElementById("fige");
    const haut = fige && fige.offsetHeight ? fige : document.getElementById("bar");
    const recherche = document.querySelector(".search");
    return [couloir(haut, document.querySelector(".racc")), couloir(recherche, recherche && recherche.nextElementSibling)];
  }
  function placeVaisseaux() {
    const ys = couloirs();
    espace.querySelectorAll(".vaisseau").forEach((v, k) => {
      if (ys[k] == null) v.style.display = "none";
      else { v.style.display = ""; v.style.top = ys[k].toFixed(0) + "px"; }
    });
  }

  function decore(w, h) {
    let html = "";
    for (const [x, y, t, d] of tirage) {
      const px = x * w, py = y * h * .55;
      html += `<span class="scint" style="left:${px.toFixed(0)}px;top:${py.toFixed(0)}px;--t:${(2.5 + t * 4).toFixed(1)}s;--d:${(-d * 6).toFixed(1)}s"></span>`;
    }
    html += `<div class="vaisseau" style="--duree:75s;--d:6s;--x0:-60px;--x1:${w + 20}px">${VAISSEAU(0)}</div>`;
    html += `<div class="vaisseau retour" style="--duree:95s;--d:38s;--x0:${w + 20}px;--x1:-60px">${VAISSEAU(1)}</div>`;
    for (const e of [...espace.children]) if (e !== image) e.remove();
    image.insertAdjacentHTML("afterend", html);
    placeVaisseaux();
  }
  // La barre et les raccourcis se remplissent apres coup (donnees chargees) :
  // le couloir est remesure au depart de chaque passage, vaisseau invisible.
  for (const ev of ["animationstart", "animationiteration"])
    espace.addEventListener(ev, (e) => { if (e.target.classList.contains("vaisseau")) placeVaisseaux(); });

  // L etat montre : celui que pose app.js (`data-sante`, deja relu du
  // navigateur au chargement).
  const etatCourant = () => {
    const e = document.body.dataset.sante;
    return e === "warn" || e === "crit" ? e : "ok";
  };
  let taille = [0, 0], etatPeint = null, fondu = null;
  // Acheve tout de suite un fondu en cours : son image passe dans `image`.
  function finFondu() {
    if (!fondu) return;
    clearTimeout(fondu.minuterie);
    image.getContext("2d").drawImage(fondu.cv, 0, 0);
    fondu.cv.remove();
    fondu = null;
  }
  function dessine(enFondu) {
    const w = aurora.clientWidth, h = aurora.clientHeight;
    if (!w || !h) return;
    const e = etatCourant();
    const cv = peint(w, h, e);
    if (!cv) return;
    finFondu();
    // Changement d etat a taille egale : la nouvelle scene va dans un second
    // canevas pose par-dessus, qui apparait en fondu puis remplace l image.
    const parDessus = enFondu && image.width === cv.width && image.height === cv.height;
    const cible = parDessus ? document.createElement("canvas") : image;
    cible.width = cv.width;
    cible.height = cv.height;
    cible.style.width = w + "px";
    cible.style.height = h + "px";
    cible.getContext("2d").drawImage(cv, 0, 0);
    const perte = cv.getContext("webgl").getExtension("WEBGL_lose_context");
    if (perte) perte.loseContext();
    etatPeint = e;
    espace.dataset.etat = e;
    if (parDessus) {
      cible.className = "espace-image fondu";
      image.after(cible);
      void cible.offsetWidth;                 // part bien de l opacite 0
      cible.classList.add("visible");
      fondu = { cv: cible, minuterie: setTimeout(finFondu, 2500) };
      return;
    }
    taille = [w, h];
    decore(w, h);
    espace.classList.add("pret");
  }
  dessine();
  new MutationObserver(() => { if (etatCourant() !== etatPeint) dessine(true); })
    .observe(document.body, { attributes: true, attributeFilter: ["data-sante"] });
  addEventListener("load", placeVaisseaux);
  // Les cartes arrivent apres coup et changent la hauteur de la page : les
  // couloirs des vaisseaux sont remesures a chaque fois.
  let remesure = 0;
  new ResizeObserver(() => {
    clearTimeout(remesure);
    remesure = setTimeout(placeVaisseaux, 250);
  }).observe(document.querySelector("main"));

  // Redessine si la largeur change, ou la hauteur de plus de 15 % : la barre
  // d adresse d un telephone qui se replie ne doit pas tout repeindre.
  let attente = 0;
  addEventListener("resize", () => {
    clearTimeout(attente);
    attente = setTimeout(() => {
      const w = aurora.clientWidth, h = aurora.clientHeight;
      if (w !== taille[0] || Math.abs(h - taille[1]) > taille[1] * .15) dessine();
      else placeVaisseaux();
    }, 300);
  });

})();
