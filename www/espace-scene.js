/* espace-scene.js — la peinture de la scene (espace.js), dans un travailleur.
   Sur le fil principal, elle figeait la page : 80 a 100 ms avec une carte
   graphique, plus de 10 s sans (WebGL logiciel, 46 s de script dans Lighthouse
   mobile). Ici la page reste libre, quelle que soit la machine.
   Recoit { n, w, h, dpr, etat, enFondu } et rend la meme demande avec `image`, une
   ImageBitmap, ou null si WebGL manque. */
(() => {
  "use strict";

  /* 1. LE SHADER
     Unites de scene : la hauteur de l ecran vaut 1, l origine est au centre,
     y vers le haut. Les positions arrivent de `plan()`. */
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
     Rend le canevas WebGL peint, ou null si WebGL manque. */
  function peint(w, h, etat, dprEcran) {
    let dpr = Math.min(dprEcran || 1, 2);
    while (w * h * dpr * dpr > 5e6) dpr *= .85;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    const cv = new OffscreenCanvas(W, H);
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

  self.onmessage = ({ data: d }) => {
    const cv = peint(d.w, d.h, d.etat, d.dpr);
    if (!cv) return self.postMessage({ ...d, image: null });
    /* ⚠️ RECOPIEE EN 2D AVANT DE RENDRE LE CONTEXTE : une image prise directement
       sur le canevas WebGL en depend encore, et sortait toute noire une fois le
       contexte rendu. */
    const copie = new OffscreenCanvas(cv.width, cv.height);
    copie.getContext("2d").drawImage(cv, 0, 0);
    const image = copie.transferToImageBitmap();
    const perte = cv.getContext("webgl").getExtension("WEBGL_lose_context");
    if (perte) perte.loseContext();
    self.postMessage({ ...d, image }, [image]);
  };
})();
