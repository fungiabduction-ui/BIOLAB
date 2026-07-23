/* ============================================================
   BIOLAB ENGINE v3 — MÓDULO CILAB (Lab analítico)
   cilab_app.js — Conocimiento metabólico, motor de análisis,
                  grafo SVG, biblioteca biológica, ensayos.
   ============================================================
   Reglas:
     · IIFE estricta. Sin globales fuera del closure.
     · Funciones llamadas desde HTML inline → Object.assign(window,…).
     · Listeners/timers/RAF se limpian en window.onModuleUnload.
     · Lecturas cross-módulo: guard typeof + fallback a localStorage.
     · No toca bl2_forms ni bl2_ings. Escribe sólo sus 3 keys propios.
   ============================================================ */

'use strict';

(function () {
'use strict';

// ════════════════════════════════════════════
// CONSTANTES DE STORAGE
// ════════════════════════════════════════════
const K = {
  // Lectura (otros módulos — no escribir)
  ings:        'bl2_ings',
  forms:       'bl2_forms',
  experimentos:'bl2_experimentos',
  cultivos:    'bl2_cultivos',
  geV4:        'biolab.ge.v4',
  // Escritura propia
  meta:        'bl2_lab_meta',          // LEGACY read-only: metadata biologica previa a ing.bio
  obs:         'bl2_lab_obs',           // observaciones de ensayo
  strainRng:   'bl2_lab_strain_ranges', // rangos sugeridos/aplicados por cepa
};

const ASP_COLORS = {
  'Solvente':    '#44AAFF',
  'Soporte':     '#A0A0A0',
  'Carbono':     '#70AD47',
  'Nitrógeno':   '#7C6FFF',
  'Mineral':     '#ED7D31',
  'Cofactores':  '#FF6B35',
};

let _ingDetailDirty = false;

// ════════════════════════════════════════════
// CONOCIMIENTO METABÓLICO — base científica fija
// 8 rutas en 4 niveles. NO editable por el usuario.
// ════════════════════════════════════════════
const ROUTES = [
  // ── N0 — condición ambiental ──
  {
    id: 'N0_GRADIENT', level: 0, weight: 12,
    name: 'Gradiente nutricional',
    short: 'Gradiente',
    icon: '↘',
    color: '#A0A0A0',
    pos: [410, 100],
    summary: 'Define la dirección del crecimiento. Sin esto, el micelio se ramifica radialmente (tomentoso) en vez de avanzar polarizado.',
    mechanism: 'Señal direccional del crecimiento. El almidón de liberación lenta y la levadura no autolizada crean un gradiente de nutrientes en el agar que el micelio sigue con dominancia apical. Sin gradiente — aunque las demás rutas estén activas — el micelio crece radialmente: tomentosidad.',
    consequence: { activa: 'Dominancia apical, crecimiento direccional.', inactiva: 'Crecimiento radial, tomentosidad, pérdida de polaridad.' },
    activators: [
      { name: /almid[oó]n/i },
      { name: /levadura(?!.*aut)/i },
      { name: /peptona\s*de\s*soja/i },
    ],
  },

  // ── N1 — base energética ──
  {
    id: 'N1_GLYC', level: 1, weight: 10,
    name: 'Glucólisis → Krebs → ATP',
    short: 'ATP base',
    icon: '⚡',
    color: '#FFC000',
    pos: [255, 240],
    summary: 'Procesa el carbono y produce ATP. Es la base energética para todo lo demás — sin esto, ninguna otra ruta puede operar.',
    mechanism: 'El carbono entra por glucólisis, se procesa en Krebs y genera NADH/FADH₂ + ATP. Sin ATP abundante ninguna ruta de N2 o N3 puede operar. La tiamina (B1) es cofactor crítico del complejo piruvato deshidrogenasa.',
    consequence: { activa: 'Energía abundante para todas las rutas downstream.', inactiva: 'Inanición energética, todo el sistema queda limitado.' },
    activators: [
      { name: /sacarosa|gluc(?:osa|s)|fructosa|dextr|maltosa|miel|melaza|remolacha/i },
      { name: /malta/i },
      { name: /tiamina|B1|pharmaton/i, role: 'cofactor PDH' },
    ],
  },
  {
    id: 'N1_ETC', level: 1, weight: 12,
    name: 'Cadena respiratoria (ETC)',
    short: 'ETC',
    icon: '⛓',
    color: '#FF6B35',
    pos: [555, 240],
    summary: 'Convierte NADH en ATP usando oxígeno. Sin esto: fermentación obligada, micelio débil y de baja eficiencia.',
    mechanism: 'Convierte NADH/FADH₂ en ATP vía gradiente de protones. Requiere Cu, Mn, Fe como cofactores de los complejos I-IV. ⚠ ALERTA CRÍTICA: el exceso de NO inhibe el Complejo IV (citocromo c oxidasa) reduciendo paradójicamente el ATP disponible — fenómeno central en la sobredosis de arginina.',
    consequence: { activa: 'Producción aerobia óptima de ATP.', inactiva: 'Fermentación obligada, baja eficiencia, micelio débil.' },
    activators: [
      { name: /pharmaton|cobre|hierro|manganeso|fe.*sulfato|cu.*sulfato/i },
      { name: /sulfato\s*de\s*magnesio/i, role: 'cofactor Mg²⁺' },
    ],
  },

  // ── N2 — señales morfogenéticas ──
  {
    id: 'N2_ODC', level: 2, weight: 15,
    name: 'Síntesis de poliaminas (ODC)',
    short: 'ODC',
    icon: '⊕',
    color: '#7C6FFF',
    pos: [255, 410],
    summary: 'Produce poliaminas (espermidina). Estabilizan el Spitzenkörper y mantienen la polaridad apical.',
    mechanism: 'Arginina → ornitina → putrescina → espermidina vía ornitín-decarboxilasa (ODC). La ODC requiere PLP (vitamina B6) como cofactor obligatorio; el zinc activa los factores de transcripción que la regulan. Las poliaminas estabilizan el gradiente de Ca²⁺ en el Spitzenkörper, manteniendo polaridad apical.',
    consequence: { activa: 'Spitzenkörper estable, polaridad apical fuerte.', inactiva: 'Pérdida de gradiente Ca²⁺, micelio amorfo.' },
    activators: [
      { name: /arginina/i, role: 'sustrato' },
      { name: /B6|piridoxina|pharmaton/i, role: 'cofactor PLP' },
      { name: /zinc|zn.*sulfato/i, role: 'cofactor Zn²⁺' },
    ],
  },
  {
    id: 'N2_NO_PKG', level: 2, weight: 18,
    name: 'NO → GMPc → PKG',
    short: 'NO / PKG',
    icon: '⚛',
    color: '#FF6B35',
    pos: [680, 410],
    summary: 'Activa la fusión hifa-hifa (anastomosis). Es la señal directa que produce los rizomorfos.',
    mechanism: 'L-Arginina → (fNOS) → óxido nítrico (NO•) → guanilato ciclasa → GMPc → proteína quinasa G (PKG). La PKG activa la fusión hifa-hifa (anastomosis), que produce cordones y rizomorfos. Zona óptima de arginina: 1.5–2.5 g/L. Por encima de 3.5 g/L: saturación de fNOS → demasiado NO → inhibición del Complejo IV → paradoja energética.',
    consequence: { activa: 'Anastomosis activa, cordones, rizomorfos orientados.', inactiva: 'Sin fusión hifa-hifa, micelio individual.' },
    activators: [
      { name: /arginina/i, role: 'sustrato fNOS' },
    ],
  },

  // ── N3 — infraestructura estructural ──
  {
    id: 'N3_SAM', level: 3, weight: 10,
    name: 'SAM → Espermina',
    short: 'SAM',
    icon: '✦',
    color: '#44AAFF',
    pos: [100, 590],
    summary: 'Aporta espermina y construye membranas vesiculares. Calidad estructural del Spitzenkörper.',
    mechanism: 'Metionina → S-adenosilmetionina (SAM) → espermina (poliamina de mayor orden). SAM también sintetiza fosfatidilcolina para las membranas vesiculares del Spitzenkörper y metila el ARNr en el ápice. Sin metionina exógena el pool SAM es limitante.',
    consequence: { activa: 'Membranas vesiculares íntegras, espermina presente.', inactiva: 'Spitzenkörper deficiente en lípidos, Espermina ausente.' },
    activators: [
      { name: /metionina|SAM\b/i, role: 'precursor' },
      { name: /remolacha|betai[nñ]a/i, role: 'betaina -> donante metilo SAM (via BHMT)' },
    ],
  },
  {
    id: 'N3_CHITIN', level: 3, weight: 8,
    name: 'Síntesis de quitina',
    short: 'Quitina',
    icon: '▦',
    color: '#70AD47',
    pos: [255, 590],
    summary: 'Construye la pared celular. Define el grosor y firmeza de las hifas y la resistencia del cordón rizomórfico.',
    mechanism: 'UDP-GlcNAc → quitina vía quitín sintasa. El Mg²⁺ es cofactor obligatorio de esta enzima. La pared determina el grosor y la definición visual de las hifas — y la resistencia mecánica del cordón rizomórfico.',
    consequence: { activa: 'Pared definida, hifas firmes, cordones resistentes.', inactiva: 'Pared débil, hifas frágiles, lisis.' },
    activators: [
      { name: /sulfato\s*de\s*magnesio/i, role: 'cofactor Mg²⁺' },
      { name: /glucosamina|N-acetil/i },
    ],
  },
  {
    id: 'N3_SPITZ', level: 3, weight: 12,
    name: 'Spitzenkörper (Ca²⁺)',
    short: 'Spitzenkörper',
    icon: '◈',
    color: '#00CC33',
    pos: [720, 590],
    summary: 'Es la "punta" de crecimiento de la hifa. Controla la velocidad y dirección de elongación con un gradiente de Ca²⁺.',
    mechanism: 'Estructura vesicular apical que determina dirección y velocidad de elongación. Existe un gradiente de Ca²⁺ con alta concentración apical, estabilizado por las poliaminas (N2) y nutrido por el SAM (N3). El CaCl₂ aporta Ca²⁺ libre biodisponible sin precipitar con fosfato; el CaCO₃ es más lento.',
    consequence: { activa: 'Elongación apical rápida y direccional.', inactiva: 'Sin punta de crecimiento definida, ramificación radial.' },
    activators: [
      { name: /cloruro\s*de\s*calcio|CaCl/i, role: 'Ca²⁺ libre' },
      { name: /carbonato\s*de\s*calcio/i, role: 'Ca²⁺ lento (riesgo precip.)' },
      { name: /lecitina/i, role: 'PI -> PI(4,5)P2 -> senal Ca2+ del Spitz' },
    ],
  },

  // ── N2 nuevas — señales morfogenéticas adicionales ──
  {
    id: 'N2_REDOX', level: 2, weight: 10,
    name: 'Control Redox / ROS / NADPH',
    short: 'Redox',
    icon: '⚖',
    color: '#FF4488',
    pos: [535, 410],
    summary: 'Neutraliza los ROS generados por la ETC activa. Sin glutatión y NADPH, el metabolismo acelerado daña las membranas del Spitzenkörper aunque haya ATP de sobra.',
    mechanism: 'La ETC activa genera O₂•⁻ y H₂O₂ como subproductos obligatorios. El glutatión reducido (GSH) + glutatión peroxidasa neutralizan el H₂O₂. El NADPH (producido por la vía pentosa fosfato, rama de glucólisis) regenera el GSH oxidado vía glutatión reductasa. Sin esta protección, los ROS peroxidan los lípidos del Spitzenkörper → rigidez de membrana → fusión vesicular bloqueada → freno apical aunque el ATP sea abundante.',
    consequence: { activa: 'Membranas apicales protegidas, fusión vesicular sin obstáculos oxidativos.', inactiva: 'ROS acumulados dañan lípidos del Spitzenkörper → rigidez → crecimiento frenado aunque haya ATP.' },
    activators: [
      // Matching por nombre (hoy) — estructura preparada para perfil nutricional futuro
      { name: /glutati[oó]n|GSH\b/i, role: 'antioxidante principal' },
      { name: /n-?acetilciste[ií]na|NAC\b/i, role: 'precursor GSH' },
      { name: /[aá]cido\s*asc[oó]rbico|vitamina\s*c\b|ascorb/i, role: 'antioxidante / regenerador GSH' },
      { name: /remolacha/i, role: 'betalinas (betanina) -> buffer redox apical' },
      { name: /NADPH|pentosa\s*fosf/i, role: 'cofactor glutatión reductasa' },
      // { _future: true, composition: { antioxidant: true }, role: 'antioxidante (match futuro por perfil)' }
    ],
  },
  {
    id: 'N2_CAMP', level: 2, weight: 8,
    name: 'Señalización cAMP / PKA',
    short: 'cAMP/PKA',
    icon: '◇',
    color: '#AADDFF',
    pos: [390, 410],
    summary: 'Regula la decisión morfogenética: elongar vs. ramificar. PKA activo suprime ramificación excesiva y favorece el crecimiento apical polarizado que produce rizomorfos.',
    mechanism: 'Las fuentes de carbono (glucosa/maltosa) activan Ras2 → adenilato ciclasa → cAMP → proteína quinasa A (PKA). La PKA fosforila dianas que suprimen los puntos de ramificación y refuerzan la dominancia apical. PKA activo = preferencia por elongación hifal → produce cordones y rizomorfos. PKA inhibido o hiperactivo (exceso de glucosa) = ramificación desordenada o supresión del eje TOR-autophagy.',
    consequence: { activa: 'Dominancia apical sostenida, supresión de ramificaciones laterales excesivas, micelio que avanza en cordones.', inactiva: 'Ramificación aleatoria desordenada — micelio tomentoso aunque N1 y N2_ODC estén activos.' },
    activators: [
      { name: /sacarosa|gluc(?:osa|s)|fructosa|dextr|maltosa|miel|melaza/i, role: 'señal carbono → Ras2/Cyr1 → PKA' },
      { name: /extracto\s*de\s*malta/i, role: 'carbono + nucleótidos → PKA' },
      // { _future: true, composition: { carbon_fraction: true }, role: 'carbon sensing PKA (match futuro)' }
    ],
  },
  {
    id: 'N2_AUTOPHAGY', level: 2, weight: 7,
    name: 'Autofagia / Reciclado interno de N',
    short: 'Autofagia',
    icon: '♻',
    color: '#88CC44',
    pos: [120, 410],
    summary: 'Las hifas reciclan proteínas viejas y orgánulos dañados para liberar aminoácidos hacia el ápice. Fuente interna de N independiente del medio externo.',
    mechanism: 'En colonización hifal activa, el eje TOR-autophagy regula el reciclado intracelular. Proteínas mal plegadas y orgánulos envejecidos se encapsulan en autofagosomas → fusionan con vacuolas → se degradan → aminoácidos liberados al citoplasma. La espermidina (producto de N2_ODC) activa la autofagia vía hipusinación del factor eIF5A. El reciclado interno sostiene síntesis apical con N externo limitado. Exceso de glucosa → PKA hiperactivo → suprime TOR-autophagy → proteínas dañadas se acumulan en hifas activas.',
    consequence: { activa: 'Reciclado interno activo: pools de arginina y metionina reforzados sin depender del N externo. Crecimiento sostenido con N limitado.', inactiva: 'Sin reciclado, el crecimiento apical depende exclusivamente del N externo. Con N limitado: freno apical y acumulación de proteínas dañadas.' },
    activators: [
      { name: /espermidina/i, role: 'activador autofagia vía hipusinación de eIF5A' },
      { name: /sacarosa|gluc(?:osa|s)|fructosa|dextr|maltosa|miel|melaza/i, role: 'energía para maquinaria autofágica (ATP)' },
      // { _future: true, composition: { spermidine_mgL: { min: 0.01 } }, role: 'eIF5A activator (match futuro)' }
    ],
  },

  // ── N3 nuevas — infraestructura apical adicional ──
  {
    id: 'N3_ZINC', level: 3, weight: 9,
    name: 'Zinc — Síntesis proteica apical',
    short: 'Zn apical',
    icon: '⬡',
    color: '#FFCC44',
    pos: [560, 590],
    summary: 'Zn²⁺ es cofactor de RNA polimerasa II y metiltransferasas apicales. Activa la síntesis de proteínas estructurales del Spitzenkörper. Es el lado constructivo del zinc, no solo el competitivo.',
    mechanism: 'El Zn²⁺ es cofactor estructural de RNA pol II (síntesis de ARNm apical) y de zinc-finger methyltransferases (metilación del ARNr en el ápice). Activa factores de transcripción que regulan expresión de quitina sintasas, proteínas vesiculares y componentes del polarisome. Sin Zn²⁺ libre biodisponible, la síntesis proteica apical cae aunque haya SAM y energía. NOTA: Zn compite con Fe²⁺ por metalotioneínas (INT-029) y con Cu²⁺ por transportadores ZIP (INT-018/021) — la concentración libre puede ser mucho menor que la total aportada.',
    consequence: { activa: 'RNA pol II activa → expresión de genes apicales → síntesis de proteínas del Spitzenkörper → elongación sostenida.', inactiva: 'Silencio transcripcional apical: el Spitzenkörper no puede renovar sus componentes proteicos aunque tenga Ca²⁺ y fosfolípidos.' },
    activators: [
      { name: /sulfato\s*de\s*zinc|zn.*sulfato|zinc.*gluc|glicinato.*zinc/i, role: 'Zn²⁺ libre' },
      { name: /pharmaton/i, role: 'Zn²⁺ + cofactores multivitamínicos' },
      { name: /becozym/i, role: 'Zn²⁺ en complejo vitamínico B' },
      // { _future: true, composition: { mineral: 'zinc', minMgL: 0.3 }, role: 'Zn²⁺ cofactor RNA pol II (match futuro)' }
    ],
  },
  {
    id: 'N3_MEMBRANE', level: 3, weight: 10,
    name: 'Fluidez de Membrana',
    short: 'Membrana',
    icon: '◉',
    color: '#00BBCC',
    pos: [410, 590],
    summary: 'El Spitzenkörper necesita membrana fluida para fusionar vesículas. El ergosterol y fosfolípidos insaturados regulan la fluidez. El estrés oxidativo la rigidiza aunque haya Ca²⁺ y poliaminas.',
    mechanism: 'La membrana del Spitzenkörper es una bicapa de fosfolípidos insaturados y ergosterol (análogo fúngico del colesterol). La fluidez óptima permite fusión vesicular para depositar quitina y glucanos en la punta. El SAM sintetiza fosfatidilcolina para las membranas vesiculares. Los ácidos grasos insaturados (lecitina, linoleico) y el inositol aumentan la fluidez. El estrés oxidativo (ROS sin neutralizar) peroxida los ácidos grasos → rigidez → fusión vesicular bloqueada.',
    consequence: { activa: 'Membrana fluida → vesículas se fusionan eficientemente → depósito de material de pared → elongación apical sostenida.', inactiva: 'Membrana rígida (ROS o déficit de fosfolípidos insaturados) → fusión vesicular bloqueada → crecimiento detenido aunque Ca²⁺ y energía estén presentes.' },
    activators: [
      { name: /ergosterol/i, role: 'esterol de membrana fúngica' },
      { name: /lecitina/i, role: 'fosfatidilcolina + ácidos grasos insaturados' },
      { name: /ino?sitol/i, role: 'fosfoinosítidos de membrana (PI, PI4P)' },
      { name: /[aá]cido\s*linol[eé]/i, role: 'ácido graso insaturado' },
      // { _future: true, composition: { phospholipid: true }, role: 'fluidez de membrana (match futuro)' }
    ],
  },

  // ── Salida — resultado emergente ──
  {
    id: 'RIZO', level: 4, weight: 0,
    name: 'Rizomorfismo',
    short: 'Rizomorfismo',
    icon: '🍄',
    color: '#00CC33',
    pos: [410, 800],
    mechanism: 'Resultado emergente: la coherencia simultánea de los 4 niveles produce rizomorfos orientados. No es una sola ruta — es la convergencia del sistema completo.',
    consequence: { activa: 'Cordones rizomórficos orientados, micelio aéreo definido.', inactiva: 'Sin rizomorfos: tomentoso, plano o ralo.' },
    activators: [],
    isOutput: true,
  },
];

// CRITICAL_INTERACTIONS — definidas en cilab_interactions.js (cargado antes en cilab_index.html)
// Para agregar o modificar interacciones: editar cilab_interactions.js directamente.
// Próximo ID disponible: INT-033

// ════════════════════════════════════════════
// CONEXIONES DEL GRAFO METABÓLICO
// kind: 'flow' (default) | 'inhibition' | 'modulator'
// ════════════════════════════════════════════
const EDGES = [
  // Energía
  { from: 'N1_GLYC', to: 'N1_ETC' },
  { from: 'N1_GLYC', to: 'N2_ODC' },
  { from: 'N1_ETC',  to: 'N2_ODC' },
  { from: 'N1_ETC',  to: 'N2_NO_PKG' },
  { from: 'N1_ETC',  to: 'N3_CHITIN' },

  // Señalización → estructura
  { from: 'N2_ODC',  to: 'N3_SPITZ' },
  { from: 'N2_ODC',  to: 'N3_SAM' },
  { from: 'N3_SAM',  to: 'N3_SPITZ' },

  // Modulador: el gradiente da dirección a la anastomosis
  { from: 'N0_GRADIENT', to: 'N2_NO_PKG', kind: 'modulator', label: 'dirección' },
  { from: 'N0_GRADIENT', to: 'RIZO',       kind: 'modulator' },

  // Inhibición: paradoja del Complejo IV
  { from: 'N2_NO_PKG', to: 'N1_ETC', kind: 'inhibition', label: '⊣ exceso NO inhibe IV' },

  // Convergencia → rizomorfismo (existentes)
  { from: 'N2_NO_PKG', to: 'RIZO' },
  { from: 'N3_SPITZ',  to: 'RIZO' },
  { from: 'N3_CHITIN', to: 'RIZO' },
  { from: 'N3_SAM',    to: 'RIZO' },

  // ── N2_REDOX ──
  // A: ETC genera ROS → N2_REDOX los neutraliza
  { from: 'N1_ETC',       to: 'N2_REDOX' },
  // B: pentosa fosfato (rama glucólisis) → NADPH → regenera GSH
  { from: 'N1_GLYC',      to: 'N2_REDOX',     kind: 'modulator', label: 'pentosa-P → NADPH' },
  // C: escudo redox activo → membrana no oxidada → fluidez mantenida
  { from: 'N2_REDOX',     to: 'N3_MEMBRANE' },
  // D: glutatión protege lípidos del Spitzenkörper del daño oxidativo directo
  { from: 'N2_REDOX',     to: 'N3_SPITZ',     kind: 'modulator', label: 'protege ápice' },

  // ── N1_ETC inhibiciones aprobadas ──
  // E: ETC en EXCESO → ROS sin neutralizar → daña membrana (activo solo en EXCESO/EXCESO_CRIT)
  { from: 'N1_ETC',       to: 'N3_MEMBRANE',  kind: 'inhibition', label: '⊣ ROS sin neutralizar' },
  // F: ROS daña directamente las membranas del Spitzenkörper
  { from: 'N1_ETC',       to: 'N3_SPITZ',     kind: 'inhibition', label: '⊣ ROS daña ápice' },

  // ── N2_CAMP ──
  // G: carbono activa Ras2 → adenilato ciclasa → cAMP → PKA
  { from: 'N1_GLYC',      to: 'N2_CAMP' },
  // H: gradiente nutricional activa PKA direccional
  { from: 'N0_GRADIENT',  to: 'N2_CAMP',      kind: 'modulator', label: 'señal posicional' },
  // I: PKA suprime ramificación, refuerza dominancia apical
  { from: 'N2_CAMP',      to: 'N3_SPITZ',     kind: 'modulator', label: 'dominancia apical' },
  // J: decisión elongación > branching → contribuye directamente al rizomorfismo
  { from: 'N2_CAMP',      to: 'RIZO' },

  // ── N2_AUTOPHAGY ──
  // K: ATP de glucólisis necesario para construir autofagosomas
  { from: 'N1_GLYC',      to: 'N2_AUTOPHAGY', kind: 'modulator', label: 'energía autofagia' },
  // L: aminoácidos reciclados reponen pool de arginina → retroalimenta ODC
  { from: 'N2_AUTOPHAGY', to: 'N2_ODC',       kind: 'modulator', label: 'Arg reciclada' },
  // M: metionina recuperada por autofagia → refuerza pool SAM
  { from: 'N2_AUTOPHAGY', to: 'N3_SAM',       kind: 'modulator', label: 'Met reciclada' },
  // N: reciclado eficiente → crecimiento sostenido con N limitado
  { from: 'N2_AUTOPHAGY', to: 'RIZO' },

  // ── N3_ZINC ──
  // O: ATP necesario para síntesis de proteínas Zn-dependientes
  { from: 'N1_ETC',       to: 'N3_ZINC' },
  // P: factores de transcripción Zn activan y son coactivados por el contexto de poliaminas
  { from: 'N2_ODC',       to: 'N3_ZINC',      kind: 'modulator', label: 'coact. Zn-transcripcional' },
  // Q: RNA pol II activa → proteínas estructurales del ápice
  { from: 'N3_ZINC',      to: 'N3_SPITZ' },
  // R: síntesis proteica apical → rizomorfismo
  { from: 'N3_ZINC',      to: 'RIZO' },

  // ── N3_MEMBRANE ──
  // S: SAM sintetiza fosfatidilcolina para bicapa lipídica
  { from: 'N3_SAM',       to: 'N3_MEMBRANE' },
  // T: membrana fluida → vesículas del Spitzenkörper se fusionan
  { from: 'N3_MEMBRANE',  to: 'N3_SPITZ' },
  // U: fluidez de membrana contribuye directamente al rizomorfismo
  { from: 'N3_MEMBRANE',  to: 'RIZO' },
];

// ════════════════════════════════════════════
// SIGNAL BANK — vocabulario de observaciones fenotípicas
// Cada señal: id, rutaAsociada[], direccion, pregunta, descripcion, opciones[]
// ════════════════════════════════════════════
const SIGNAL_BANK = [
  {
    id: 'oxidacion_inoculo',
    rutaAsociada: ['N2_REDOX'],
    direccion: 'insuficiencia',
    pregunta: '¿El inoculo que usaste para sembrar tiene manchas marrones o pintitas oscuras?',
    descripcion: 'Mirá el material con el que sembraste (grano, micelio en agar anterior, etc.). Si tiene manchas marrones, zonas oscuras o metabolitos visibles, indica estrés oxidativo en la FÓRMULA ANTERIOR — no en esta. Es información útil para calibrar qué fórmula generó ese daño.',
    opciones: [
      { value: null,       label: 'No, se veía sano'                    },
      { value: 'leve',     label: 'Algunas pintitas, poco'              },
      { value: 'moderado', label: 'Bastante visible, zonas marrones'    },
      { value: 'intenso',  label: 'Muy marcado, metabolitos abundantes' },
    ],
  },
  {
    id: 'oxidacion_agar',
    rutaAsociada: ['N2_REDOX'],
    direccion: 'insuficiencia',
    pregunta: '¿El agar del medio de cultivo se volvió marrón o amarillo bajo el micelio?',
    descripcion: 'Esto aplica al AGAR NUEVO donde está creciendo. Si usás agar azul y se vuelve transparente, eso es POSITIVO (el hongo está secretando lacasas y colonizando bien — no contar). Lo que buscamos acá es si el agar se vuelve marrón/amarillo/oscuro en zonas donde el hongo crece, sin importar el color base.',
    opciones: [
      { value: null,       label: 'No, el agar se ve normal'            },
      { value: 'leve',     label: 'Algo amarillento en algunos bordes'  },
      { value: 'moderado', label: 'Bastante marrón bajo el micelio'     },
      { value: 'intenso',  label: 'Muy oscuro, zonas grandes afectadas' },
    ],
  },
  {
    id: 'exudados',
    rutaAsociada: ['N1_GLYC', 'N2_ODC'],
    direccion: 'exceso',
    pregunta: '¿Viste gotitas o líquido sobre el micelio?',
    descripcion: 'Son gotitas translúcidas, amarillentas o marrones que aparecen sobre la superficie del micelio. El hongo las produce cuando tiene exceso de metabolitos o nutrientes que no puede procesar. Es como si el hongo "sudara".',
    opciones: [
      { value: null,       label: 'No vi nada'            },
      { value: 'incoloro', label: 'Gotitas transparentes' },
      { value: 'amarillo', label: 'Tono amarillento'      },
      { value: 'marron',   label: 'Tono marrón'           },
    ],
  },
  {
    id: 'cristalizacion',
    rutaAsociada: ['N3_MEMBRANE'],
    direccion: 'exceso',
    pregunta: '¿Viste puntitos brillantes en el agar o el micelio?',
    descripcion: 'Son cristales que se forman cuando hay demasiados minerales en el medio, especialmente calcio y fosfatos que precipitan juntos. Se ven como sal fina o pequeños brillos en la superficie del agar.',
    opciones: [
      { value: null, label: 'No vi nada'       },
      { value: true, label: 'Sí, vi cristales' },
    ],
  },
  {
    id: 'sectoring',
    rutaAsociada: ['N2_REDOX'],
    direccion: 'insuficiencia',
    pregunta: '¿La colonia tiene zonas con aspecto diferente entre sí?',
    descripcion: 'Son "cuñas" o sectores dentro de la misma colonia donde el micelio se ve distinto al resto — diferente densidad, color o textura. Puede indicar daño por estrés oxidativo acumulado.',
    opciones: [
      { value: null, label: 'No, es uniforme'         },
      { value: true, label: 'Sí, vi zonas diferentes' },
    ],
  },
  {
    id: 'autolisis',
    rutaAsociada: ['N2_AUTOPHAGY'],
    direccion: 'insuficiencia',
    pregunta: '¿El centro de la colonia se ve colapsado, oscuro o licuado?',
    descripcion: 'La autolisis es cuando el hongo empieza a "comerse" a sí mismo. El centro se vuelve oscuro, húmedo o se licúa mientras los bordes siguen creciendo. Aparece por falta de carbono o nitrógeno.',
    opciones: [
      { value: null, label: 'No, el centro se ve normal'    },
      { value: true, label: 'Sí, el centro está colapsado' },
    ],
  },
  {
    id: 'velocidadRel',
    rutaAsociada: ['N1_ETC', 'N1_GLYC'],
    direccion: 'cualquiera',
    pregunta: '¿Cómo fue la velocidad de crecimiento?',
    descripcion: 'Comparado con otros experimentos de la misma cepa que hayas visto. Lento puede indicar falta de energía (carbono o ATP). Rápido pero poco rizomórfico puede indicar exceso de carbono sin señalización adecuada.',
    opciones: [
      { value: null,     label: 'No puedo comparar / no sé' },
      { value: 'lento',  label: 'Más lento de lo normal'    },
      { value: 'normal', label: 'Velocidad normal'           },
      { value: 'rapido', label: 'Más rápido de lo normal'   },
    ],
  },
  {
    id: 'patronInvasion',
    rutaAsociada: ['N2_CAMP', 'N3_SPITZ'],
    direccion: 'cualquiera',
    pregunta: '¿Cómo avanzó el micelio en el agar?',
    descripcion: 'El patrón de crecimiento indica la calidad de señalización interna. Radial y uniforme = buena señalización posicional. Lineal (una dirección) = siguió un gradiente. Irregular = problemas de coordinación de punta de hifa.',
    opciones: [
      { value: null,        label: 'No lo observé bien'              },
      { value: 'radial',    label: 'Parejo en todas direcciones'     },
      { value: 'lineal',    label: 'Principalmente en una dirección' },
      { value: 'irregular', label: 'Irregular, sin patrón claro'     },
    ],
  },
  {
    id: 'fenotipoAereo',
    rutaAsociada: ['N1_GLYC', 'N2_ODC'],
    direccion: 'cualquiera',
    pregunta: '¿El micelio estaba alzado o pegado al agar?',
    descripcion: 'Tomentoso (algodonoso, alzado del agar) puede indicar exceso de carbono. Plano y adherido puede indicar buena señalización rizomórfica o estrés. Esta señal complementa el fenotipo general que ya registraste.',
    opciones: [
      { value: null,        label: 'No lo observé bien'          },
      { value: 'tomentoso', label: 'Alzado, algodonoso (tomentoso)' },
      { value: 'plano',     label: 'Pegado al agar, plano'          },
      { value: 'mixto',     label: 'Mixto — zonas de ambos'         },
    ],
  },
];

// ════════════════════════════════════════════
// SEED INICIAL — metadata biológica de ingredientes
// Se aplica sólo si bl2_lab_meta NO existe o no contiene
// la entrada del ingrediente (idempotente, no piso datos).
// ════════════════════════════════════════════
const SEED_META = [
  {
    match: /l-?arginina/i,
    estado: 'en_ensayo',
    rangoOptimo:   { min: 1.5, max: 2.5 },
    rangoSeguro:   { min: 0.3, max: 3.5 },
    alertaCritica: { min: 3.5, msg: 'Saturación fNOS → exceso de NO inhibe el Complejo IV. Paradoja energética crítica.' },
    mecanismo: 'Sustrato de la fNOS (síntesis de NO) y precursor de la ruta ODC (poliaminas). Activa simultáneamente N2_NO_PKG (anastomosis) y N2_ODC (estabilización del Spitzenkörper). Por encima del crítico, paradoja del Complejo IV — sobredosis contraproducente.',
    rutas: ['N2_ODC', 'N2_NO_PKG'],
    seeded: true,
  },
  {
    match: /extracto\s*de\s*malta/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 10, max: 16 },
    rangoSeguro: { min: 5, max: 25 },
    mecanismo: 'Fuente de carbono de liberación intermedia. Aporta maltosa y dextrinas al pool glucolítico. Su perfil de azúcares contribuye al gradiente nutricional.',
    rutas: ['N1_GLYC', 'N0_GRADIENT'],
    seeded: true,
  },
  {
    match: /sulfato\s*de\s*magnesio/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.2, max: 0.4 },
    rangoSeguro: { min: 0.05, max: 0.8 },
    mecanismo: 'Aporta Mg²⁺, cofactor obligatorio de la quitín sintasa y de múltiples ATPasas. Esencial para la integridad de la pared celular y para la cadena respiratoria.',
    rutas: ['N3_CHITIN', 'N1_ETC'],
    seeded: true,
  },
  {
    match: /pharmaton/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.8, max: 1.5 },
    rangoSeguro: { min: 0.2, max: 3.0 },
    mecanismo: 'Multivitamínico/mineral. Aporta tiamina (B1, cofactor PDH/glucólisis), piridoxina (B6, cofactor PLP de ODC), Cu, Mn, Fe (ETC) y Zn (factores de transcripción de ODC). Activa transversalmente N1, N2 y N3.',
    rutas: ['N1_GLYC', 'N1_ETC', 'N2_ODC'],
    seeded: true,
  },
  {
    match: /carbonato\s*de\s*calcio/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.8, max: 1.2 },
    rangoSeguro: { min: 0.2, max: 2.0 },
    alertas: [{ tipo: 'precipitacion', msg: 'Precipita con KH₂PO₄ formando fosfato cálcico insoluble. Considerá CaCl₂ como alternativa para Ca²⁺ libre.' }],
    mecanismo: 'Aporta Ca²⁺ para el gradiente del Spitzenkörper. CaCO₃ es lento de solubilizar — biodisponibilidad parcial. Tampón de pH leve.',
    rutas: ['N3_SPITZ'],
    seeded: true,
  },
  {
    match: /fosfato\s*monopot[áa]sico/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.3, max: 0.5 },
    rangoSeguro: { min: 0.05, max: 1.2 },
    mecanismo: 'Tampón de pH y aporte de fosfato/potasio. El fosfato es esencial para ATP, ácidos nucleicos y fosfolípidos. Cuidar la coexistencia con CaCO₃ (riesgo de precipitación).',
    rutas: ['N1_GLYC'],
    seeded: true,
  },
  {
    match: /glutati[oó]n|GSH\b/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.05, max: 0.2 },
    rangoSeguro: { min: 0.01, max: 0.5 },
    mecanismo: 'Tripéptido antioxidante (γ-Glu-Cys-Gly). Neutraliza ROS vía glutatión peroxidasa. Requiere NADPH para ser regenerado por glutatión reductasa. Protege los lípidos de membrana del Spitzenkörper del daño oxidativo generado por la ETC activa. Es el activador central de N2_REDOX.',
    rutas: ['N2_REDOX'],
    seeded: true,
  },
  {
    match: /n-?acetilciste[ií]na|NAC\b/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.05, max: 0.3 },
    rangoSeguro: { min: 0.01, max: 0.8 },
    mecanismo: 'Precursor de cisteína para la síntesis de novo de glutatión (GSH). Más estable en solución que el GSH directo. Activa N2_REDOX por reposición del pool de GSH.',
    rutas: ['N2_REDOX'],
    seeded: true,
  },
  {
    match: /lecitina/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.2, max: 0.8 },
    rangoSeguro: { min: 0.05, max: 2.0 },
    mecanismo: 'Fuente de fosfatidilcolina y ácidos grasos insaturados (linoleico, linolénico). Los fosfolípidos insaturados mantienen la fluidez de la bicapa lipídica del Spitzenkörper. Sin ellos, la membrana se rigidiza y las vesículas no pueden fusionarse en el ápice. Activa N3_MEMBRANE.',
    rutas: ['N3_MEMBRANE'],
    seeded: true,
  },
  {
    match: /ino?sitol/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.05, max: 0.3 },
    rangoSeguro: { min: 0.01, max: 1.0 },
    mecanismo: 'Precursor de fosfoinosítidos (PI, PI4P, PI(4,5)P₂). Los fosfoinosítidos son señales de membrana que regulan el tráfico vesicular y la polaridad apical en hongos filamentosos. Activa N3_MEMBRANE como componente estructural de la bicapa apical.',
    rutas: ['N3_MEMBRANE'],
    seeded: true,
  },
  {
    match: /ergosterol/i,
    estado: 'en_ensayo',
    rangoOptimo: { min: 0.01, max: 0.1 },
    rangoSeguro: { min: 0.001, max: 0.3 },
    mecanismo: 'Esterol fúngico equivalente funcional al colesterol animal. Estabiliza la bicapa lipídica del Spitzenkörper a temperatura de cultivo manteniendo fluidez óptima. Necesario para la formación de "lipid rafts" en las zonas de fusión vesicular apical. Activa N3_MEMBRANE.',
    rutas: ['N3_MEMBRANE'],
    seeded: true,
  },
];

// ════════════════════════════════════════════
// FACTORES DE SCORE PARA EL ÍNDICE RIZOMÓRFICO
// ════════════════════════════════════════════
const STATUS_FACTOR = {
  ACTIVA:       1.00,
  EXCESO:       0.55,
  EXCESO_CRIT:  0.10,
  LIMITADA:     0.45,
  SIN_DATOS:    0.50,
  INACTIVA:     0.00,
};

const STATUS_LABEL = {
  ACTIVA:      'ACTIVA',
  EXCESO:      'EXCESO',
  EXCESO_CRIT: '⚠ CRÍTICO',
  LIMITADA:    'LIMITADA',
  SIN_DATOS:   'SIN DATOS',
  INACTIVA:    'INACTIVA',
};

// Mapeo status → sufijo CSS (mantiene los nombres de clase consistentes con cilab_styles.css)
const STATUS_CSS_SUFFIX = {
  ACTIVA:      'activa',
  EXCESO:      'exceso',
  EXCESO_CRIT: 'crit',
  LIMITADA:    'limitada',
  SIN_DATOS:   'sindata',
  INACTIVA:    'inactiva',
};
function _stBadgeClass(st) {
  return 'clab-badge clab-badge-st-' + (STATUS_CSS_SUFFIX[st] || 'sindata');
}

// Factor de conversión citrulina → arginina endógena vía ASS+ASL (ciclo de la urea).
// Valor respaldado por guia_rizomorfismo_biolab_v2.md.
// ÚNICO punto del código que define este factor — no hardcodear 0.55 en ningún otro lugar.
const CIT_TO_ARG_FACTOR = 0.6;

// ════════════════════════════════════════════════════════════
// INTERACCIONES VISUALES
// Interpretativas por ahora: no modifican score, pesos ni STATUS_FACTOR.
// ════════════════════════════════════════════════════════════
const INTERACTION_RULES = [
  {
    id: 'PREC_CA_PO4',
    ingIds: ['ING-0010', 'ING-0007'],
    tipo: 'precipitacion',
    severidad: 'critica',
    rutasAfectadas: ['N3_SPITZ'],
    titulo: 'Ca libre precipitado por fosfato',
    descripcion: 'CaCO3 + KH2PO4 forman fosfato calcico insoluble durante la preparacion del agar. Ca libre y fosfato biodisponible quedan reducidos aunque ambos figuren en rango.',
    sugerencia: 'Reemplazar CaCO3 (ING-0010) por CaCl2 (ING-0020) cuando hay fosfatos.',
    sugerenciaIngId: 'ING-0020',
  },
  {
    id: 'ARG_CITRULINA_ACUM',
    ingIds: ['ING-0006', 'ING-0017'],
    tipo: 'saturacion',
    severidad: 'advertencia',
    condicion: (ings) => {
      const arg = ings.find(i => i.id === 'ING-0006');
      const cit = ings.find(i => i.id === 'ING-0017');
      if (!arg || !cit) return false;
      const citGr = (cit.qty || 0) / 1000;
      return (arg.qty || 0) + citGr * CIT_TO_ARG_FACTOR > 3.0;
    },
    rutasAfectadas: ['N2_NO_PKG', 'N1_ETC'],
    titulo: 'Arginina efectiva acumulada',
    descripcion: `La citrulina eleva el pool efectivo de arginina. Concentración efectiva = [Arg] + [Cit_gr] × ${CIT_TO_ARG_FACTOR}. Si supera 3.5 g/L activa la paradoja ETC.`,
    sugerencia: 'Mantener la arginina efectiva por debajo de 3.0 antes de evaluar subir cualquiera de las dos fuentes.',
  },
  {
    id: 'ZN_CU_COMPETENCIA',
    ingIds: ['ING-0021', 'ING-0022'],
    tipo: 'antagonismo',
    severidad: 'advertencia',
    condicion: (ings) => {
      const zn = ings.find(i => i.id === 'ING-0021');
      const cu = ings.find(i => i.id === 'ING-0022');
      if (!zn || !cu) return false;
      return (cu.qty || 0) > 0 && ((zn.qty || 0) / (cu.qty || 1)) > 10;
    },
    rutasAfectadas: ['N1_ETC', 'N2_ODC'],
    titulo: 'Ratio Zn:Cu alto',
    descripcion: 'Zinc y cobre compiten por transportadores de metales divalentes. Un ratio Zn:Cu mayor a 10:1 puede limitar la captacion de cobre.',
    sugerencia: 'Reducir zinc o aumentar cobre para sostener el Complejo IV sin limitar ODC.',
  },
  {
    id: 'FE_FENTON',
    ingIds: ['ING-0023', 'ING-0014'],
    tipo: 'antagonismo',
    severidad: 'advertencia',
    condicion: (ings) => {
      const fe = ings.find(i => i.id === 'ING-0023');
      const tc = ings.find(i => i.id === 'ING-0014');
      if (!fe || !tc) return false;
      return (fe.qty || 0) > 5 && (tc.qty || 0) > 1;
    },
    rutasAfectadas: ['N1_ETC'],
    titulo: 'Hierro + ascorbato',
    descripcion: 'El ascorbato puede aumentar Fe2+ libre y favorecer quimica tipo Fenton si el hierro esta alto.',
    sugerencia: 'Reducir hierro por debajo de 5 mg/L o bajar Tiamina complex cuando ambos coexisten.',
  },
  {
    id: 'PEPTONA_ZN_FITATO',
    ingIds: ['ING-0011', 'ING-0021'],
    tipo: 'antagonismo',
    severidad: 'advertencia',
    condicion: (ings) => {
      const pep = ings.find(i => i.id === 'ING-0011');
      const zn = ings.find(i => i.id === 'ING-0021');
      if (!pep || !zn) return false;
      return (pep.qty || 0) > 2 && (zn.qty || 0) > 0;
    },
    rutasAfectadas: ['N2_ODC'],
    titulo: 'Fitatos reducen Zn biodisponible',
    descripcion: 'La peptona de soja puede aportar fitatos que secuestran zinc y reducen la disponibilidad para ODC.',
    sugerencia: 'Usar zinc quelado resistente a fitatos o reducir peptona si la ruta ODC queda limitada.',
  },
  {
    id: 'MG_CA_COMPETENCIA',
    ingIds: ['ING-0008', 'ING-0020'],
    tipo: 'antagonismo',
    severidad: 'advertencia',
    condicion: (ings) => {
      const mg = ings.find(i => i.id === 'ING-0008');
      const ca = ings.find(i => i.id === 'ING-0020');
      if (!mg || !ca) return false;
      return (mg.qty || 0) > 0.8;
    },
    rutasAfectadas: ['N3_SPITZ'],
    titulo: 'Mg alto compite con Ca',
    descripcion: 'MgSO4 por encima de 0.8 puede competir funcionalmente con la senal de calcio apical del Spitzenkorper.',
    sugerencia: 'Mantener MgSO4 cerca del rango optimo cuando CaCl2 esta presente.',
  },
];

// ════════════════════════════════════════════
// HELPERS DE STORAGE (lectura/escritura JSON)
// ════════════════════════════════════════════
function gArr(k) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function gObj(k, def) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : (def || {});
  } catch { return def || {}; }
}
function s(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { console.error('[CILAB] localStorage write fail:', e); return false; }
}

function now() { return new Date().toISOString(); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function nxtId(prefix, arr) {
  const nums = (arr || []).map(x => x?.id || '').filter(id => id.startsWith(prefix + '-'))
    .map(id => parseInt(id.split('-')[1], 10) || 0);
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch { return String(iso); }
}

// ════════════════════════════════════════════
// LECTURAS CROSS-MÓDULO (con guards + fallback)
// El módulo funciona aunque CI/GE no estén activos.
// ════════════════════════════════════════════

/** Devuelve la biblioteca de ingredientes desde CI o LS. */
function readIngredientes() {
  if (window.getIngredientes && typeof window.getIngredientes === 'function') {
    try {
      const v = window.getIngredientes();
      if (Array.isArray(v) && v.length) return v;
    } catch (e) { /* fallthrough */ }
  }
  return gArr(K.ings);
}

/** Devuelve fórmulas CI desde el helper o LS. */
function readForms() {
  if (window.getForms && typeof window.getForms === 'function') {
    try {
      const v = window.getForms();
      if (Array.isArray(v)) return v;
    } catch (e) { /* fallthrough */ }
  }
  return gArr(K.forms);
}

/** Devuelve experimentos. */
function readExperimentos() {
  return gArr(K.experimentos);
}
function readCultivos() {
  return gArr(K.cultivos);
}

/** Devuelve genéticas seleccionables (id+label). Fallback a leer GE LS directo. */
function readGenetics() {
  if (window.ge && typeof window.ge.getSelectableGenetics === 'function') {
    try {
      const list = window.ge.getSelectableGenetics();
      if (Array.isArray(list)) return list;
    } catch (e) { /* fallthrough */ }
  }
  // Fallback: reconstruir desde biolab.ge.v4
  try {
    const raw = JSON.parse(localStorage.getItem(K.geV4));
    if (raw && Array.isArray(raw.nodes)) {
      const nodes = raw.nodes;
      const byId = id => nodes.find(n => n.id === id);
      const childrenOf = id => nodes.filter(n => n.parentId === id);
      const lineageLabel = (n) => {
        const chain = [];
        let cur = n;
        while (cur) { chain.unshift(cur); cur = cur.parentId ? byId(cur.parentId) : null; }
        const sp = chain.find(x => x.type === 'species');
        const st = chain.find(x => x.type === 'strain');
        const parts = [];
        if (sp) parts.push(sp.name);
        if (st && st.id !== n.id) parts.push(st.name);
        parts.push(n.name);
        return parts.join(' / ');
      };
      return nodes
        .filter(n => n.status !== 'archived' && (n.type === 'phenotype' ||
                (n.type === 'strain' && childrenOf(n.id).length === 0)))
        .map(n => ({ id: n.id, label: lineageLabel(n) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }
  } catch (e) { /* ignore */ }
  return [];
}

// ════════════════════════════════════════════
// METADATA BIOLÓGICA (dual-read / single-write)
// Fuente primaria: ing.bio dentro de bl2_ings.
// Fallback temporal: bl2_lab_meta, solo lectura, hasta consolidar migración.
// Toda escritura nueva termina exclusivamente en ing.bio.
// ════════════════════════════════════════════
function _legacyMeta() { return gObj(K.meta, {}); }
function _isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function _cloneObj(v) { return JSON.parse(JSON.stringify(v || {})); }

function _mergeMetaForIng(ing, legacy) {
  const legacyBio = _isObj(legacy?.[ing.id]) ? legacy[ing.id] : null;
  const liveBio = _isObj(ing.bio) ? ing.bio : null;
  if (legacyBio && liveBio) return Object.assign({}, legacyBio, liveBio);
  if (liveBio) return Object.assign({}, liveBio);
  if (legacyBio) return Object.assign({}, legacyBio);
  return null;
}

function loadMeta() {
  const legacy = _legacyMeta();
  const out = {};
  readIngredientes().forEach(ing => {
    const m = _mergeMetaForIng(ing, legacy);
    if (m) out[ing.id] = m;
  });
  return out;
}

function _dispatchIngsChanged(detail) {
  try {
    window.dispatchEvent(new CustomEvent('cilab-ings-changed', {
      detail: Object.assign({ source: 'CILAB' }, detail || {}),
    }));
  } catch (e) { /* no critico */ }
}

function _writeIngredientesBio(mutator, detail) {
  const ings = readIngredientes().map(i => Object.assign({}, i));
  const before = JSON.stringify(ings);
  mutator(ings);
  if (JSON.stringify(ings) === before) return true;
  const ok = s(K.ings, ings);
  if (ok) _dispatchIngsChanged(detail || { tipo: 'bio-editado' });
  return ok;
}

function saveMeta(metaMap) {
  if (!_isObj(metaMap)) return false;
  return _writeIngredientesBio(ings => {
    ings.forEach(ing => {
      if (metaMap[ing.id]) ing.bio = _cloneObj(metaMap[ing.id]);
    });
  }, { tipo: 'bio-map-guardado' });
}

function getIngMeta(ingId) {
  const all = loadMeta();
  return all[ingId] || null;
}

function setIngMeta(ingId, partial) {
  const all = loadMeta();
  const prev = all[ingId] || {};
  const next = Object.assign({}, prev, partial, { updatedAt: now() });
  const ok = _writeIngredientesBio(ings => {
    const ing = ings.find(x => x.id === ingId);
    if (ing) ing.bio = _cloneObj(next);
  }, { tipo: 'bio-editado', ingId });
  return ok ? next : null;
}

function migrateLegacyMetaToIngBio() {
  const legacy = _legacyMeta();
  const legacyIds = Object.keys(legacy);
  if (!legacyIds.length) {
    notif('No hay bl2_lab_meta legacy para migrar', 'ok');
    return { migrados: 0, legacyIds: 0 };
  }
  let migrados = 0;
  _writeIngredientesBio(ings => {
    ings.forEach(ing => {
      if (!legacy[ing.id]) return;
      const current = _isObj(ing.bio) ? ing.bio : {};
      ing.bio = Object.assign({}, legacy[ing.id], current, {
        migratedFromLegacyAt: current.migratedFromLegacyAt || now(),
      });
      migrados++;
    });
  }, { tipo: 'bio-migrado', count: legacyIds.length });
  notif(`Migración bio completa: ${migrados} ingrediente(s)`, 'ok');
  updateHeaderStats();
  renderBiblio();
  renderAnalyzer();
  return { migrados, legacyIds: legacyIds.length };
}

/** Sembrado idempotente: aplica SEED_META a ingredientes que existen
 *  en la biblioteca por nombre y todavía no tienen metadata efectiva. */
function seedMetaIfNeeded() {
  const ings = readIngredientes();
  if (!ings.length) return;
  const meta = loadMeta();
  const next = Object.assign({}, meta);
  let touched = false;
  SEED_META.forEach(seed => {
    const ing = ings.find(i => seed.match.test(i.nombre || ''));
    if (!ing) return;
    if (next[ing.id]) return; // ya tiene metadata efectiva, no piso
    next[ing.id] = {
      estado:        seed.estado,
      rangoOptimo:   seed.rangoOptimo,
      rangoSeguro:   seed.rangoSeguro,
      alertaCritica: seed.alertaCritica || null,
      alertas:       seed.alertas || [],
      mecanismo:     seed.mecanismo || '',
      rutas:         seed.rutas || [],
      seeded:        true,
      updatedAt:     now(),
    };
    touched = true;
  });
  if (touched) saveMeta(next);
}

// ════════════════════════════════════════════
// MOTOR DE ANÁLISIS
// ════════════════════════════════════════════

/** Clasifica una cantidad contra un rango de meta biológica.
 *  Devuelve uno de: ACTIVA / LIMITADA / EXCESO / EXCESO_CRIT / SIN_DATOS / INACTIVA */
function classifyQty(qty, meta) {
  if (qty == null || qty <= 0) return 'INACTIVA';
  if (!meta || (!meta.rangoOptimo && !meta.rangoSeguro)) return 'SIN_DATOS';
  if (meta.alertaCritica && qty > meta.alertaCritica.min) return 'EXCESO_CRIT';
  const opt = meta.rangoOptimo, seg = meta.rangoSeguro;
  if (opt && qty >= opt.min && qty <= opt.max) return 'ACTIVA';
  // Por encima del optimo pero dentro del seguro → EXCESO (no LIMITADA)
  if (opt && qty > opt.max && seg && qty <= seg.max) return 'EXCESO';
  if (seg && qty > seg.max) return 'EXCESO';
  if (seg && qty < seg.min) return 'LIMITADA';
  if (opt && qty < opt.min) return 'LIMITADA';
  return 'LIMITADA';
}

/** Severidad para "best of" — mayor = más activo. EXCESO_CRIT es sticky. */
const STATUS_SEV = {
  INACTIVA:    0,
  SIN_DATOS:   1,
  LIMITADA:    2,
  EXCESO:      3,
  ACTIVA:      4,
  EXCESO_CRIT: 0, // no contribuye al "best", se marca aparte
};

/** Encuentra ingredientes de la fórmula que activan una ruta.
 *  Estrategia de matching:
 *    1. Si el ingrediente tiene `meta.rutas` configurado (override manual del
 *       usuario en la Biblioteca biológica), ESE array es la única fuente de
 *       verdad — el regex automático queda anulado para ese ingrediente.
 *    2. Si no hay override manual, fallback a los regex `route.activators[]`
 *       sobre el nombre y/o aspecto.
 *  Esto le da al usuario control total sin obligarlo a configurar todo. */
function findActivators(route, formulaIngs, allIngs) {
  if (route.isOutput) return [];
  const meta = loadMeta();
  const out = [];
  formulaIngs.forEach(fi => {
    const ing = allIngs.find(x => x.id === fi.id);
    const nombre = (fi.snapshot?.nombre) || ing?.nombre || '';
    const aspecto = (fi.snapshot?.aspecto) || ing?.aspecto || '';
    const baseIng = ing || { id: fi.id, nombre, aspecto };

    const m = meta[fi.id];

    // 1) Override manual: si rutas es un array (incluso vacío), gana sobre el regex.
    //    Array vacío = "este ingrediente no activa NADA, ignorá el regex automático".
    //    Para volver al regex hay que eliminar la prop (botón "Volver al matching automático").
    if (m && Array.isArray(m.rutas)) {
      const activates = m.rutas.includes(route.id);
      console.log(`[CILAB] findActivators | ruta=${route.id} | ing=${fi.id} (${nombre}) | via=MANUAL | rutas=${JSON.stringify(m.rutas)} | activa=${activates} | qty=${fi.qty}`);
      if (activates) {
        out.push({ ing: baseIng, qty: fi.qty || 0, role: 'asignado manualmente', via: 'manual' });
      }
      return; // saltea fallback regex — meta.rutas es la verdad
    }

    // 2) Fallback: regex sobre activadores hardcoded de la ruta
    if (!route.activators || !route.activators.length) return;
    for (const act of route.activators) {
      if (act.name && act.name.test(nombre)) {
        console.log(`[CILAB] findActivators | ruta=${route.id} | ing=${fi.id} (${nombre}) | via=REGEX/name | qty=${fi.qty}`);
        out.push({ ing: baseIng, qty: fi.qty || 0, role: act.role || '', via: 'name' });
        return;
      }
      if (act.aspecto && aspecto === act.aspecto) {
        console.log(`[CILAB] findActivators | ruta=${route.id} | ing=${fi.id} (${nombre}) | via=REGEX/aspecto | qty=${fi.qty}`);
        out.push({ ing: baseIng, qty: fi.qty || 0, role: act.role || '', via: 'aspecto' });
        return;
      }
    }
  });
  return out;
}

/** Devuelve el rango efectivo de un ingrediente según genética (fallback al rango general). */
function rangeForIng(ingId, geneticaId) {
  const meta = getIngMeta(ingId);
  if (!geneticaId) return meta;
  const sr = gArr(K.strainRng).find(x =>
    x.geneticaId === geneticaId && x.ingId === ingId && x.source === 'aplicado'
  );
  if (sr && sr.min != null && sr.max != null) {
    return Object.assign({}, meta || {}, { rangoOptimo: { min: sr.min, max: sr.max } });
  }
  return meta;
}

/** Calcula intensidad 0-100 de una ruta según qué tan dentro del rango óptimo
 *  está el ingrediente activador. Usado para intensidad visual continua en el grafo. */
function calcRouteIntensity(triggers, finalStatus, geneticaId) {
  if (finalStatus === 'INACTIVA') return 0;
  if (finalStatus === 'EXCESO_CRIT') return 100; // muy visible, el CSS ya lo flashea rojo
  if (finalStatus === 'SIN_DATOS')   return 48;  // neutral — hay algo pero sin rango
  if (finalStatus === 'ACTIVA')      return 100;
  if (finalStatus === 'EXCESO')      return 80;  // activo con exceso — CSS lo muestra naranja
  // LIMITADA: proporcional a qué tan cerca está del mínimo óptimo
  let best = 0;
  triggers.forEach(t => {
    if (t.qty <= 0) return;
    const meta = rangeForIng(t.ing.id, geneticaId);
    if (!meta) return;
    const opt = meta.rangoOptimo, seg = meta.rangoSeguro;
    const ref = (opt?.min > 0) ? opt.min : (seg?.min > 0 ? seg.min : 0);
    if (ref > 0) {
      best = Math.max(best, Math.min(92, Math.round((t.qty / ref) * 100)));
    } else {
      best = Math.max(best, 30);
    }
  });
  return best || 20;
}

/** Calcula estado por ruta para una lista de ingredientes con cantidades.
 *  formulaIngs: [{id, qty, snapshot?}], geneticaId opcional.
 *
 *  Si algún ingrediente tiene `meta.contribuciones` definido, se usa ese modelo
 *  aditivo (suma de porcentajes escalados por qty/rangoOptimo) para las rutas
 *  "reclamadas" por ese ingrediente. El resto sigue por el path de triggers/regex.
 */
function calcEstadoRutas(formulaIngs, geneticaId) {
  const allIngs = readIngredientes();
  const allMeta = loadMeta();

  // ── Pre-paso: contribuciones aditivas ────────────────────────────────────
  // routeContrib[routeId] = { level: 0-100, claimed: true }
  // "claimed" significa que al menos un ingrediente declaró contribución a esa ruta.
  // Las rutas reclamadas no van al path de triggers; su intensidad sale de level.
  const routeContrib = {};

  formulaIngs.forEach(fi => {
    const m = allMeta[fi.id];
    if (!m?.contribuciones || typeof m.contribuciones !== 'object') return;

    // Marcar todas las rutas de este ingrediente como "reclamadas"
    Object.entries(m.contribuciones).forEach(([routeId, pct]) => {
      if (!routeContrib[routeId]) routeContrib[routeId] = { level: 0, claimed: true };
    });

    const qty = fi.qty || 0;
    if (qty <= 0) return;

    // Factor de escala derivado de classifyQty — idéntico al path de triggers.
    // Esto garantiza que dosis distintas produzcan scores distintos:
    //   INACTIVA    → 0.00  (ausente)
    //   LIMITADA    → rampa 0..0.90 proporcional a qty/opt.min
    //   ACTIVA      → 1.00  (zona óptima)
    //   EXCESO      → 0.55  (encima del máximo óptimo — efecto reducido)
    //   EXCESO_CRIT → 0.10  (sobre el límite seguro — casi nulo)
    const _qst = classifyQty(qty, m);
    let scale;
    if (_qst === 'LIMITADA') {
      const _opt = m.rangoOptimo;
      scale = _opt?.min > 0 ? Math.min(0.90, qty / _opt.min) : 0.45;
    } else {
      scale = { ACTIVA: 1.00, EXCESO: 0.55, EXCESO_CRIT: 0.10, SIN_DATOS: 0.50 }[_qst] ?? 0.0;
    }

    Object.entries(m.contribuciones).forEach(([routeId, pct]) => {
      if (typeof pct !== 'number' || pct <= 0) return;
      routeContrib[routeId].level += pct * scale;
    });
  });

  // Normalizar por el máximo posible por ruta en la biblioteca (Fix Bug 2)
  // Sin esto, rutas con pocos contribuyentes (N2_REDOX max≈50, N3_ZINC max≈50)
  // nunca alcanzan el umbral ACTIVA de 75 aunque todos los ingredientes estén al máximo.
  const _routeMaxPossible = {};
  Object.values(allMeta).forEach(m => {
    if (!m?.contribuciones) return;
    Object.entries(m.contribuciones).forEach(([rId, pct]) => {
      if (typeof pct === 'number' && pct > 0)
        _routeMaxPossible[rId] = (_routeMaxPossible[rId] || 0) + pct;
    });
  });
  Object.keys(routeContrib).forEach(r => {
    // Cap del denominador a 100 — invariante crítico:
    // _routeMaxPossible refleja la SUMA de todos los contribuidores de la biblioteca.
    // Con la biblioteca completa (26+ ingredientes), ese valor puede ser 200-540.
    // Si usamos ese total como denominador, una fórmula típica (5-7 ingredientes)
    // nunca alcanzaría el umbral ACTIVA=75 aunque todos sus ingredientes estén en rango.
    // Fix: el denominador máximo es 100 → rutas con pocos contribuidores (max<100)
    // mantienen el boost original; rutas con muchos contribuidores usan base 100.
    const maxRaw = _routeMaxPossible[r] || 100;
    const denom  = Math.min(maxRaw, 100);
    routeContrib[r].level = Math.min(100, (routeContrib[r].level / denom) * 100);
  });
  // ─────────────────────────────────────────────────────────────────────────

  const result = {};
  ROUTES.forEach(route => {
    if (route.isOutput) { result[route.id] = { status: 'INACTIVA', triggers: [], intensity: 0 }; return; }

    const contrib = routeContrib[route.id];
    if (contrib?.claimed) {
      // Path de contribuciones: status derivado del nivel aditivo
      const level  = contrib.level;
      const status = level <= 0  ? 'INACTIVA' :
                     level >= 75 ? 'ACTIVA'   : 'LIMITADA';
      result[route.id] = { status, triggers: [], critFlag: false, intensity: Math.round(level), contribBased: true };
      return;
    }

    // Path de triggers/regex (comportamiento original)
    const triggers = findActivators(route, formulaIngs, allIngs);
    if (!triggers.length) { result[route.id] = { status: 'INACTIVA', triggers: [], intensity: 0 }; return; }
    let bestStatus = 'INACTIVA';
    let bestSev = -1;
    let critFlag = false;
    triggers.forEach(t => {
      const meta = rangeForIng(t.ing.id, geneticaId);
      const st = classifyQty(t.qty, meta);
      t.status = st;
      t.range  = meta;
      if (st === 'EXCESO_CRIT') { critFlag = true; }
      else if (STATUS_SEV[st] > bestSev) { bestSev = STATUS_SEV[st]; bestStatus = st; }
    });
    const finalStatus = critFlag ? 'EXCESO_CRIT' : bestStatus;
    const intensity = calcRouteIntensity(triggers, finalStatus, geneticaId);
    result[route.id] = { status: finalStatus, triggers, critFlag, intensity };
  });

  // ── Paso Final: Interacciones Críticas ────────────────────────────────────
  const activeIngIds = formulaIngs.filter(fi => (fi.qty || 0) > 0).map(fi => fi.id);
  
  CRITICAL_INTERACTIONS.forEach(inter => {
    // Condición 1: todos los ingredientes presentes ("ambos_presentes" o default)
    const allPresent = inter.ingredientes.every(id => activeIngIds.includes(id));

    // Condición 2: ingrediente presente SIN su complementario ("ausencia_complementaria")
    // Ejemplo: metionina presente pero glicina ausente → alerta
    let ausenciaAlert = false;
    if (inter.condicion === 'ausencia_complementaria' && inter.ingAusente) {
      const triggerPresente = inter.ingredientes.every(id => activeIngIds.includes(id));
      const complementoAusente = !activeIngIds.includes(inter.ingAusente);
      ausenciaAlert = triggerPresente && complementoAusente;
    }

    if (allPresent || ausenciaAlert) {
      inter.rutasAfectadas.forEach(routeId => {
        if (result[routeId]) {
          // Agregar alerta de interacción
          result[routeId].interactionAlert = {
            id: inter.id,
            severity: inter.severity,
            msg: inter.msg,
            esAusencia: ausenciaAlert
          };
          // Las interacciones marcan alertas visuales solamente — NO modifican
          // result[routeId].status para no afectar calcRizomorfico (score).
        }
      });
    }
  });

  // ── Corrección de precipitación CaCO₃ + KH₂PO₄ ───────────────────────────
  // Esta corrección BAJA EL SCORE REAL de N3_SPITZ a INACTIVA.
  // No es solo badge visual — modifica calcRizomorfico directamente.
  // INT-004 e INT-007 ya muestran el overlay en el grafo; este paso
  // garantiza que el índice rizomórfico sea honesto.
  // Invariante: CaCl₂ (ING-0020) no precipita con fosfatos — no aplicar override.
  if (activeIngIds.includes('ING-0010') && activeIngIds.includes('ING-0007')) {
    if (result['N3_SPITZ']) {
      result['N3_SPITZ'].status            = 'INACTIVA';
      result['N3_SPITZ'].intensity         = 0;
      result['N3_SPITZ'].precipitationOverride = true;
      result['N3_SPITZ'].precipitationMsg  =
        'Ca²⁺ precipitado por PO₄³⁻ → fosfato cálcico insoluble [Ca₃(PO₄)₂]. ' +
        'Ca²⁺ libre ≈ 0 aunque CaCO₃ esté en rango. ' +
        'Solución: reemplazar CaCO₃ (ING-0010) por CaCl₂ (ING-0020).';
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Etapa 2: aplicar modificadores de composicion quimica
  // (vitaminas, minerales, aminoacidos -> ajuste de intensity + re-status contribBased)
  _applyCompositionModifiers(result, formulaIngs, allIngs);

  return result;
}

/** Ordena SIGNAL_BANK por relevancia según routeStates.
 *  Señales cuya ruta está LIMITADA o INACTIVA aparecen primero (más probables de observar).
 *  routeStates: retorno de calcEstadoRutas(). Si null → orden original del banco.
 */
function sortSignalsByRelevance(signals, routeStates) {
  if (!routeStates) return signals.slice();
  const map = { LIMITADA: 0, EXCESO: 1, INACTIVA: 2, SIN_DATOS: 3, ACTIVA: 4 };
  return signals.slice().sort((a, b) => {
    const scoreOf = (sig) => sig.rutaAsociada.reduce((min, rId) => {
      const st = routeStates[rId] && routeStates[rId].status;
      return Math.min(min, map[st] !== undefined ? map[st] : 3);
    }, 99);
    return scoreOf(a) - scoreOf(b);
    // Array.sort es estable en V8 — tiebreaker implícito es el índice original del banco
  });
}

/** Dado un signal positivo, retorna los ingredientes de formulaIngs
 *  que más probablemente causaron esa señal, con razón.
 *  Retorna Array<{ingId, ingNombre, rutaId, rutaShort, qst, pct, razon}> (máx 3 items).
 *  Función pura — no escribe nada.
 */
function attributeSignalToIngredients(signalId, routeStates, formulaIngs, metaAll) {
  const signal = SIGNAL_BANK.find(s => s.id === signalId);
  if (!signal) return [];

  const results = [];

  signal.rutaAsociada.forEach(rutaId => {
    // Short label para la ruta: buscar en ROUTES el nodo con ese id
    const routeNode = ROUTES.find(r => r.id === rutaId && r.level !== undefined);
    const rutaShort = routeNode ? routeNode.short : rutaId;

    formulaIngs.forEach(fi => {
      const m = metaAll[fi.id];
      if (!m) return;

      const contributes = (m.contribuciones && m.contribuciones[rutaId])
        || (m.rutas && m.rutas.indexOf(rutaId) >= 0);
      if (!contributes) return;

      const ingNombre = fi.nombre || fi.id;
      const pct = (m.contribuciones && m.contribuciones[rutaId]) || 0;
      const qst = classifyQty(fi.qty || 0, m);

      let razon = '';
      if (signal.direccion === 'insuficiencia') {
        if (qst === 'LIMITADA' || qst === 'INACTIVA')
          razon = 'Dosis insuficiente — no activa la ruta protectora';
        else if (qst === 'EXCESO' || qst === 'EXCESO_CRIT')
          razon = 'En exceso — puede estar saturando / dañando la ruta';
      } else if (signal.direccion === 'exceso') {
        if (qst === 'EXCESO' || qst === 'EXCESO_CRIT')
          razon = 'Dosis excesiva — sobrecargas esta ruta';
        else if (qst === 'ACTIVA')
          razon = 'En rango óptimo — revisar interacción con otros ingredientes';
      }
      if (!razon) return; // ingrediente no contribuye significativamente al problema

      results.push({ ingId: fi.id, ingNombre, rutaId, rutaShort, qst, pct, razon });
    });

    // Caso especial N2_REDOX insuficiencia: antioxidante ausente
    if (rutaId === 'N2_REDOX' && signal.direccion === 'insuficiencia') {
      const hasRedox = formulaIngs.some(fi => {
        const m2 = metaAll[fi.id];
        return m2 && ((m2.contribuciones && m2.contribuciones['N2_REDOX'])
                  || (m2.rutas && m2.rutas.indexOf('N2_REDOX') >= 0));
      });
      if (!hasRedox) {
        results.push({
          ingId:     '__ausente__',
          ingNombre: 'Sin antioxidante en la fórmula',
          rutaId:    'N2_REDOX',
          rutaShort: 'Redox',
          qst:       'INACTIVA',
          pct:       0,
          razon:     'No hay L-Glutatión, NAC ni Vitamina C — pool de GSH sin sustrato',
        });
      }
    }
  });

  // Ordenar: los más problemáticos primero
  const prio = { INACTIVA: 0, LIMITADA: 1, EXCESO: 2, EXCESO_CRIT: 2, ACTIVA: 3, SIN_DATOS: 4 };
  results.sort((a, b) => (prio[a.qst] ?? 4) - (prio[b.qst] ?? 4));
  return results.slice(0, 3);
}

// ════════════════════════════════════════════
// CONTRATO DE UNIDADES
// Función canónica de conversión a gramos.
// Es el ÚNICO lugar del sistema donde se hace aritmética de unidades.
// Cualquier función que necesite masa en gramos debe llamar a esta función.
//
// Unidades soportadas:
//   mg  → gramos (/1000)
//   kg  → gramos (*1000)
//   gr  → gramos (identidad)
//   g   → gramos (identidad, alias)
//   ml  → gramos (ρ≈1 g/ml para soluciones acuosas — aproximación válida para C/N)
//   L   → gramos (*1000, mismo principio)
//   ud  → 0 (unidad discreta sin masa aprovechable en C/N)
//   ?   → se trata como gramos (fallback conservador, emite warning)
// ════════════════════════════════════════════
function toGrams(qty, unidad) {
  if (!isFinite(qty) || qty <= 0) return 0;
  switch ((unidad || '').toLowerCase().trim()) {
    case 'mg':  return qty / 1000;
    case 'kg':  return qty * 1000;
    case 'gr':
    case 'g':   return qty;
    case 'ml':  return qty;        // ρ≈1 g/ml (solución acuosa)
    case 'l':   return qty * 1000; // litros → gramos
    case 'ud':  return 0;          // unidades discretas: sin masa en C/N
    default:
      console.warn(`[CILAB:toGrams] unidad desconocida "${unidad}" para qty=${qty} — tratada como gr`);
      return qty;
  }
}

/** Calcula C, N, masa de una lista de ingredientes.
 *
 *  Contrato de entrada — cada item en ingRows DEBE tener:
 *    { id, qty, unidad }   ← unidad es obligatorio en el ítem
 *    { snapshot? }         ← para pc/pn/aspecto cuando el ingrediente no está en la librería viva
 *
 *  La unidad en el ítem es la fuente de verdad para la conversión de masa.
 *  El fallback a snapshot/live sólo se usa para pc, pn y aspecto, nunca para unidad.
 */

// ════════════════════════════════════════════════════════════════════════
// ETAPA 2 — MODIFICADORES DE COMPOSICION QUIMICA SOBRE RUTAS
// Fuente de verdad: guia_rizomorfismo_biolab_v2.md
//
// Filosofia:
//  - Se aplican DESPUES de calcEstadoRutas, sobre el result ya construido.
//  - Para rutas contribBased: modifica intensity + re-deriva status
//    usando los mismos umbrales (>=75 ACTIVA, >0 LIMITADA, <=0 INACTIVA).
//  - Para rutas trigger-based: modifica solo intensity (color sin cambio).
//  - Cada modificacion se registra en compositionModifiers[] para trazabilidad.
//  - Delta total acotado: max +20, min -25 por ruta.
//  - INVARIANTE: precipitationOverride y critFlag nunca se sobreescriben.
// ════════════════════════════════════════════════════════════════════════
function _applyCompositionModifiers(routeStates, formulaIngs, allIngs) {
  if (!formulaIngs || !formulaIngs.length) return;

  // Calcular pools (reutiliza funciones de Etapa 2 — sin recomputo)
  const activeIngs = formulaIngs.filter(function(fi) { return (fi.qty || 0) > 0; });
  if (!activeIngs.length) return;

  const minRes  = calcMineralPool(activeIngs, allIngs, routeStates);
  const vitRes  = calcVitaminPool(activeIngs, allIngs);
  const aaRes   = calcAminoPool(activeIngs, allIngs);

  const M  = minRes.pool;
  const V  = vitRes.pool;
  const A  = aaRes.pool;
  const feZn = minRes.feZnRatio; // null si Zn==0

  // Helper: acota el delta al rango [-25, +20]
  function clamp(delta) { return Math.max(-25, Math.min(20, delta)); }

  // Helper: aplica delta a una ruta con trazabilidad
  function applyDelta(routeId, delta, reason) {
    if (!delta || !routeStates[routeId]) return;
    const st = routeStates[routeId];
    if (!st.compositionModifiers) st.compositionModifiers = [];
    st.compositionModifiers.push({ delta: delta, reason: reason });
  }

  // Calcular todos los deltas por ruta
  const deltas = {};
  function addDelta(rid, d, reason) {
    if (!deltas[rid]) deltas[rid] = [];
    deltas[rid].push({ d: d, reason: reason });
  }

  // ── N1_GLYC — Glucolisis / Krebs / ATP
  // Cofactores criticos: B1 (PDH), Mg (ATP-Mg kinasas)
  // Fuente: guia v2 "N1: Malta, almidon, tiamina (B1)"
  const b1 = V.B1_mg || 0;
  if      (b1 >= 0.10) addDelta('N1_GLYC', +8,  'B1 suficiente — PDH activa');
  else if (b1 >= 0.05) addDelta('N1_GLYC', -4,  'B1 suboptimo — PDH parcial');
  else                 addDelta('N1_GLYC', -15, 'B1 ausente — PDH bloqueada');
  const mg = M.Mg_mg || 0;
  if      (mg >= 15) addDelta('N1_GLYC', +5, 'Mg suficiente — cofactor ATP-kinasas');
  else if (mg < 2)   addDelta('N1_GLYC', -8, 'Mg ausente — sintesis de ATP comprometida');

  // ── N1_ETC — Cadena respiratoria
  // Cofactores: Cu (complejo IV), Fe, B2 (FAD), B3 (NAD+), Mg
  // Fuente: guia v2 "ETC: Cu, Fe, Mg" y "Fe:Zn antagonismo"
  const fe = M.Fe_mg || 0;
  const cu = M.Cu_mg || 0;
  const b2 = V.B2_mg || 0;
  const b3 = V.B3_mg || 0;
  if      (cu >= 0.3) addDelta('N1_ETC', +10, 'Cu suficiente — citocromo c oxidasa activa');
  else if (cu >= 0.05) addDelta('N1_ETC', -4,  'Cu marginal — complejo IV suboptimo');
  else                addDelta('N1_ETC', -10, 'Cu ausente — complejo IV bloqueado');
  if (fe >= 1) addDelta('N1_ETC', +5, 'Fe disponible — transferencia electronica');
  if (b2 >= 0.1) addDelta('N1_ETC', +4, 'B2 — FAD/FMN cofactores disponibles');
  if (b3 >= 0.5) addDelta('N1_ETC', +4, 'B3 — NAD+ disponible para ETC');
  if (feZn !== null && feZn > 3) addDelta('N1_ETC', -6, 'Fe:Zn=' + feZn.toFixed(1) + ' — antagonismo desplaza Cu (complejo IV)');
  if (mg < 2) addDelta('N1_ETC', -8, 'Mg ausente — ATP-sintasa comprometida');

  // ── N2_ODC — Ornitina descarboxilasa / poliaminas / Spitzenkörper
  // Cofactores: B6 (ODC), Zn (estabilidad ODC)
  // Fuente: guia v2 "ODC -> poliaminas: Zn, B6"
  const b6  = V.B6_mg || 0;
  const zn  = M.Zn_mg || 0;
  if      (b6 >= 0.05) addDelta('N2_ODC', +10, 'B6 — ODC cofactor disponible');
  else if (b6 >= 0.02) addDelta('N2_ODC', -5,  'B6 suboptimo — ODC parcial');
  else                 addDelta('N2_ODC', -15, 'B6 ausente — ODC bloqueada, sin poliaminas');
  if      (zn >= 1.0) addDelta('N2_ODC', +5, 'Zn — estabilidad ODC OK');
  else if (zn < 0.1)  addDelta('N2_ODC', -8, 'Zn ausente — ODC inestable');
  if (feZn !== null && feZn > 3) addDelta('N2_ODC', -10, 'Fe:Zn=' + feZn.toFixed(1) + ' — Zn biodisponible reducido');

  // ── N2_NO_PKG — fNOS / NO / GMPc
  // La arginina ya esta manejada por contribuciones.
  // Ajuste adicional: ratio Arg:Gln (guia v2 "ratio Arg:Gln debe ser <3:1")
  const argG = A.arg_g || 0;
  const glnG = A.gln_g || 0;
  if (glnG > 0 && argG > 0) {
    const ratio = argG / glnG;
    if (ratio > 3) addDelta('N2_NO_PKG', -6, 'Arg:Gln=' + ratio.toFixed(1) + ' — Gln compite por transportadores, hifa mas fina');
  }
  // B6 tambien activa la via NOS
  if (b6 >= 0.05) addDelta('N2_NO_PKG', +4, 'B6 — cofactor NOS disponible');

  // ── N3_SAM — SAM / espermina / membranas del Spitz
  // Cofactores: B12 (metionina sintasa), B9 (ciclo folatos), Met (sustrato)
  // Fuente: guia v2 "SAM: metionina, glicina"
  const b12 = V.B12_ug || 0;
  const b9  = V.B9_ug  || 0;
  const met = A.met_g   || 0;
  if      (b12 >= 0.5) addDelta('N3_SAM', +8, 'B12 — metionina sintasa activa, ciclo SAM OK');
  else if (b12 >= 0.1) addDelta('N3_SAM', -4, 'B12 bajo — ciclo SAM suboptimo');
  else                 addDelta('N3_SAM', -12, 'B12 ausente — metionina sintasa bloqueada');
  if      (b9 >= 20) addDelta('N3_SAM', +5, 'B9 — ciclo folatos activo');
  else if (b9 < 5)   addDelta('N3_SAM', -6, 'B9 deficiente — ciclo folatos incompleto');
  if (met >= 0.5) addDelta('N3_SAM', +5, 'Met >= 0.5 g/L — sustrato SAM disponible');
  else if (met < 0.05) addDelta('N3_SAM', -5, 'Met ausente — SAM sin sustrato');

  // ── N3_CHITIN — Sintesis de quitina / pared celular
  // Cofactor: Mg (quitina sintetasa)
  // Regla critica: Met sin Gly -> acumulacion de homocisteina -> dano en quitina
  // Fuente: guia v2 "Met sin Gly -> acumulacion de homocisteina"
  const gly = A.gly_g || 0;
  if      (mg >= 15)  addDelta('N3_CHITIN', +8, 'Mg suficiente — quitina sintetasa activa');
  else if (mg < 2)    addDelta('N3_CHITIN', -10, 'Mg ausente — quitina sintetasa bloqueada');
  if (met > 0 && gly < 0.05) addDelta('N3_CHITIN', -12, 'Met sin Gly (<0.05 g/L) — homocisteina dania la pared celular');
  if (gly >= 0.1) addDelta('N3_CHITIN', +5, 'Gly >= 0.1 g/L — reciclado folatos + pared celular');

  // ── N3_ZINC — Pool de Zn / estabilidad Spitzenkörper
  // Fe:Zn antagonismo es el modulador dominante
  // Fuente: guia v2 "Zn alto + Cu bajo -> bloqueo ODC" y "Fe:Zn"
  if      (zn >= 2.0) addDelta('N3_ZINC', +10, 'Zn pool suficiente — enzimas Zn-dependientes activas');
  else if (zn >= 0.5) addDelta('N3_ZINC', +4,  'Zn disponible — moderado');
  else if (zn < 0.1)  addDelta('N3_ZINC', -10, 'Zn ausente — enzimas Zn-dependientes inactivas');
  if (feZn !== null && feZn > 3) addDelta('N3_ZINC', -12, 'Fe:Zn=' + feZn.toFixed(1) + ' — antagonismo severo, Zn biologicamente no disponible');
  if      (cu >= 0.3) addDelta('N3_ZINC', +4,  'Cu/Zn balance — sinergismo cofactor');
  else if (cu < 0.05) addDelta('N3_ZINC', -5,  'Cu ausente — desequilibrio Cu/Zn');

  // ── N3_MEMBRANE — Membranas vesiculares del Spitz
  // Fuente: guia v2 "SAM -> espermina, membranas vesiculares"
  if (met >= 0.1) addDelta('N3_MEMBRANE', +5, 'Met — precursor poliaminas/fosfatidilcolina');
  if (gly >= 0.1) addDelta('N3_MEMBRANE', +5, 'Gly — ensamble membrana');

  // ── N2_REDOX — Buffer redox / glutatión
  // Cys es precursora del glutatión (GSH)
  // Nota: Vit C (ascorbato) tambien actua como buffer redox
  const cys = A.cys_g || 0;
  const vitC = (V.C_mg || 0);
  if      (cys >= 0.1) addDelta('N2_REDOX', +8,  'Cys >= 0.1 g/L — sustrato glutatión disponible');
  else if (cys < 0.01) addDelta('N2_REDOX', -5,  'Cys ausente — glutatión sin sustrato');
  if (vitC >= 5) addDelta('N2_REDOX', +6, 'Vit C — ascorbato como buffer redox adicional');
  // Si Cu + Fe coexisten con Cys+VitC bajos -> ROS no tamponados (mencionado en INTERACTION_RULES)
  if (cu >= 0.3 && fe >= 1 && cys < 0.01 && vitC < 2) {
    addDelta('N2_REDOX', -10, 'Cu+Fe altos sin buffer redox (Cys+VitC bajos) — ROS peroxidan membranas');
  }

  // ════════════════════════════════════════════════════════════════════
  // APLICAR DELTAS ACUMULADOS CON CAPPING
  // ════════════════════════════════════════════════════════════════════
  Object.keys(deltas).forEach(function(routeId) {
    const st = routeStates[routeId];
    if (!st) return;
    // No tocar rutas que fueron forzadas a INACTIVA por precipitacion u otra logica critica
    if (st.precipitationOverride) return;

    const routeDeltas = deltas[routeId];
    const totalDelta = clamp(routeDeltas.reduce(function(s, x) { return s + x.d; }, 0));
    if (!totalDelta) return;

    // Guardar para trazabilidad
    if (!st.compositionModifiers) st.compositionModifiers = [];
    routeDeltas.forEach(function(x) { st.compositionModifiers.push(x); });
    st.compositionDelta = totalDelta;

    // Aplicar al intensity (score numerico visible en el grafo)
    const oldIntensity = st.intensity || 0;
    const newIntensity = Math.max(0, Math.min(100, oldIntensity + totalDelta));
    st.intensity = Math.round(newIntensity);

    // Para rutas contribBased: re-derivar status de forma consistente
    // Para rutas trigger-based: preservar status categorico (color del nodo)
    if (st.contribBased) {
      st.status = newIntensity <= 0  ? 'INACTIVA'
                : newIntensity >= 75 ? 'ACTIVA'
                :                      'LIMITADA';
    }
  });
}


function calcCN(ingRows, allIngs) {
  let c = 0, n = 0, masa = 0;
  ingRows.forEach(ing => {
    const live = allIngs.find(x => x.id === ing.id);
    const meta = ing.snapshot ? Object.assign({ id: ing.id }, ing.snapshot) : live;
    if (!meta) return;

    const proy   = ing.proy || 0;
    const qty    = ing.qty || ing.cant || 0;
    // unidad: campo explícito del ítem > snapshot > live > fallback 'gr'
    const unidad = ing.unidad || meta.unidad || 'gr';
    const qtyGr  = toGrams(qty * (1 + proy / 100), unidad);

    let aC = 0, aN = 0;
    if (meta.pc > 0) aC = qtyGr * (meta.pc / 100);
    else if (meta.aspecto === 'Carbono') aC = qtyGr;
    if (meta.pn > 0) aN = qtyGr * (meta.pn / 100);
    else if (meta.aspecto === 'Nitrógeno') aN = qtyGr;

    c += aC; n += aN; masa += qty;
  });
  return { c, n, masa, cn: n > 0 ? c / n : null };
}

/** Calcula índice rizomórfico 0-100 a partir del estado de las rutas. */
function calcRizomorfico(routeStates, cn) {
  let totalW = 0, score = 0;
  ROUTES.filter(r => !r.isOutput).forEach(r => {
    const st = routeStates[r.id]?.status || 'INACTIVA';
    const state = routeStates[r.id] || {};
    // Fix Bug 3: scoring continuo para rutas contribBased.
    // Sin esto, LIMITADA(intensity=20) y LIMITADA(intensity=60) contribuyen igual → frascos idénticos.
    let _factor;
    if (state.contribBased && typeof state.intensity === 'number') {
      const lv = state.intensity; // 0-100 ya normalizado por _routeMaxPossible
      _factor = lv <= 0 ? 0 : Math.min(1.0, lv / 75);
      if (st === 'EXCESO')      _factor *= 0.55;
      else if (st === 'EXCESO_CRIT') _factor *= 0.10;
    } else {
      _factor = STATUS_FACTOR[st] ?? 0;
    }
    score += r.weight * _factor;
    totalW += r.weight;
  });
  let v = totalW > 0 ? (score / totalW) * 100 : 0;
  // Modificador C/N: óptimo ~10, tolerancia ±4
  if (cn != null && isFinite(cn)) {
    const dist = Math.max(0, Math.abs(cn - 10) - 4);
    const penalty = Math.min(0.3, dist * 0.04);
    v *= (1 - penalty);
  }
  return Math.max(0, Math.min(100, v));
}

function resolverCantidadAdvisor(ing, cepaId, strainRngs, learnData) {
  if (cepaId && strainRngs) {
    var sr = strainRngs.find(function(x) {
      return x.geneticaId === cepaId && x.ingId === ing.id && x.source === 'aplicado' &&
             x.min != null && x.max != null;
    });
    if (sr) {
      return { qty: Math.round(((sr.min + sr.max) / 2) * 100) / 100, unidad: ing.unidad || null, source: 'cepa' };
    }
  }
  if (learnData && learnData[ing.id] && learnData[ing.id].rizoHits >= 2) {
    var ld = learnData[ing.id];
    return { qty: ld.avgQty, unidad: ing.unidad || null, source: 'learn' };
  }
  if (ing.rangoBase && typeof ing.rangoBase.min === 'number' && typeof ing.rangoBase.max === 'number'
      && ing.rangoBase.max >= ing.rangoBase.min) {
    var mid = Math.round(((ing.rangoBase.min + ing.rangoBase.max) / 2) * 100) / 100;
    return { qty: mid, unidad: ing.rangoBase.unidad || ing.unidad || null, source: 'base' };
  }
  return { qty: null, unidad: ing.unidad || null, source: null };
}

function calcRecomendaciones(formulaIngs, cepaId) {
  try {
    var states = calcEstadoRutas(formulaIngs, cepaId);
    var allIngs = readIngredientes();
    var strainRngs = cepaId ? gArr(K.strainRng) : [];
    var activeIngIds = formulaIngs.filter(function(fi) { return (fi.qty || 0) > 0; }).map(function(fi) { return fi.ingId || fi.id; }).filter(Boolean);
    var learnData = (typeof rizoLearnGet === 'function') ? (rizoLearnGet().data || {}) : {};
    var resultado = [];

    ROUTES.forEach(function(ruta) {
      if (ruta.isOutput) return;
      var estado = states[ruta.id];
      if (estado && estado.status === 'ACTIVA') return;

      var sugerencias = [];

      (ruta.activators || []).forEach(function(activador) {
        if (!(activador.name instanceof RegExp)) return;
        allIngs.forEach(function(ing) {
          if (activeIngIds.includes(ing.id)) return;
          if (!activador.name.test(ing.nombre || '')) return;
          if (sugerencias.find(function(s) { return s.ingId === ing.id; })) return;
          var cantidad = resolverCantidadAdvisor(ing, cepaId, strainRngs, learnData);
          var ld = learnData[ing.id];
          sugerencias.push({
            ingId:      ing.id,
            nombre:     ing.nombre,
            qty:        cantidad.qty,
            unidad:     cantidad.unidad,
            source:     cantidad.source,
            rizoHits:   ld ? ld.rizoHits    : 0,
            totalForms: ld ? ld.totalFormulas : 0
          });
        });
      });

      // Rankear: mayor tasa rizo primero, luego alfabético
      sugerencias.sort(function(a, b) {
        var aRate = a.totalForms > 0 ? a.rizoHits / a.totalForms : -1;
        var bRate = b.totalForms > 0 ? b.rizoHits / b.totalForms : -1;
        if (aRate !== bRate) return bRate - aRate;
        return (a.nombre || '').localeCompare(b.nombre || '');
      });

      resultado.push({
        rutaId:     ruta.id,
        rutaNombre: ruta.name,
        rutaColor:  ruta.color || 'var(--ac)',
        sugerencias: sugerencias.slice(0, 5)
      });
    });

    return resultado;
  } catch(e) {
    console.error('[CILAB] calcRecomendaciones error:', e);
    return [];
  }
}

/** Devuelve una línea explicativa del cuello de botella principal del score rizomórfico.
 *  Prioridad: exceso crítico → C/N fuera de rango → ruta más pesada inactiva/limitada/exceso.
 *  Lenguaje simple, sin jerga técnica — orientado al cultivador. */
function rizoBottleneckHint(routeStates, cn) {
  // 1. Exceso crítico — urgencia máxima
  for (const r of ROUTES) {
    if (r.isOutput) continue;
    const st = routeStates[r.id];
    if (st?.critFlag) {
      const trig = (st.triggers || []).find(t => t.status === 'EXCESO_CRIT');
      if (trig) {
        const lim = trig.range?.alertaCritica?.min != null
          ? ` · reducí por debajo de ${trig.range.alertaCritica.min}`
          : ' · reducí urgente';
        return `${trig.ing.nombre} en exceso crítico${lim}`;
      }
    }
  }

  // 2. C/N muy fuera de rango
  if (cn != null && isFinite(cn)) {
    if (cn < 4)  return `C/N muy bajo (${cn.toFixed(1)}) · añadí más fuente de carbono`;
    if (cn > 22) return `C/N muy alto (${cn.toFixed(1)}) · reducí la fuente de carbono`;
  }

  // 3. Ruta más pesada con mayor penalización
  const candidates = ROUTES
    .filter(r => !r.isOutput)
    .map(r => {
      const rs  = routeStates[r.id] || {};
      const st  = rs.status || 'INACTIVA';
      const pen = 1 - (STATUS_FACTOR[st] ?? 0); // 1 = máximo costo, 0 = sin costo
      return { r, st, score: r.weight * pen, triggers: rs.triggers || [] };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return 'Convergencia favorable · todas las rutas en rango';

  const { r, st, triggers } = candidates[0];
  const allIngs = readIngredientes();

  if (st === 'INACTIVA') {
    const act = r.activators?.[0];
    const sugg = act?.role ? `añadí ${act.role}` : `activá la ruta ${r.short}`;
    return `${r.short} sin activar · ${sugg}`;
  }

  if (st === 'LIMITADA') {
    const trig = triggers.find(t => t.status === 'LIMITADA');
    if (trig?.ing) {
      const opt  = trig.range?.rangoOptimo;
      const unit = allIngs.find(i => i.id === trig.ing.id)?.unidad || '';
      const suf  = opt ? ` · subilo a ${opt.min}–${opt.max}${unit ? ' ' + unit : ''}` : ' · ajustá al rango óptimo';
      return `${trig.ing.nombre} por debajo del óptimo${suf}`;
    }
    return `${r.short} limitada · ajustá la concentración al rango óptimo`;
  }

  if (st === 'EXCESO') {
    const trig = triggers.find(t => t.status === 'EXCESO');
    if (trig?.ing) {
      const opt = trig.range?.rangoOptimo;
      const suf = opt ? ` · bajalo a ${opt.min}–${opt.max}` : ' · reducí la dosis';
      return `${trig.ing.nombre} en exceso${suf}`;
    }
  }

  if (st === 'SIN_DATOS') {
    return `${r.short} sin rangos configurados · definí un rango óptimo en la Biblioteca`;
  }

  return 'Ajustá las concentraciones para un score más preciso';
}

function detectActiveInteractions(formulaIngs) {
  const allIngs = readIngredientes();
  const active = [];
  
  // 1) Reglas legacy (hardcoded INTERACTION_RULES)
  INTERACTION_RULES.forEach(rule => {
    const present = rule.ingIds.map(ingId => {
      const fi = formulaIngs.find(f => f.id === ingId && (f.qty || 0) > 0);
      if (!fi) return null;
      const ing = allIngs.find(x => x.id === ingId);
      return { ing: ing || { id: ingId, nombre: ingId, unidad: '' }, qty: fi.qty };
    });
    if (present.some(p => p === null)) return;
    if (rule.condicion && !rule.condicion(formulaIngs)) return;
    active.push(Object.assign({}, rule, { ingsPresentes: present }));
  });

  // 2) Nuevas interacciones críticas extraídas (CRITICAL_INTERACTIONS)
  CRITICAL_INTERACTIONS.forEach(inter => {
    const activeIngIds = formulaIngs.filter(fi => (fi.qty || 0) > 0).map(fi => fi.id);

    // Condición "ambos_presentes" (default): todos los ingredientes de la regla presentes
    const allPresent = inter.ingredientes.every(id => activeIngIds.includes(id));

    // Condición "ausencia_complementaria": trigger presente pero complemento ausente
    let ausenciaAlert = false;
    if (inter.condicion === 'ausencia_complementaria' && inter.ingAusente) {
      const triggerPresente = inter.ingredientes.every(id => activeIngIds.includes(id));
      const complementoAusente = !activeIngIds.includes(inter.ingAusente);
      ausenciaAlert = triggerPresente && complementoAusente;
    }

    // Reglas "ausencia_complementaria": SOLO disparar cuando el complemento
    // esta realmente ausente. El allPresent del trigger solo (ingredientes=[ING-XXXX])
    // NO debe activar la regla — de lo contrario dispara siempre que el trigger
    // existe, incluso cuando el complemento esta presente.
    if (inter.condicion === 'ausencia_complementaria') {
      if (!ausenciaAlert) return;
    } else {
      if (!allPresent) return;
    }

    const present = inter.ingredientes.map(ingId => {
      const fi = formulaIngs.find(f => f.id === ingId && (f.qty || 0) > 0);
      if (!fi) return null;
      const ing = allIngs.find(x => x.id === ingId);
      return { ing: ing || { id: ingId, nombre: ingId, unidad: '' }, qty: fi.qty };
    }).filter(Boolean);

    const descripcion = ausenciaAlert
      ? inter.msg
      : inter.msg;

    active.push({
      id: inter.id,
      ingIds: inter.ingredientes,
      ingsPresentes: present,
      tipo: inter.severity === 'sinergia' ? 'sinergia' : 'interaccion',
      severidad: inter.severity === 'critica' ? 'critica' : 'advertencia',
      esSinergia: inter.severity === 'sinergia',
      rutasAfectadas: inter.rutasAfectadas,
      titulo: inter.nombre,
      descripcion,
      sugerencia: ausenciaAlert
        ? `Agregar ingrediente faltante (${inter.ingAusente}) para resolver esta alerta.`
        : 'Revisar proporciones en el panel de analizador.',
      esAusencia: ausenciaAlert,
      ingAusente: inter.ingAusente || null
    });
  });

  return active;
}

function buildInteractionOverlaysSVG(activeInteractions) {
  if (!activeInteractions.length) return '';
  const out = [];
  const routesAffected = new Set();
  activeInteractions.forEach(rule => rule.rutasAfectadas.forEach(rId => routesAffected.add(rId)));
  routesAffected.forEach(routeId => {
    const route = ROUTES.find(r => r.id === routeId);
    if (!route) return;
    const [cx, cy] = route.pos;
    const baseR = route.isOutput ? RIZO_R : NODE_R;
    const rulesForRoute = activeInteractions.filter(rule => rule.rutasAfectadas.includes(routeId));
    const hasCritical = rulesForRoute.some(r => r.severidad === 'critica');
    const color = hasCritical ? '#FF2244' : '#FFC000';
    const icon = hasCritical ? '!' : '?';
    out.push(`
      <circle class="clab-interaction-ring" cx="${cx}" cy="${cy}" r="${baseR + 8}"
        style="stroke:${color};fill:none;stroke-width:2;opacity:0.85">
        <animate attributeName="r" values="${baseR + 6};${baseR + 12};${baseR + 6}"
          dur="${hasCritical ? '1s' : '2s'}" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.9;0.3;0.9"
          dur="${hasCritical ? '1s' : '2s'}" repeatCount="indefinite"/>
      </circle>
      <text x="${cx}" y="${cy - baseR - 14}" text-anchor="middle"
        class="clab-interaction-icon"
        style="fill:${color};font-size:13px;cursor:pointer;pointer-events:auto"
        onclick="clabOpenInteractionDetail('${routeId}')">${icon}</text>`);
  });
  return out.join('\n');
}

function markSliderConflicts(activeInteractions) {
  document.querySelectorAll('.clab-slider-row').forEach(row => {
    row.classList.remove('clab-conflict-critico', 'clab-conflict-advertencia');
    const badge = row.querySelector('.clab-conflict-badge');
    if (badge) badge.remove();
  });
  if (!activeInteractions.length) return;
  const ingConflicts = {};
  activeInteractions.forEach(rule => {
    rule.ingIds.forEach(ingId => {
      if (!ingConflicts[ingId]) ingConflicts[ingId] = [];
      ingConflicts[ingId].push(rule);
    });
  });
  Object.entries(ingConflicts).forEach(([ingId, rules]) => {
    const row = document.querySelector(`.clab-slider-row[data-ing="${ingId}"]`);
    if (!row) return;
    const hasCritical = rules.some(r => r.severidad === 'critica');
    row.classList.add(hasCritical ? 'clab-conflict-critico' : 'clab-conflict-advertencia');
    const nameEl = row.querySelector('.clab-slider-name');
    if (!nameEl || nameEl.querySelector('.clab-conflict-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'clab-conflict-badge';
    badge.textContent = hasCritical ? '!' : '?';
    badge.title = rules.map(r => r.titulo).join(' | ');
    nameEl.appendChild(badge);
  });
}

function buildRouteSuggestionsHTML(routeId, currentStatus) {
  if (currentStatus === 'ACTIVA') return '';
  const allIngs = readIngredientes();
  const meta = loadMeta();
  const route = ROUTES.find(r => r.id === routeId);
  if (!route || route.isOutput) return '';
  const candidates = allIngs.filter(ing => {
    const m = meta[ing.id] || {};
    if (Array.isArray(m.rutas)) return m.rutas.includes(routeId);
    return (route.activators || []).some(a => a.name && a.name.test(ing.nombre || ''));
  });
  if (!candidates.length) return '';
  const currentIngs = _getEffectiveIngs();
  const inFormula = new Set(currentIngs.map(i => i.id));
  const inFormulaCands = candidates.filter(c => inFormula.has(c.id));
  const missingCands = candidates.filter(c => !inFormula.has(c.id));
  let html = `<div class="clab-detail-section"><h4>Ingredientes que activarían esta ruta</h4>`;
  if (inFormulaCands.length) {
    html += `<div class="clab-help" style="margin-bottom:6px">Ya están en la fórmula: revisar cantidad efectiva.</div>`;
    html += inFormulaCands.map(ing => {
      const m = meta[ing.id] || {};
      const opt = m.rangoOptimo;
      const cur = currentIngs.find(i => i.id === ing.id);
      return `<div class="clab-detail-trigger-row">
        <span class="clab-detail-trigger-name" style="color:var(--wn)">${esc(ing.nombre)}</span>
        <span class="clab-detail-trigger-qty">${(+(cur?.qty || 0)).toFixed(2)} ${esc(ing.unidad || '')}</span>
        ${opt ? `<span class="clab-detail-trigger-range">opt ${opt.min}-${opt.max}</span>` : '<span class="clab-detail-trigger-range">sin rango</span>'}
      </div>`;
    }).join('');
  }
  if (missingCands.length) {
    html += `<div class="clab-help" style="margin:10px 0 6px">No están en la fórmula: posibles candidatos.</div>`;
    html += missingCands.map(ing => {
      const m = meta[ing.id] || {};
      const opt = m.rangoOptimo;
      return `<div class="clab-detail-trigger-row" style="opacity:0.85">
        <span class="clab-detail-trigger-name" style="color:var(--ac4)">${esc(ing.nombre)}</span>
        <span class="clab-detail-trigger-qty">${esc(ing.unidad || '')}</span>
        ${opt ? `<span class="clab-detail-trigger-range">dosis ${opt.min}-${opt.max}</span>` : '<span class="clab-detail-trigger-range">sin rango</span>'}
      </div>`;
    }).join('');
  }
  html += `</div>`;
  return html;
}

/** Genera alertas accionables a partir de los estados. Cada alerta puede
 *  llevar un campo `action` con la sugerencia concreta para aplicar:
 *    { type:'set', ingId, qty, btnLabel } */
// ════════════════════════════════════════════
// CÁLCULO DE ARGININA TOTAL ACUMULADA
// Lee composition.aminoacidos.arg_g de cada ingrediente y suma al pool.
// Incluye arginina libre (ING-0006) y citrulina efectiva (ING-0017 × CIT_TO_ARG_FACTOR).
// Helper parseCompositionPer: normaliza qty al campo "per" del ingrediente.
// ════════════════════════════════════════════
function _parseCompositionPer(per, qty, unidad) {
  // Devuelve el factor de escala: aporte_real = valor_raw × factor
  // "per" describe la unidad de referencia de los valores en composition
  if (!per || !qty || qty <= 0) return 0;
  const qtyGr = toGrams(qty, unidad); // convertir a gramos para normalizar
  if (per === '1g' || per === '1_g') return qtyGr;          // valor por 1g → multiplicar por gramos
  if (per === '100g')                 return qtyGr / 100;    // valor por 100g
  if (per === '1_comprimido' || per === '1_capsula') {
    // qty en unidades (ud) — no pasar por toGrams
    return unidad === 'ud' ? qty : (qty / 1); // qty directo si es discreta
  }
  return qtyGr; // fallback conservador
}

function calcArgTotal(formulaIngs, allIngs) {
  let argTotal_g = 0;
  const breakdown = [];

  (formulaIngs || []).forEach(function(fi) {
    if ((fi.qty || 0) <= 0) return;
    const ing = allIngs.find(function(x) { return x.id === fi.id; });
    if (!ing) return;

    // Arginina libre directa (ING-0006 se procesa aquí también vía composition
    // o como qty directa si no tiene composition.aminoacidos)
    const bio = ing.bio || {};
    const comp = bio.composition || null;

    if (comp && comp.aminoacidos && comp.aminoacidos.arg_g != null) {
      const unidad = fi.unidad || ing.unidad || 'gr';
      const factor = _parseCompositionPer(comp.per, fi.qty, unidad);
      const aporte = (comp.aminoacidos.arg_g || 0) * factor;
      if (aporte > 0) {
        argTotal_g += aporte;
        breakdown.push({ ingId: fi.id, nombre: ing.nombre || fi.id, argAporte_g: aporte, via: 'composition' });
      }
    } else if (fi.id === 'ING-0006') {
      // Arginina libre sin composition: qty directa en gramos
      const qtyGr = toGrams(fi.qty, fi.unidad || ing.unidad || 'gr');
      if (qtyGr > 0) {
        argTotal_g += qtyGr;
        breakdown.push({ ingId: fi.id, nombre: ing.nombre || fi.id, argAporte_g: qtyGr, via: 'directo' });
      }
    }

    // Citrulina efectiva (ING-0017): suma aparte sobre lo anterior
    if (fi.id === 'ING-0017') {
      const citGr = toGrams(fi.qty, fi.unidad || ing.unidad || 'mg');
      const argEquiv = citGr * CIT_TO_ARG_FACTOR;
      // Solo agregar si composition no declara arg_g > 0 real (arg_g=0 en citrulina = no hay arginina directa)
      if (argEquiv > 0 && !(comp && comp.aminoacidos && comp.aminoacidos.arg_g > 0)) {
        argTotal_g += argEquiv;
        breakdown.push({ ingId: fi.id, nombre: ing.nombre || fi.id, argAporte_g: argEquiv, via: `citrulina×${CIT_TO_ARG_FACTOR}` });
      }
    }
  });

  return { argTotal_g, breakdown };
}

// ════════════════════════════════════════════════════════════════════════
// ETAPA 2 — POOLS DE COMPOSICION QUIMICA
// Cada funcion recorre formulaIngs, resuelve allIngs, aplica
// _parseCompositionPer para normalizar a la unidad real de la formula,
// y acumula el aporte por ingrediente con trazabilidad completa.
// INVARIANTE: misma ruta de normalizacion que calcArgTotal.
// ════════════════════════════════════════════════════════════════════════

function calcMineralPool(formulaIngs, allIngs, routeStates) {
  const KEYS = ['Fe_mg','Zn_mg','Cu_mg','Mn_mg','Mg_mg','Ca_mg','K_mg','P_mg','S_mg'];
  const pool = {};
  const breakdown = {};
  KEYS.forEach(function(k) { pool[k] = 0; breakdown[k] = []; });

  (formulaIngs || []).forEach(function(fi) {
    if ((fi.qty || 0) <= 0) return;
    const ing = allIngs.find(function(x) { return x.id === fi.id; });
    if (!ing) return;
    const comp = (ing.bio || {}).composition;
    if (!comp || !comp.minerales) return;
    const unidad = fi.unidad || ing.unidad || 'gr';
    const factor = _parseCompositionPer(comp.per, fi.qty, unidad);
    if (!factor) return;
    KEYS.forEach(function(k) {
      const val = comp.minerales[k];
      if (val && val > 0) {
        const aporte = val * factor;
        pool[k] += aporte;
        breakdown[k].push({ ingId: fi.id, nombre: ing.nombre || fi.id, aporte: aporte });
      }
    });
  });

  // Precipitacion CaCO3 + KH2PO4: Ca efectivo = 0
  // No corrompe el pool calculado — lo marca para display correcto
  const caPrecipitado = !!(routeStates && routeStates['N3_SPITZ'] && routeStates['N3_SPITZ'].precipitationOverride);

  // Ratio Fe:Zn — antagonismo de biodisponibilidad conocido en micelios
  const feZnRatio = pool.Zn_mg > 0 ? pool.Fe_mg / pool.Zn_mg : null;

  return { pool: pool, breakdown: breakdown, feZnRatio: feZnRatio, caPrecipitado: caPrecipitado };
}

function calcVitaminPool(formulaIngs, allIngs) {
  // B7 y B9 en ug; resto en mg. Se preservan unidades originales del JSON.
  const KEYS = ['B1_mg','B2_mg','B3_mg','B5_mg','B6_mg','B7_ug','B9_ug','B12_ug','C_mg'];
  const pool = {};
  const breakdown = {};
  KEYS.forEach(function(k) { pool[k] = 0; breakdown[k] = []; });

  (formulaIngs || []).forEach(function(fi) {
    if ((fi.qty || 0) <= 0) return;
    const ing = allIngs.find(function(x) { return x.id === fi.id; });
    if (!ing) return;
    const comp = (ing.bio || {}).composition;
    if (!comp || !comp.vitaminas) return;
    const unidad = fi.unidad || ing.unidad || 'gr';
    const factor = _parseCompositionPer(comp.per, fi.qty, unidad);
    if (!factor) return;
    KEYS.forEach(function(k) {
      const val = comp.vitaminas[k];
      if (val && val > 0) {
        const aporte = val * factor;
        pool[k] += aporte;
        breakdown[k].push({ ingId: fi.id, nombre: ing.nombre || fi.id, aporte: aporte });
      }
    });
  });

  return { pool: pool, breakdown: breakdown };
}

function calcAminoPool(formulaIngs, allIngs) {
  // Perfil completo — no duplica calcArgTotal, lo reemplaza en el panel
  const KEYS = [
    'arg_g','met_g','gly_g','cys_g','lys_g','his_g',
    'ile_g','leu_g','val_g','phe_g','thr_g','trp_g',
    'ala_g','asp_g','glu_g','gln_g','pro_g','ser_g',
    'tyr_g','orn_g','tau_g'
  ];
  const pool = {};
  const breakdown = {};
  KEYS.forEach(function(k) { pool[k] = 0; breakdown[k] = []; });

  (formulaIngs || []).forEach(function(fi) {
    if ((fi.qty || 0) <= 0) return;
    const ing = allIngs.find(function(x) { return x.id === fi.id; });
    if (!ing) return;
    const comp = (ing.bio || {}).composition;
    if (!comp || !comp.aminoacidos) return;
    const unidad = fi.unidad || ing.unidad || 'gr';
    const factor = _parseCompositionPer(comp.per, fi.qty, unidad);
    if (!factor) return;
    KEYS.forEach(function(k) {
      const val = comp.aminoacidos[k];
      if (val && val > 0) {
        const aporte = val * factor;
        pool[k] += aporte;
        breakdown[k].push({ ingId: fi.id, nombre: ing.nombre || fi.id, aporte: aporte });
      }
    });
  });

  // Citrulina -> arginina: misma logica que calcArgTotal, sin duplicar
  // Solo aplica si composition.aminoacidos.arg_g == 0 o no existe
  (formulaIngs || []).forEach(function(fi) {
    if (fi.id !== 'ING-0017') return;
    if ((fi.qty || 0) <= 0) return;
    const ing = allIngs.find(function(x) { return x.id === fi.id; });
    if (!ing) return;
    const comp = (ing.bio || {}).composition;
    const argFromComp = comp && comp.aminoacidos ? (comp.aminoacidos.arg_g || 0) : 0;
    if (argFromComp > 0) return; // ya se proceso via composition loop
    const citGr = toGrams(fi.qty, fi.unidad || ing.unidad || 'mg');
    const argEquiv = citGr * CIT_TO_ARG_FACTOR;
    if (argEquiv > 0) {
      pool.arg_g += argEquiv;
      breakdown.arg_g.push({ ingId: fi.id, nombre: ing.nombre || fi.id, aporte: argEquiv, via: 'citrulina' });
    }
  });

  return { pool: pool, breakdown: breakdown };
}

// ════════════════════════════════════════════════════════════════════════
// ETAPA 3 — PANEL DE COMPOSICION INTERACTIVO
// Renderiza los tres pools en tiempo real en #clab-chem-panel.
// Es precipitationOverride-aware: muestra Ca efectivo = 0 cuando aplica.
// No modifica routeStates — es display puro sobre datos ya calculados.
// ════════════════════════════════════════════════════════════════════════

function renderChemPanel(formulaIngs, allIngs, routeStates) {
  const el = document.getElementById('clab-chem-panel');
  if (!el) return;

  const activeIngs = (formulaIngs || []).filter(function(fi) { return (fi.qty || 0) > 0; });
  if (!activeIngs.length) {
    el.innerHTML = '<div class="clab-chem-empty">Agrega ingredientes para ver el perfil bioquimico.</div>';
    return;
  }

  const mineralRes = calcMineralPool(activeIngs, allIngs, routeStates);
  const vitRes     = calcVitaminPool(activeIngs, allIngs);
  const aminoRes   = calcAminoPool(activeIngs, allIngs);

  // ── Helpers de render ─────────────────────────────────────────────
  function pct(val, max) {
    if (!max || max === 0) return 0;
    return Math.min(100, (val / max) * 100);
  }

  function fmtVal(val, decimals) {
    decimals = decimals == null ? 3 : decimals;
    if (val === 0) return '0';
    if (val < 0.001) return val.toExponential(1);
    return val.toFixed(decimals);
  }

  function barColor(pctVal, thresholdWarn, thresholdDanger) {
    if (pctVal >= thresholdDanger) return 'var(--er)';
    if (pctVal >= thresholdWarn)   return 'var(--st-exceso)';
    return 'var(--ac4)';
  }

  function buildBreakdownTooltip(bkArr) {
    if (!bkArr || !bkArr.length) return '';
    return bkArr.map(function(b) {
      const suffix = b.via ? ' [' + b.via + ']' : '';
      return esc(b.nombre) + ': ' + fmtVal(b.aporte) + suffix;
    }).join('\n');
  }

  function buildBar(val, maxVal, color, extraClass) {
    extraClass = extraClass || '';
    const w = pct(val, maxVal);
    return '<div class="clab-chem-bar-track' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="clab-chem-bar-fill" style="width:' + w.toFixed(1) + '%;background:' + color + '"></div>' +
      '</div>';
  }

  // ── Seccion aminoacidos ────────────────────────────────────────────
  // Solo mostramos los que tienen aporte > 0, ordenados desc
  const AA_META = {
    arg_g: { label: 'Arg', route: 'N2_NO_PKG / ETC',    warn: 3.0,  crit: 3.5,  unit: 'g/L' },
    met_g: { label: 'Met', route: 'N3_SAM / metilacion', warn: 2.0,  crit: 4.0,  unit: 'g/L' },
    gly_g: { label: 'Gly', route: 'N3_CHITIN / membrana',warn: 5.0,  crit: 10.0, unit: 'g/L' },
    cys_g: { label: 'Cys', route: 'REDOX / glutatión',   warn: 1.5,  crit: 3.0,  unit: 'g/L' },
    lys_g: { label: 'Lys', route: 'estructural',          warn: 4.0,  crit: 8.0,  unit: 'g/L' },
    glu_g: { label: 'Glu', route: 'N pool / NH3 tampon', warn: 8.0,  crit: 15.0, unit: 'g/L' },
    asp_g: { label: 'Asp', route: 'ciclo TCA',            warn: 5.0,  crit: 10.0, unit: 'g/L' },
    ala_g: { label: 'Ala', route: 'N transfer',           warn: 5.0,  crit: 10.0, unit: 'g/L' },
    pro_g: { label: 'Pro', route: 'osmoprotección',       warn: 4.0,  crit: 8.0,  unit: 'g/L' },
    gln_g: { label: 'Gln', route: 'N amida',              warn: 3.0,  crit: 6.0,  unit: 'g/L' },
    orn_g: { label: 'Orn', route: 'N2_ODC (pre-PUT)',     warn: 1.5,  crit: 3.0,  unit: 'g/L' },
    his_g: { label: 'His', route: 'histidina kinasa',     warn: 2.0,  crit: 4.0,  unit: 'g/L' },
    leu_g: { label: 'Leu', route: 'TOR/sensor nutric.',    warn: 5.0,  crit: 10.0, unit: 'g/L' },
    ile_g: { label: 'Ile', route: 'BCAA / energia',        warn: 3.0,  crit: 8.0,  unit: 'g/L' },
    val_g: { label: 'Val', route: 'BCAA / gluconeog.',     warn: 3.0,  crit: 8.0,  unit: 'g/L' },
    phe_g: { label: 'Phe', route: 'aromático',             warn: 2.0,  crit: 6.0,  unit: 'g/L' },
    thr_g: { label: 'Thr', route: 'precursor Gly / Ser',  warn: 2.0,  crit: 6.0,  unit: 'g/L' },
    tyr_g: { label: 'Tyr', route: 'aromat. / señal',      warn: 1.5,  crit: 4.0,  unit: 'g/L' },
    trp_g: { label: 'Trp', route: 'IAA / serotonina',     warn: 0.5,  crit: 1.5,  unit: 'g/L' },
    ser_g: { label: 'Ser', route: 'fosfolipidos / Cys',   warn: 2.0,  crit: 6.0,  unit: 'g/L' },
    tau_g: { label: 'Tau', route: 'osmoproteccion / ROS', warn: 0.5,  crit: 2.0,  unit: 'g/L' },
    asn_g: { label: 'Asn', route: 'N amida / transp.',    warn: 2.0,  crit: 5.0,  unit: 'g/L' },
  };

  const aaEntries = Object.keys(aminoRes.pool)
    .filter(function(k) { return aminoRes.pool[k] > 0; })
    .sort(function(a, b) { return aminoRes.pool[b] - aminoRes.pool[a]; });

  const maxAA = aaEntries.length ? aminoRes.pool[aaEntries[0]] : 1;

  let aaRows = '';
  aaEntries.forEach(function(k) {
    const val = aminoRes.pool[k];
    const m = AA_META[k];
    const isCrit  = val >= m.crit;
    const isWarn  = val >= m.warn;
    const color   = isCrit ? 'var(--er)' : isWarn ? 'var(--st-exceso)' : 'var(--ac4)';
    const badge   = isCrit ? '<span class="clab-chem-badge crit">ALTO</span>'
                  : isWarn  ? '<span class="clab-chem-badge warn">LIMITE</span>'
                  : '';
    const tooltip = buildBreakdownTooltip(aminoRes.breakdown[k]);
    const w = pct(val, maxAA).toFixed(1);
    aaRows += '<div class="clab-chem-row" title="' + tooltip + '">' +
      '<div class="clab-chem-label">' + esc(m.label) + badge + '</div>' +
      '<div class="clab-chem-bar-track"><div class="clab-chem-bar-fill" style="width:' + w + '%;background:' + color + '"></div></div>' +
      '<div class="clab-chem-val">' + fmtVal(val, 3) + ' <span class="clab-chem-unit">g/L</span></div>' +
      '<div class="clab-chem-route">' + esc(m.route) + '</div>' +
      '</div>';
  });
  if (!aaRows) aaRows = '<div class="clab-chem-empty-sub">Sin aminoacidos detectados en esta formula.</div>';

  // ── Seccion minerales ──────────────────────────────────────────────
  const MIN_META = {
    Fe_mg: { label: 'Fe',  route: 'N1_ETC (complejo IV)', warn: 5,   crit: 15,  themeColor: '#FF6B6B' },
    Zn_mg: { label: 'Zn',  route: 'N3_ZINC / ODC', warn: 3,   crit: 8,   themeColor: '#4ECDC4' },
    Cu_mg: { label: 'Cu',  route: 'lacasa / SOD', warn: 1,   crit: 3,   themeColor: '#FFE66D' },
    Mn_mg: { label: 'Mn',  route: 'Mn-SOD / ligninasa', warn: 0.5, crit: 2,   themeColor: '#A8E6CF' },
    Mg_mg: { label: 'Mg',  route: 'ATP-Mg / N1_GLYC', warn: 50,  crit: 200, themeColor: '#88D8B0' },
    Ca_mg: { label: 'Ca',  route: 'pared celular / N3_SPITZ', warn: 50,  crit: 200, themeColor: '#C7B3E5' },
    P_mg:  { label: 'P',   route: 'ATP / fosfolipidos', warn: 100, crit: 400, themeColor: '#96CEB4' },
    K_mg:  { label: 'K',   route: 'osmoregulacion', warn: 200, crit: 800, themeColor: '#FFEAA7' },
  };

  const minEntries = Object.keys(MIN_META).filter(function(k) { return mineralRes.pool[k] > 0; });
  const maxMin = minEntries.length ? Math.max.apply(null, minEntries.map(function(k) { return mineralRes.pool[k]; })) : 1;

  let minRows = '';
  minEntries.forEach(function(k) {
    const val = mineralRes.pool[k];
    const m = MIN_META[k];
    const isCa = k === 'Ca_mg';
    const effectiveVal = (isCa && mineralRes.caPrecipitado) ? 0 : val;
    const isCrit = effectiveVal >= m.crit;
    const isWarn = effectiveVal >= m.warn;
    const isZero = isCa && mineralRes.caPrecipitado;
    const color  = isZero ? 'var(--st-inactiva)'
                 : isCrit ? 'var(--er)'
                 : isWarn ? 'var(--st-exceso)'
                 : m.themeColor;
    const badge  = isZero ? '<span class="clab-chem-badge precip" title="Ca precipitado por fosfato">PRECIP</span>'
                 : isCrit ? '<span class="clab-chem-badge crit">ALTO</span>'
                 : isWarn ? '<span class="clab-chem-badge warn">LIMITE</span>'
                 : '';
    const displayVal = isZero ? '<span style="color:var(--st-inactiva)">0 <span class="clab-chem-unit">mg/L</span> <span style="color:var(--er);font-size:9px">(bruto: ' + fmtVal(val, 1) + ')</span></span>'
                              : fmtVal(effectiveVal, 1) + ' <span class="clab-chem-unit">mg/L</span>';
    const w = isZero ? '0' : pct(effectiveVal, maxMin).toFixed(1);
    const tooltip = buildBreakdownTooltip(mineralRes.breakdown[k]);
    minRows += '<div class="clab-chem-row" title="' + tooltip + '">' +
      '<div class="clab-chem-label">' + esc(m.label) + badge + '</div>' +
      '<div class="clab-chem-bar-track"><div class="clab-chem-bar-fill" style="width:' + w + '%;background:' + color + '"></div></div>' +
      '<div class="clab-chem-val">' + displayVal + '</div>' +
      '<div class="clab-chem-route">' + esc(m.route) + '</div>' +
      '</div>';
  });

  // Fe:Zn ratio
  let feZnHtml = '';
  if (mineralRes.feZnRatio !== null) {
    const r = mineralRes.feZnRatio;
    const rCls  = r > 3  ? 'crit' : r > 1.5 ? 'warn' : 'ok';
    const rNote = r > 3  ? 'antagonismo severo — Zn biodisponible reducido'
                : r > 1.5 ? 'tension competitiva Fe/Zn'
                : 'ratio equilibrado';
    feZnHtml = '<div class="clab-chem-ratio ' + rCls + '">Fe:Zn = ' + r.toFixed(2) + ' — ' + esc(rNote) + '</div>';
  }
  if (!minRows) minRows = '<div class="clab-chem-empty-sub">Sin minerales detectados en esta formula.</div>';

  // ── Seccion vitaminas ──────────────────────────────────────────────
  // Umbrales minimos funcionales para cofactores enzimaticos fúngicos
  const VIT_META = {
    B1_mg:  { label: 'B1',  route: 'PDH / N1_GLYC',  min_ok: 0.1,  unit: 'mg/L', color: '#FFB347' },
    B2_mg:  { label: 'B2',  route: 'FAD/FMN · ETC',  min_ok: 0.1,  unit: 'mg/L', color: '#87CEEB' },
    B3_mg:  { label: 'B3',  route: 'NAD+ / N1_ETC',  min_ok: 0.5,  unit: 'mg/L', color: '#98D982' },
    B5_mg:  { label: 'B5',  route: 'CoA biosintesis', min_ok: 0.1,  unit: 'mg/L', color: '#DDA0DD' },
    B6_mg:  { label: 'B6',  route: 'ODC / N2_ODC',   min_ok: 0.05, unit: 'mg/L', color: '#F4A460' },
    B7_ug:  { label: 'B7',  route: 'carboxilasas',    min_ok: 5,    unit: 'ug/L', color: '#20B2AA' },
    B9_ug:  { label: 'B9',  route: 'ciclo SAM / N3',  min_ok: 20,   unit: 'ug/L', color: '#90EE90' },
    B12_ug: { label: 'B12', route: 'SAM / N3_SAM',    min_ok: 0.5,  unit: 'ug/L', color: '#9370DB' },
    C_mg:   { label: 'C',   route: 'REDOX / ascorbato / ROS', min_ok: 5.0,  unit: 'mg/L', color: '#FF6B6B' },
  };

  const vitEntries = Object.keys(VIT_META);
  const maxVit = Math.max.apply(null, vitEntries.map(function(k) { return vitRes.pool[k] || 0; }).concat([0.001]));

  let vitRows = '';
  vitEntries.forEach(function(k) {
    const val = vitRes.pool[k] || 0;
    const m = VIT_META[k];
    const ok = val >= m.min_ok;
    const color = ok ? m.color : 'var(--st-inactiva)';
    const badge = !ok && val > 0 ? '<span class="clab-chem-badge low">BAJO</span>'
                : !ok           ? '<span class="clab-chem-badge absent">-</span>'
                : '';
    const w = pct(val, maxVit).toFixed(1);
    const tooltip = buildBreakdownTooltip(vitRes.breakdown[k]);
    const displayVal = val > 0 ? fmtVal(val, val < 1 ? 3 : 2) + ' <span class="clab-chem-unit">' + m.unit + '</span>'
                               : '<span style="color:var(--st-inactiva)">no detectado</span>';
    vitRows += '<div class="clab-chem-row" title="' + tooltip + '">' +
      '<div class="clab-chem-label">' + esc(m.label) + badge + '</div>' +
      '<div class="clab-chem-bar-track"><div class="clab-chem-bar-fill" style="width:' + w + '%;background:' + color + '"></div></div>' +
      '<div class="clab-chem-val">' + displayVal + '</div>' +
      '<div class="clab-chem-route">' + esc(m.route) + '</div>' +
      '</div>';
  });

  // ── Alerta de deficiencias criticas para rutas ─────────────────────
  const vitAlerts = [];
  const b1 = vitRes.pool.B1_mg || 0;
  const b6 = vitRes.pool.B6_mg || 0;
  const b12 = vitRes.pool.B12_ug || 0;
  const b9  = vitRes.pool.B9_ug || 0;
  if (b1 < 0.05)  vitAlerts.push('<span class="clab-chem-badge crit">B1 insuf.</span> PDH limitada — glucolisis comprometida (N1_GLYC)');
  if (b6 < 0.03)  vitAlerts.push('<span class="clab-chem-badge crit">B6 insuf.</span> ODC inactiva — sin poliaminas (N2_ODC)');
  if (b12 < 0.1)  vitAlerts.push('<span class="clab-chem-badge warn">B12 bajo</span> Ciclo SAM incompleto (N3_SAM)');
  if (b9  < 10)   vitAlerts.push('<span class="clab-chem-badge warn">B9 bajo</span> Metilacion reducida — impacta N3_SAM');

  const vitAlertHtml = vitAlerts.length
    ? '<div class="clab-chem-vitalerts">' + vitAlerts.join('<br>') + '</div>'
    : '';

  // ── Ensamble final del panel ───────────────────────────────────────
  el.innerHTML =
    '<div class="clab-chem-panel-inner">' +

    '<div class="clab-chem-section">' +
    '<div class="clab-chem-section-title">Aminoacidos</div>' +
    aaRows +
    '</div>' +

    '<div class="clab-chem-section">' +
    '<div class="clab-chem-section-title">Minerales traza</div>' +
    minRows +
    feZnHtml +
    '</div>' +

    '<div class="clab-chem-section">' +
    '<div class="clab-chem-section-title">Vitaminas B</div>' +
    vitRows +
    vitAlertHtml +
    '</div>' +

    '</div>';
}


function buildAlertsList(routeStates, formulaIngs, cn) {
  const alerts = [];
  const allIngs = readIngredientes();
  const meta = loadMeta();

  // Pre-calcular pools de composicion para reglas cruzadas
  // (reutiliza las funciones de Etapa 2 — cero recalculo adicional)
  const _activeIngs = (formulaIngs || []).filter(fi => (fi.qty || 0) > 0);
  const _minRes = _activeIngs.length ? calcMineralPool(_activeIngs, allIngs, routeStates) : null;
  const _vitRes = _activeIngs.length ? calcVitaminPool(_activeIngs, allIngs) : null;
  const _aaRes  = _activeIngs.length ? calcAminoPool(_activeIngs, allIngs) : null;
  const M = _minRes ? _minRes.pool : {};
  const V = _vitRes ? _vitRes.pool : {};
  const A = _aaRes  ? _aaRes.pool  : {};
  const feZn = _minRes ? _minRes.feZnRatio : null;

  // ── Helper: intensidad de exceso (cuanto pasa el limite)
  function excessIntensity(qty, limit, base) {
    if (!limit || limit <= 0) return base || 70;
    return Math.min(100, (base || 65) + Math.round((qty / limit - 1) * 80));
  }
  // ── Helper: intensidad de deficit (cuanto falta)
  function deficitIntensity(qty, target, base) {
    if (!target || target <= 0) return base || 30;
    return Math.min(85, (base || 20) + Math.round((1 - qty / target) * 70));
  }
  // ── Helper: interpolacion lineal de intensidad entre dos umbrales
  function lerp(val, lo, hi, outLo, outHi) {
    if (val <= lo) return outLo;
    if (val >= hi) return outHi;
    return Math.round(outLo + (outHi - outLo) * (val - lo) / (hi - lo));
  }

  const KIND_PRI = { danger: 4, warn: 3, watch: 2, info: 1, ok: 0 };

  // ════════════════════════════════════════════════════════════════════
  // 1) Excesos criticos — maxima prioridad
  // ════════════════════════════════════════════════════════════════════
  Object.entries(routeStates).forEach(([rid, st]) => {
    if (!st.critFlag) return;
    const trig = (st.triggers || []).find(t => t.status === 'EXCESO_CRIT');
    if (!trig) return;
    const trigName = trig.ing.nombre || 'ingrediente';
    const trigMeta = trig.range;
    const msg = trigMeta?.alertaCritica?.msg || 'Sobredosis con consecuencia bioquimica.';
    const critLim = trigMeta?.alertaCritica?.limite || trigMeta?.rangoSeguro?.max;
    const intensity = excessIntensity(trig.qty, critLim, 75);
    const target = trigMeta?.rangoOptimo
      ? +(((trigMeta.rangoOptimo.min + trigMeta.rangoOptimo.max) / 2).toFixed(2))
      : null;
    alerts.push({
      kind: 'danger', icon: '⚠', intensity,
      text: `<b>${esc(trigName)}</b> — exceso critico (${trig.qty.toFixed(2)}). ${esc(msg)}`,
      action: target != null ? { type: 'set', ingId: trig.ing.id, qty: target, btnLabel: `→ Reducir a ${target}` } : null,
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 2) Rutas inactivas — sugerencias multi-ingrediente
  // ════════════════════════════════════════════════════════════════════
  {
    const activeIngIds = _activeIngs.map(fi => fi.ingId || fi.id).filter(Boolean);
    const cepaId = '';
    const strainRngs = cepaId ? gArr(K.strainRng) : [];
    const learnData = (typeof rizoLearnGet === 'function') ? (rizoLearnGet().data || {}) : {};

    ROUTES.filter(r => !r.isOutput).forEach(r => {
      const st = routeStates[r.id]?.status;
      if (st !== 'INACTIVA') return;

      const sugerencias = [];
      (r.activators || []).forEach(act => {
        if (!(act.name instanceof RegExp)) return;
        allIngs.forEach(ing => {
          if (activeIngIds.includes(ing.id)) return;
          if (!act.name.test(ing.nombre || '')) return;
          if (sugerencias.find(s => s.ingId === ing.id)) return;
          const cantidad = resolverCantidadAdvisor(ing, cepaId, strainRngs, learnData);
          const ld = learnData[ing.id];
          sugerencias.push({
            ingId:      ing.id,
            nombre:     ing.nombre,
            qty:        cantidad.qty,
            unidad:     cantidad.unidad,
            source:     cantidad.source,
            rizoHits:   ld ? ld.rizoHits     : 0,
            totalForms: ld ? ld.totalFormulas : 0,
          });
        });
      });

      sugerencias.sort((a, b) => {
        const aRate = a.totalForms > 0 ? a.rizoHits / a.totalForms : -1;
        const bRate = b.totalForms > 0 ? b.rizoHits / b.totalForms : -1;
        if (aRate !== bRate) return bRate - aRate;
        return (a.nombre || '').localeCompare(b.nombre || '');
      });

      const intensity = Math.min(95, 40 + Math.round((r.weight || 10) * 2.5));
      alerts.push({
        kind: 'warn', icon: '◌', intensity,
        text: `Ruta <b>${esc(r.short)}</b> inactiva — falta activador.`,
        sugerencias: sugerencias.slice(0, 3),
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 3) Excesos no criticos
  // ════════════════════════════════════════════════════════════════════
  Object.entries(routeStates).forEach(([rid, st]) => {
    if (st.critFlag || st.status !== 'EXCESO') return;
    const trig = (st.triggers || []).find(t => t.status === 'EXCESO');
    if (!trig) return;
    const optMax = trig.range?.rangoOptimo?.max;
    const intensity = optMax ? excessIntensity(trig.qty, optMax, 40) : 45;
    const target = optMax ?? null;
    alerts.push({
      kind: 'warn', icon: '↑', intensity,
      text: `<b>${esc(trig.ing.nombre)}</b> sobre rango optimo (${trig.qty.toFixed(2)}). Considerar reducir.`,
      action: target != null ? { type: 'set', ingId: trig.ing.id, qty: target, btnLabel: `→ Reducir a ${target}` } : null,
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 4) Rutas en LIMITADA — sugerir subir al optimo
  // ════════════════════════════════════════════════════════════════════
  Object.entries(routeStates).forEach(([rid, st]) => {
    if (st.status !== 'LIMITADA') return;
    const trig = (st.triggers || []).find(t => t.status === 'LIMITADA');
    if (!trig) return;
    const opt = trig.range?.rangoOptimo;
    if (!opt || trig.qty >= opt.min) return;
    const intensity = deficitIntensity(trig.qty, opt.min, 20);
    alerts.push({
      kind: 'info', icon: '↓', intensity,
      text: `<b>${esc(trig.ing.nombre)}</b> por debajo del optimo (${trig.qty.toFixed(2)} < ${opt.min}). Aumentar activaria la ruta.`,
      action: { type: 'set', ingId: trig.ing.id, qty: opt.min, btnLabel: `→ Aumentar a ${opt.min}` },
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 5) C/N graduado
  // ════════════════════════════════════════════════════════════════════
  if (cn != null && isFinite(cn)) {
    if      (cn < 4)  alerts.push({ kind: 'danger', icon: 'C/N', intensity: 85, text: `C/N = <b>${cn.toFixed(2)}</b> — N extremo. Micelio tomentoso garantizado. Reducir drasticamente N o agregar fuente de carbono.` });
    else if (cn < 6)  alerts.push({ kind: 'warn',   icon: 'C/N', intensity: lerp(cn, 4, 6, 85, 55), text: `C/N = <b>${cn.toFixed(2)}</b> baja. Pool de N excedente — riesgo tomentosidad. Aumentar fuente de carbono o reducir N.` });
    else if (cn > 22) alerts.push({ kind: 'warn',   icon: 'C/N', intensity: lerp(cn, 22, 35, 55, 85), text: `C/N = <b>${cn.toFixed(2)}</b> alta. Limitacion de N — micelio ralo. Agregar levadura/peptona/arginina o reducir carbono.` });
    else if (cn > 18) alerts.push({ kind: 'watch',  icon: 'C/N', intensity: lerp(cn, 18, 22, 25, 55), text: `C/N = <b>${cn.toFixed(2)}</b> — acercandose al limite superior (optimo 6-18). Monitorear.` });
  }

  // ════════════════════════════════════════════════════════════════════
  // 5a) Arginina efectiva — graduada en 4 zonas
  // ════════════════════════════════════════════════════════════════════
  const argResult = calcArgTotal(formulaIngs, allIngs);
  const argG = argResult.argTotal_g;
  if (argG > 3.5) {
    const bdHtml = argResult.breakdown.map(b => `<b>${esc(b.nombre)}</b>: ${b.argAporte_g.toFixed(3)}g`).join(' + ');
    const maxC = argResult.breakdown.reduce((a, b) => b.argAporte_g > a.argAporte_g ? b : a, { argAporte_g: 0 });
    alerts.push({
      kind: 'danger', icon: '⚗', intensity: Math.min(100, 85 + Math.round((argG - 3.5) * 30)),
      text: `<b>Arg efectiva: ${argG.toFixed(3)} g/L</b> — PARADOJA ETC. NO inhibe Complejo IV. <span style="font-size:0.9em;opacity:0.7">${bdHtml}</span>`,
      action: maxC.ingId ? { type: 'set', ingId: maxC.ingId, qty: 0, btnLabel: `→ Reducir ${esc(maxC.nombre)}` } : null,
    });
  } else if (argG > 3.0) {
    alerts.push({ kind: 'warn',  icon: '⚗', intensity: lerp(argG, 3.0, 3.5, 65, 84), text: `<b>Arg efectiva: ${argG.toFixed(3)} g/L</b> — zona limite (3.0–3.5). Control fino: considerar bajar e incorporar citrulina.` });
  } else if (argG > 2.5) {
    alerts.push({ kind: 'watch', icon: '⚗', intensity: lerp(argG, 2.5, 3.0, 35, 64), text: `<b>Arg efectiva: ${argG.toFixed(3)} g/L</b> — acercandose al limite. ODC optimo, fNOS activa. Vigilar si sigue subiendo.` });
  }

  // ════════════════════════════════════════════════════════════════════
  // 5b) Precipitacion CaCO3 + KH2PO4
  // ════════════════════════════════════════════════════════════════════
  if (routeStates['N3_SPITZ']?.precipitationOverride) {
    const cacl2 = allIngs.find(i => i.id === 'ING-0020');
    let cacl2Action = null;
    if (cacl2) {
      const cm = meta[cacl2.id];
      const opt = cm?.rangoOptimo ?? (cacl2.rangoBase?.min != null && cacl2.rangoBase?.max != null ? cacl2.rangoBase : null);
      if (opt) {
        const target = +(((opt.min + opt.max) / 2).toFixed(2));
        const unidad = cacl2.unidad || '';
        cacl2Action = { type: 'set', ingId: cacl2.id, qty: target,
          btnLabel: `→ Agregar CaCl₂ a ${target}${unidad ? ' ' + unidad : ''}` };
      }
    }
    alerts.push({
      kind: 'danger', icon: '⚗', intensity: 90,
      text: `<b>N3_SPITZ BLOQUEADA — precipitacion</b>: CaCO₃ + KH₂PO₄ forman Ca₃(PO₄)₂ insoluble. Ca²⁺ libre ≈ 0. Spitzenkörper sin gradiente calico.`,
      action: cacl2Action,
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 6) Interacciones criticas entre ingredientes — pool-aware
  //
  // Antes de emitir cada alerta, verifica si el pool de composicion
  // (M, V, A — calculados al inicio con TODAS las fuentes) ya satisface
  // la condicion bioquimica subyacente de la regla.
  //
  // Logica de supresion:
  //   - Si el pool RESUELVE la condicion → suprimir el danger/warn
  //     y emitir un mensaje 'ok' educativo UNA sola vez (dedup por categoria).
  //   - Threshold de emision del 'ok': solo cuando estamos CLARAMENTE en
  //     zona saludable (> limite de [C3]/[C5] etc.) para no duplicar con
  //     los mensajes de vigilancia de la seccion de composicion.
  //   - Si el pool NO resuelve la condicion → emitir el warning original.
  // ════════════════════════════════════════════════════════════════════
  const _ciSuppressed = new Set(); // categorias ya emitidas como 'ok' (dedup)

  detectActiveInteractions(formulaIngs).forEach(rule => {
    // Construir set de IDs bioquimicamente involucrados en esta regla
    // (ingredientes trigger + ingrediente ausente si es regla de ausencia)
    const ruleIdSet = new Set(
      [...(rule.ingIds || []), rule.ingAusente || ''].filter(Boolean)
    );

    const involvesMet  = ruleIdSet.has('ING-0019');  // L-Metionina
    const involvesGly  = ruleIdSet.has('ING-0025');  // Glicocola
    const involvesB12r = involvesMet && ruleIdSet.has('ING-0024'); // Becozym como reciclador SAM
    const involvesZnFe = ruleIdSet.has('ING-0021') && ruleIdSet.has('ING-0023'); // Zn+Fe

    // ── POOL CHECK 1: Met + Gly (balance homocisteina → N3_CHITIN)
    //
    // La Gly puede llegar de agar, levadura, peptona, glicocola, o cualquier
    // sustrato que contribuya al pool de aminoacidos. CRITICAL_INTERACTIONS
    // solo sabe si ING-0025 (glicocola pura) esta o no en la formula, pero
    // ignora las contribuciones naturales de todos los demas ingredientes.
    //
    // Threshold de supresion: gly >= 0.08 g/L (el pool cubre la necesidad).
    // Threshold de mensaje 'ok': gly >= 0.15 g/L (zona claramente saludable,
    // sin solaparse con el mensaje 'watch' de [C3] que cubre 0.08–0.15).
    // Cualquier regla que involucre Met y NO sea estrictamente sobre B12/SAH:
    // verificar si el pool de gly cubre la necesidad bioquimica.
    // Cubre: INT-015 (ambos), INT-016 (ausencia gly), INT-026 (met presente),
    // y cualquier regla futura con semantica Met+Gly aunque no tenga ingAusente.
    const isMetGlyRule = involvesMet && !involvesB12r && !involvesZnFe;
    if (isMetGlyRule) {
      const glyTotal = A.gly_g || 0;
      if (glyTotal >= 0.08) {
        if (glyTotal >= 0.15 && !_ciSuppressed.has('MET_GLY')) {
          _ciSuppressed.add('MET_GLY');
          alerts.push({
            kind: 'ok', icon: '✓', intensity: 62,
            text: `<b>Met+Gly balanceados</b> — Gly total = ${(glyTotal * 1000).toFixed(0)} mg/L de fuentes combinadas (agar, levadura, peptona, sustratos y/o glicocola directa). Reciclado de homocisteina activo: Met → SAH → Hcy → Met cierra sin acumulacion. N3_CHITIN protegida.`,
          });
        }
        return; // suprimir el danger/warn de CRITICAL_INTERACTIONS en cualquier caso
      }
    }

    // ── POOL CHECK 2: Met + B12 (metionina sintasa — ciclo SAM sin freno SAH)
    //
    // INT-026 e INT-027 alertan cuando ING-0019 esta presente sin ING-0024
    // (Becozym). Pero B12 puede venir de Pharmaton (ING-0009) u otras fuentes.
    // Si el pool de B12 cubre el minimo funcional (0.3 µg/L) el ciclo SAM
    // funciona aunque Becozym no este explicitamente en la formula.
    if (involvesB12r) {
      const b12Total = V.B12_ug || 0;
      if (b12Total >= 0.3) {
        if (!_ciSuppressed.has('MET_B12')) {
          _ciSuppressed.add('MET_B12');
          alerts.push({
            kind: 'ok', icon: '✓', intensity: 55,
            text: `<b>B12 suficiente para ciclo SAM</b> — B12 total = ${b12Total.toFixed(2)} µg/L de fuentes combinadas. Metionina sintasa activa. SAH → homocisteina → Met reciclado eficientemente. Sin freno SAH sobre metiltransferasas apicales.`,
          });
        }
        return;
      }
    }

    // ── POOL CHECK 3: Fe:Zn (antagonismo de biodisponibilidad — N3_ZINC)
    //
    // INT-029 alerta cuando Zn (ING-0021) y Fe (ING-0023) coexisten.
    // Pero si el ratio Fe:Zn ya es bajo (< 1.5), el antagonismo es insignificante
    // y el Zn libre esta disponible para RNA pol II y metiltransferasas.
    if (involvesZnFe && feZn !== null && feZn < 1.5) {
      if (!_ciSuppressed.has('ZN_FE')) {
        _ciSuppressed.add('ZN_FE');
        alerts.push({
          kind: 'ok', icon: '✓', intensity: 45,
          text: `<b>Fe:Zn = ${feZn.toFixed(1)} — ratio equilibrado</b>. Zn²⁺ libre sin antagonismo significativo de Fe. RNA pol II y metiltransferasas apicales con cofactor disponible. N3_ZINC sin limitacion por competencia.`,
        });
      }
      return;
    }

    // ── Sin supresion: emitir el warning/danger original
    const sevKind = rule.severidad === 'critica' ? 'danger' : 'warn';
    const intensity = rule.severidad === 'critica' ? 78 : 48;
    const ingNames = rule.ingsPresentes.map(p => `<b>${esc(p.ing.nombre)}</b>`).join(' + ');
    alerts.push({
      kind: sevKind, icon: rule.severidad === 'critica' ? '!' : '?', intensity,
      text: `${ingNames}: ${esc(rule.descripcion)} <span style="opacity:0.7">${esc(rule.sugerencia)}</span>`,
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // ALERTAS DE COMPOSICION — cruzadas, graduadas, tiempo real
  // ════════════════════════════════════════════════════════════════════

  // [C1] Fe:Zn — antagonismo de biodisponibilidad (4 zonas)
  if (feZn !== null) {
    if      (feZn > 5.0) alerts.push({ kind: 'danger', icon: 'Fe:Zn', intensity: lerp(feZn, 5, 8, 80, 98), text: `<b>Fe:Zn = ${feZn.toFixed(1)}</b> — antagonismo severo. Zn biologicamente no disponible. ODC bloqueada (N2_ODC), N3_ZINC comprometido. Reducir Fe o agregar Zn quelado.` });
    else if (feZn > 3.0) alerts.push({ kind: 'warn',   icon: 'Fe:Zn', intensity: lerp(feZn, 3, 5, 55, 79), text: `<b>Fe:Zn = ${feZn.toFixed(1)}</b> — tension competitiva. Zn biodisponible reducido → ODC suboptima → menos poliaminas → Spitz debilitado.` });
    else if (feZn > 1.5) alerts.push({ kind: 'watch',  icon: 'Fe:Zn', intensity: lerp(feZn, 1.5, 3, 20, 54), text: `<b>Fe:Zn = ${feZn.toFixed(1)}</b> — vigilar. Competencia Fe/Zn incipiente. Aun dentro de rango tolerable.` });
  }

  // [C2] B6 insuficiente con Arginina alta — ODC sin cofactor (N2_ODC bottleneck)
  const b6 = V.B6_mg || 0;
  if (argG > 2.0 && b6 < 0.05) {
    const intensity = (argG > 2.5 && b6 < 0.03) ? 82 : lerp(argG, 2.0, 3.5, 45, 80);
    alerts.push({
      kind: b6 < 0.03 ? 'danger' : 'warn', icon: 'B6', intensity,
      text: `<b>B6 = ${b6.toFixed(3)} mg/L con Arg = ${argG.toFixed(2)} g/L</b> — ODC sin cofactor PLP. La arginina llega pero la ODC no puede procesarla. Agregar B6 (piridoxina, Becozym, o Pharmaton).`,
    });
  }

  // [C3] Metionina sin Glicina — acumulacion de homocisteina
  const met = A.met_g || 0;
  const gly = A.gly_g || 0;
  if (met > 0.3) {
    if (gly < 0.02) {
      alerts.push({ kind: 'danger', icon: 'Met/Gly', intensity: Math.min(88, 65 + Math.round(met * 30)), text: `<b>Met ${met.toFixed(3)} g/L sin Gly (${gly.toFixed(3)} g/L)</b> — homocisteina se acumula. Dana sintesis de quitina (N3_CHITIN) y SAM. Agregar Glicina (ING-0025) ≥ 100mg/L.`, action: { type: 'set', ingId: 'ING-0025', qty: 0.1, btnLabel: '→ Agregar Gly 0.10 gr' } });
    } else if (gly < 0.08) {
      alerts.push({ kind: 'warn', icon: 'Met/Gly', intensity: lerp(gly, 0.08, 0.02, 40, 64), text: `<b>Met ${met.toFixed(3)} g/L — Gly bajo (${gly.toFixed(3)} g/L)</b>. Reciclado de folatos suboptimo. Considerar aumentar Glicina (optimo ≥ 100mg/L junto a metionina).` });
    } else if (gly < 0.15) {
      alerts.push({ kind: 'watch', icon: 'Met/Gly', intensity: 25, text: `<b>Met presente — Gly = ${gly.toFixed(3)} g/L</b>. En el limite del optimo (100mg/L). Reciclado de folatos correcto pero ajustado.` });
    }
  }

  // [C4] Cu + Fe altos sin buffer redox — ROS danan el apice
  const cu = M.Cu_mg || 0;
  const fe = M.Fe_mg || 0;
  const cys = A.cys_g || 0;
  const vitC = V.C_mg || 0;
  const redoxBuffer = cys * 200 + vitC; // peso relativo: cys es 200x mas potente que VitC en mM
  if (cu >= 0.3 && fe >= 2) {
    const rosRisk = (cu + fe * 0.3) - redoxBuffer * 0.01;
    if (rosRisk > 3) {
      alerts.push({ kind: 'danger', icon: 'ROS', intensity: Math.min(90, 65 + Math.round(rosRisk * 5)), text: `<b>Cu ${cu.toFixed(1)}mg + Fe ${fe.toFixed(1)}mg/L sin buffer redox</b> (Cys=${cys.toFixed(3)}g, VitC=${vitC.toFixed(1)}mg). ETC hipervactiva genera ROS → peroxidacion del Spitzenkörper (N3_MEMBRANE dañada). Agregar Cys o Acido ascorbico.` });
    } else if (rosRisk > 1) {
      alerts.push({ kind: 'warn', icon: 'ROS', intensity: lerp(rosRisk, 1, 3, 40, 64), text: `<b>Cu + Fe altos — buffer redox marginal</b>. ETC genera ROS que pueden danar membranas apicales. Considerar Acido ascorbico (ING-0029) 50-100mg/L.` });
    }
  }

  // [C5] B12 bajo con Metionina alta — SAM bloqueado
  const b12 = V.B12_ug || 0;
  if (met > 0.3 && b12 < 0.3) {
    const intensity = met > 0.5 && b12 < 0.1 ? 72 : 45;
    const kind = intensity > 65 ? 'warn' : 'watch';
    alerts.push({ kind, icon: 'B12', intensity, text: `<b>Met ${met.toFixed(3)} g/L — B12 = ${b12.toFixed(2)} ug/L</b>. Metionina sintasa (B12-dependiente) suboptima. Ciclo SAM incompleto aunque haya sustrato. Agregar Becozym o Pharmaton.` });
  }

  // [C6] B1 bajo con carga de carbono alta — cuello de botella PDH
  const b1 = V.B1_mg || 0;
  const glycLevel = routeStates['N1_GLYC'] ? (routeStates['N1_GLYC'].intensity || 0) : 0;
  if (b1 < 0.05 && glycLevel > 40) {
    alerts.push({ kind: 'warn', icon: 'B1', intensity: lerp(glycLevel, 40, 80, 50, 80), text: `<b>B1 = ${b1.toFixed(3)} mg/L con alta carga de carbono (N1_GLYC=${glycLevel})</b>. PDH sin cofactor: piruvato no entra al ciclo Krebs → fermentacion obligada → micelio menos eficiente. Agregar Tiamina (ING-0015) o Becozym.`, action: { type: 'set', ingId: 'ING-0015', qty: 50, btnLabel: '→ Agregar Tiamina 50 mg' } });
  }

  // [C7] Mn exceso — SOD hiperactiva + competencia con Fe/Zn
  const mn = M.Mn_mg || 0;
  if      (mn > 5)   alerts.push({ kind: 'danger', icon: 'Mn', intensity: lerp(mn, 5, 10, 75, 92), text: `<b>Mn = ${mn.toFixed(1)} mg/L</b> — exceso severo. Compite con Fe y Zn por metalotioneinas. Mn-SOD hiperactiva puede suprimir ROS necesarios para senalizacion de morfogenesis.` });
  else if (mn > 2)   alerts.push({ kind: 'warn',   icon: 'Mn', intensity: lerp(mn, 2, 5, 40, 74), text: `<b>Mn = ${mn.toFixed(1)} mg/L</b> — sobre rango optimo (0.5-2 mg/L). Vigilar competencia con Fe para ETC.` });

  // [C8] Arg:Gln ratio — afecta grosor de hifas (guia v2)
  const gln = A.gln_g || 0;
  if (gln > 0.05 && argG > 0) {
    const ratio = argG / gln;
    if      (ratio > 5) alerts.push({ kind: 'warn',  icon: 'Arg:Gln', intensity: lerp(ratio, 5, 8, 58, 78), text: `<b>Arg:Gln = ${ratio.toFixed(1)}:1</b> — ratio muy alto. Gln insuficiente para hifas gruesas. Micelio tendra rizomorfos finos (alta fNOS, baja quitina por hifa). Guia v2: optimo <3:1 para grosor.` });
    else if (ratio > 3) alerts.push({ kind: 'watch', icon: 'Arg:Gln', intensity: lerp(ratio, 3, 5, 25, 57), text: `<b>Arg:Gln = ${ratio.toFixed(1)}:1</b> — acercandose al limite. Por encima de 3:1 las hifas tienden a ser mas finas. Considerar bajar Arg o agregar Gln.` });
  }

  // [C9] Mg muy bajo con chitin activa — quitina sintetasa sin cofactor
  const mg = M.Mg_mg || 0;
  const chitinLevel = routeStates['N3_CHITIN'] ? (routeStates['N3_CHITIN'].intensity || 0) : 0;
  if (mg < 2 && chitinLevel > 30) {
    alerts.push({ kind: 'warn', icon: 'Mg', intensity: lerp(mg, 2, 0, 50, 78), text: `<b>Mg = ${mg.toFixed(1)} mg/L</b> — quitina sintetasa sin cofactor Mg²⁺ aunque N3_CHITIN tenga activadores. Pared celular debil. Agregar MgSO₄ (ING-0008).` });
  }

  // ════════════════════════════════════════════════════════════════════
  // 7) Sin metadata
  // ════════════════════════════════════════════════════════════════════
  formulaIngs.forEach(fi => {
    const ing = allIngs.find(x => x.id === fi.id);
    if (!ing) return;
    if (!meta[fi.id]) alerts.push({ kind: 'info', icon: '·', intensity: 15, text: `<b>${esc(ing.nombre)}</b> sin metadata — configurar en Biblioteca.` });
  });

  // ════════════════════════════════════════════════════════════════════
  // 8) Convergencia favorable
  // ════════════════════════════════════════════════════════════════════
  const activeCount = Object.values(routeStates).filter(s => s.status === 'ACTIVA').length;
  const totalNonOut = ROUTES.filter(r => !r.isOutput).length;
  if (activeCount >= totalNonOut - 1 && !alerts.some(a => a.kind === 'danger')) {
    alerts.push({ kind: 'ok', icon: '✓', intensity: 70, text: `Convergencia: ${activeCount}/${totalNonOut} rutas activas. Perfil favorable.` });
  }

  // Ordenar: kind priority desc, luego intensity desc
  alerts.sort((a, b) => {
    const kd = (KIND_PRI[b.kind] || 0) - (KIND_PRI[a.kind] || 0);
    return kd !== 0 ? kd : (b.intensity || 0) - (a.intensity || 0);
  });

  return alerts;
}

// ════════════════════════════════════════════
// GRAFO SVG — generación
// ════════════════════════════════════════════
const GRAPH_W = 820, GRAPH_H = 900;
const NODE_R = 30, RIZO_R = 44;

function buildGraphSVG(routeStates, opts) {
  opts = opts || {};
  const uid = opts.uid || 'main'; // ID único para evitar colisiones en comparaciones
  const out = [];
  out.push(`<svg class="clab-graph-svg" data-uid="${uid}" viewBox="0 0 ${GRAPH_W} ${GRAPH_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`);

  // Defs: marcadores de flecha con ID único
  out.push(`<defs>
    <marker id="clab-arr-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto" markerUnits="strokeWidth">
      <path d="M0,1 L9,5 L0,9 z" fill="currentColor" opacity="0.85"/>
    </marker>
    <marker id="clab-arr-inh-${uid}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth">
      <line x1="0" y1="1" x2="0" y2="9" stroke="currentColor" stroke-width="2.4"/>
    </marker>
  </defs>`);

  // Líneas guía + etiquetas de nivel (sincronizadas con pos[] de ROUTES)
  const levels = [
    { y: 100, label: 'N0 · CONDICIÓN AMBIENTAL' },
    { y: 240, label: 'N1 · ENERGÍA' },
    { y: 410, label: 'N2 · SEÑAL MORFOGENÉTICA' },
    { y: 590, label: 'N3 · ESTRUCTURA APICAL' },
  ];
  levels.forEach(l => {
    out.push(`<line class="clab-graph-level-line" x1="20" y1="${l.y}" x2="${GRAPH_W - 20}" y2="${l.y}"/>`);
    out.push(`<text class="clab-graph-level-label" x="22" y="${l.y - 36}">${esc(l.label)}</text>`);
  });
  out.push(`<text class="clab-graph-level-label" x="22" y="${GRAPH_H - 30}" style="fill:#00CC33">RIZOMORFISMO</text>`);

  // Aristas (debajo de los nodos)
  EDGES.forEach(e => {
    const fr = ROUTES.find(r => r.id === e.from);
    const to = ROUTES.find(r => r.id === e.to);
    if (!fr || !to) return;
    const fst = routeStates[e.from]?.status;
    const tst = routeStates[e.to]?.status;
    const fIntensity = routeStates[e.from]?.intensity ?? 0;
    const tIntensity = routeStates[e.to]?.intensity ?? 0;

    let cls = 'clab-edge';
    let active = false;
    if (e.kind === 'inhibition') {
      cls += ' inhibition';
      if (fst === 'EXCESO_CRIT' || fst === 'EXCESO') { cls += ' active'; active = true; }
    } else if (e.kind === 'modulator') {
      cls += ' modulator';
      if (fst === 'ACTIVA' || fst === 'LIMITADA' || fst === 'EXCESO') { cls += ' active'; active = true; }
    } else {
      const fa = (fst === 'ACTIVA' || fst === 'EXCESO');
      const ta = (tst === 'ACTIVA' || tst === 'EXCESO');
      if (fa && ta) { cls += ' active'; active = true; }
      else if ((fa || fst === 'LIMITADA') && tst !== 'INACTIVA' && tst !== 'SIN_DATOS') cls += ' partial';
    }

    // Intensidad de la arista: mínimo entre origen y destino (cuello de botella)
    const edgeIntensity = active ? Math.min(fIntensity, tIntensity) :
                          cls.includes('partial') ? Math.min(fIntensity, 48) : 0;

    const fromR = fr.isOutput ? RIZO_R : NODE_R;
    const toR   = to.isOutput ? RIZO_R : NODE_R;

    const x1 = fr.pos[0], y1 = fr.pos[1];
    const x2 = to.pos[0], y2 = to.pos[1];
    const dy = y2 - y1;
    let cx1, cy1, cx2, cy2, sx, sy, ex, ey;
    if (dy > 0) {
      sx = x1; sy = y1 + fromR;
      ex = x2; ey = y2 - toR;
      cx1 = x1; cy1 = y1 + fromR + dy * 0.45;
      cx2 = x2; cy2 = y2 - toR  - dy * 0.45;
    } else {
      sx = x1 + fromR * 0.95; sy = y1 - fromR * 0.3;
      ex = x2 + toR  * 0.95; ey = y2 + toR  * 0.3;
      cx1 = x1 + 90; cy1 = y1 - 50;
      cx2 = x2 + 90; cy2 = y2 + 50;
    }

    const path = `M ${sx},${sy} C ${cx1},${cy1} ${cx2},${cy2} ${ex},${ey}`;
    const marker = e.kind === 'inhibition' ? `clab-arr-inh-${uid}` : `clab-arr-${uid}`;
    const colorStyle = e.kind === 'inhibition' ? 'color:#C00000' :
                       e.kind === 'modulator'  ? 'color:#44AAFF' :
                       active ? 'color:#00CC33' : 'color:#666';

    // Intensidad visual en la arista: grosor y opacidad proporcionales
    let edgeInlineStyle = colorStyle;
    if (active) {
      const sw  = (1.5 + edgeIntensity * 1.8 / 100).toFixed(2);
      const op  = (0.42 + edgeIntensity * 0.58 / 100).toFixed(2);
      edgeInlineStyle += `;stroke-width:${sw};opacity:${op}`;
    }

    const pathId = `edge-${uid}-${e.from}-${e.to}`;
    out.push(`<path id="${pathId}" data-from="${e.from}" data-to="${e.to}" class="${cls}" d="${path}" style="${edgeInlineStyle}" marker-end="url(#${marker})"/>`);

    // Partículas — velocidad y tamaño proporcionales a intensidad
    if (active && e.kind !== 'inhibition') {
      // dur: 2.8s (intensity=0) → 1.0s (intensity=100)
      const dur  = (2.8 - edgeIntensity * 1.8 / 100).toFixed(2);
      const r    = (2.0 + edgeIntensity * 1.0 / 100).toFixed(1);
      out.push(`<circle class="clab-edge-particle" r="${r}">
        <animateMotion dur="${dur}s" repeatCount="indefinite" rotate="auto">
          <mpath href="#${pathId}"/>
        </animateMotion>
      </circle>`);
      // Segunda partícula desfasada cuando la ruta trabaja fuerte (intensity > 65)
      if (edgeIntensity > 65) {
        const begin = (parseFloat(dur) / 2).toFixed(2);
        out.push(`<circle class="clab-edge-particle" r="${r}" style="opacity:0.55">
          <animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" rotate="auto">
            <mpath href="#${pathId}"/>
          </animateMotion>
        </circle>`);
      }
    }

    if (e.label) {
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2 - 6;
      const lblCls = e.kind === 'inhibition' ? 'clab-edge-label warn' : 'clab-edge-label';
      out.push(`<text class="${lblCls}" x="${mx}" y="${my}" text-anchor="middle">${esc(e.label)}</text>`);
    }
  });

  // Nodos
  ROUTES.forEach(r => {
    const st = routeStates[r.id]?.status || 'INACTIVA';
    const isRizo = !!r.isOutput;
    const radius = isRizo ? RIZO_R : NODE_R;
    const ringR  = radius + 5;

    // Intensidad: para RIZO usamos rizoScore, para el resto la intensidad calculada por ruta.
    // EXCESO_CRIT siempre full opacity — el CSS ya lo flashea rojo, no queremos apagarlo.
    let intensity;
    if (isRizo) {
      intensity = Math.min(100, opts.rizoScore || 0);
    } else {
      intensity = routeStates[r.id]?.intensity ?? 0;
    }
    // Opacidad del nodo: RIZO usa rizoScore directo (su status es siempre INACTIVA
    // por ser nodo de salida — no hay triggers). Para el resto: INACTIVA→0.22.
    const nodeOpacity = isRizo
      ? parseFloat((0.35 + 0.65 * (intensity / 100)).toFixed(2))
      : st === 'INACTIVA'  ? 0.22
      : st === 'SIN_DATOS' ? 0.50
      : parseFloat((0.35 + 0.65 * (intensity / 100)).toFixed(2));

    let extraData = '';
    if (isRizo && opts.rizoScore != null) {
      const sc = opts.rizoScore;
      extraData = ` data-rscore-high="${sc >= 80 ? 1 : 0}" data-rscore-mid="${sc >= 50 && sc < 80 ? 1 : 0}" data-rscore-low="${sc < 50 ? 1 : 0}"`;
    }

    const grp = isRizo ? ' clab-node-rizo' : '';
    out.push(`<g class="clab-node${grp}" data-route="${esc(r.id)}" data-st="${st}" data-intensity="${Math.round(intensity)}"${extraData}
                onclick="clabOpenRouteDetail('${esc(r.id)}')"
                onmouseover="clabGraphHover('${uid}','${esc(r.id)}')"
                onmouseout="clabGraphHoverEnd('${uid}')"
                transform="translate(${r.pos[0]},${r.pos[1]})"
                style="color:${r.color};opacity:${nodeOpacity};cursor:pointer">`);
    out.push(`  <circle class="clab-node-ring" r="${ringR}"/>`);
    out.push(`  <circle class="clab-node-bg" r="${radius}"/>`);
    out.push(`  <text class="clab-node-icon" y="${isRizo ? '4' : '2'}"
                style="font-size:${isRizo ? '26' : '18'}px">${esc(r.icon || '·')}</text>`);
    out.push(`  <text class="clab-node-label" y="${radius + 16}">${esc(r.short)}</text>`);
    if (isRizo && opts.rizoScore != null) {
      out.push(`  <text class="clab-node-sublabel" y="${radius + 30}" style="fill:#00CC33;font-weight:700">${Math.round(opts.rizoScore)} / 100</text>`);
    } else if (routeStates[r.id]?.precipitationOverride) {
      // Nodo con precipitación: mostrar label diferenciado del INACTIVA genérico
      out.push(`  <text class="clab-node-sublabel" y="${radius + 30}" style="fill:#FF6B35;font-weight:700;font-size:8px">⚗ PRECIP.</text>`);
    } else {
      out.push(`  <text class="clab-node-sublabel" y="${radius + 30}">${esc(STATUS_LABEL[st] || st)}</text>`);
    }
    out.push(`</g>`);
  });

  // Hint de cuello de botella — una línea centrada al fondo del grafo
  if (opts.rizoHint) {
    out.push(`<text x="${GRAPH_W / 2}" y="${GRAPH_H - 8}"
      text-anchor="middle"
      style="font-family:'Inter',sans-serif;font-size:9px;fill:var(--tx2);font-style:italic;pointer-events:none"
      >${esc(opts.rizoHint)}</text>`);
  }

  out.push(buildInteractionOverlaysSVG(detectActiveInteractions(opts._formulaIngs || [])));
  out.push(`</svg>`);
  return out.join('\n');
}

// ════════════════════════════════════════════
// NOTIFICACIONES
// ════════════════════════════════════════════
let _notifTimer = null;
function notif(msg, kind) {
  const el = document.getElementById('clab-notif');
  if (!el) return;
  el.textContent = msg;
  el.className = 'clab-notif show' + ((kind === 'err' || kind === 'danger') ? ' err' : kind === 'ok' ? ' ok' : '');
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => { el.className = 'clab-notif'; }, 3000);
}

// ════════════════════════════════════════════
// SUBTABS
// ════════════════════════════════════════════
function clabSubTab(name) {
  document.querySelectorAll('.clab-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.clabtab === name));
  document.querySelectorAll('.clab-subpanel').forEach(p =>
    p.style.display = p.id === ('clab-sub-' + name) ? '' : 'none');

  if (name === 'analizador')   renderAnalyzer();
  if (name === 'biblioteca')   renderBiblio();
  if (name === 'strain')       renderStrain();
  if (name === 'ensayos')      renderEnsayos();
  if (name === 'conocimiento' && typeof renderConocimiento === 'function') renderConocimiento();
  if (name === 'inteligencia' && window.cilabInt) {
    window.cilabInt.renderInteligencia();
  }
  if (name === 'optimizador')  _buildOptimizerTab();
}

// ════════════════════════════════════════════
// HEADER STATS
// ════════════════════════════════════════════
function updateHeaderStats() {
  const ings = readIngredientes();
  const meta = loadMeta();
  const obs = gArr(K.obs);
  const validados = Object.values(meta).filter(m => m.estado === 'validado').length;
  const e1 = document.getElementById('clab-hdr-ings');     if (e1) e1.textContent = ings.length;
  const e2 = document.getElementById('clab-hdr-validados'); if (e2) e2.textContent = validados;
  const e3 = document.getElementById('clab-hdr-obs');      if (e3) e3.textContent = obs.length;
}

// ════════════════════════════════════════════
// ANALIZADOR — estado y flujo
// ════════════════════════════════════════════
const _state = {
  mode: 'formula',          // 'formula' | 'libre'
  formulaId: '',
  geneticaId: '',
  calibCepaId: '',          // Cepa seleccionada para calibración empírica en el analizador
  libreIngs: {},            // { ingId: qty } — modo libre
  formulaIngsOriginal: {},  // { ingId: qty } — valores tal como están guardados en bl2_forms
  formulaIngsCurrent:  {},  // { ingId: qty } — valores actuales (editados o no) en modo fórmula
  expFrascoIngs:  null,     // [{id, qty, type, ...}] — cuando se inspecciona un frasco de experimento
  expFrascoLabel: '',       // Texto del frasco activo, ej. "Frasco B · 500ml"
  expFrascoNormFactor: 1,   // Factor de escalado a 1000ml (ej: 2.0 para un frasco de 500ml)
  lastOptimizerResult: null,// Resultado del último cálculo de ⚡ OPTIMIZAR
  optimizerScenarioId: null,// 'A'|'B'|'C' cuando se abre el modal desde el optimizador
  libreCreateMode:     false,// true cuando el modal "Nueva Fórmula CI" viene de Modo libre
};

// Comparación de los dicts de ingredientes — devuelve true si hay diff respecto al original
function _formulaIsModified() {
  const o = _state.formulaIngsOriginal || {};
  const c = _state.formulaIngsCurrent  || {};
  const keys = new Set([...Object.keys(o), ...Object.keys(c)]);
  for (const k of keys) {
    const a = +(o[k] || 0), b = +(c[k] || 0);
    if (Math.abs(a - b) > 0.0001) return true;
  }
  return false;
}

// Carga la fórmula al state (para edición en vivo).
function _loadFormulaIntoState(formulaId) {
  _state.formulaIngsOriginal = {};
  _state.formulaIngsCurrent  = {};
  if (!formulaId) return;
  const f = readForms().find(x => x.id === formulaId);
  if (!f) return;
  (f.ingredientes || []).forEach(ing => {
    _state.formulaIngsOriginal[ing.id] = +ing.qty || 0;
    _state.formulaIngsCurrent[ing.id]  = +ing.qty || 0;
  });
}

/**
 * Retorna todos los IDs de fórmulas que comparten el mismo `nombre` que formulaId.
 * Siempre incluye el propio formulaId. Nunca lanza excepción.
 * Si nombre es null/'' → retorna [formulaId] sin agrupar.
 */
function _getFormulaFamilyIds(formulaId) {
  if (!formulaId) return [];
  const all = readForms();
  const f   = all.find(x => x.id === formulaId);
  if (!f)        return [formulaId];
  if (!f.nombre) return [formulaId];
  return all.filter(x => x.nombre === f.nombre).map(x => x.id);
}

/**
 * Construye Map<formulaId, 'v1'|'v2'|...> para fórmulas con nombre duplicado.
 * Fórmulas con nombre único no aparecen en el map.
 * Fórmulas con nombre null/'' no se agrupan.
 * Orden de versión: sort natural por id.
 */
function _buildFormulaVersionMap() {
  const vmap   = new Map();
  const byName = {};
  readForms().forEach(f => {
    if (!f.nombre) return;
    if (!byName[f.nombre]) byName[f.nombre] = [];
    byName[f.nombre].push(f.id);
  });
  Object.values(byName).forEach(ids => {
    if (ids.length < 2) return;
    ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    ids.forEach((id, i) => vmap.set(id, 'v' + (i + 1)));
  });
  return vmap;
}

function _populateFormulaSelect() {
  const sel = document.getElementById('clab-anal-formula');
  if (!sel) return;
  const forms = readForms();
  const prev  = sel.value;
  const vmap  = _buildFormulaVersionMap();
  sel.innerHTML = '<option value="">— Seleccionar fórmula CI —</option>' +
    forms.map(f => {
      const arch = f.archivada ? ' (archivada)' : '';
      const ver  = vmap.has(f.id) ? '  ' + vmap.get(f.id) : '';
      return `<option value="${esc(f.id)}">${esc(f.id)} · ${esc(f.nombre || 'Sin nombre')}${ver}${arch}</option>`;
    }).join('');
  if (prev && forms.find(f => f.id === prev)) sel.value = prev;
}

function _populateCepaSelect() {
  const sel = document.getElementById('clab-anal-cepa');
  if (!sel) return;
  const genetics = typeof readGenetics === 'function' ? readGenetics() : [];
  const prev = _state.calibCepaId || '';
  let html = '<option value="">— Cepa de Referencia (Sin calibrar) —</option>';
  genetics.forEach(g => {
    const selAttr = g.id === prev ? ' selected' : '';
    html += `<option value="${esc(g.id)}"${selAttr}>${esc(g.label)}</option>`;
  });
  sel.innerHTML = html;
}

function clabOnCepaChange() {
  const sel = document.getElementById('clab-anal-cepa');
  _state.calibCepaId = sel?.value || '';
  renderAnalyzer();
}

function clabSetMode(mode) {
  _state.mode = mode;
  document.querySelectorAll('.clab-mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));

  if (mode === 'libre') {
    // Siempre empezar con estado limpio — seed desde la fórmula activa si existe.
    // Los ingredientes de la fórmula arrancan con sus cantidades actuales;
    // el resto de la biblioteca aparece a 0 (visible pero sin contribución).
    _state.libreIngs = {};
    if (_state.formulaId) {
      Object.entries(_state.formulaIngsCurrent).forEach(([id, qty]) => {
        _state.libreIngs[id] = qty;
      });
    }
  }
  renderAnalyzer();
}

function clabOnFormulaChange() {
  const sel = document.getElementById('clab-anal-formula');
  _state.formulaId = sel?.value || '';
  // Cargar la fórmula seleccionada al state para edición en vivo
  _loadFormulaIntoState(_state.formulaId);
  if (_state.formulaId) {
    _state.mode = 'formula';
    document.querySelectorAll('.clab-mode-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === 'formula'));
  }
  renderAnalyzer();
}

/** Resuelve los ingredientes efectivos según el modo. En modo fórmula
 *  usa formulaIngsCurrent (puede tener valores editados), pero conserva
 *  los snapshots originales del bl2_forms para integridad de cálculo.
 *
 *  Contrato de salida: cada item incluye `unidad` explícito.
 *  `unidad` se resuelve con prioridad: snapshot.unidad > live.unidad > 'gr' (fallback).
 *  Esto garantiza que calcCN nunca tenga que inferir unidades. */
function _getEffectiveIngs() {
  // Modo frasco: los items ya traen unidad (resuelto en _getNormalizedFrascoIngs)
  if (_state.expFrascoIngs) return _state.expFrascoIngs;

  const allIngs = readIngredientes();

  if (_state.mode === 'formula' && _state.formulaId) {
    const f = readForms().find(x => x.id === _state.formulaId);
    if (!f) return [];
    return (f.ingredientes || []).map(ing => {
      const cur     = _state.formulaIngsCurrent[ing.id];
      const qty     = (cur != null) ? cur : ing.qty;
      const live    = allIngs.find(x => x.id === ing.id);
      const unidad  = ing.snapshot?.unidad || live?.unidad || 'gr';
      return { id: ing.id, qty, unidad, snapshot: ing.snapshot, proy: ing.proy, orden: ing.orden };
    });
  }
  if (_state.mode === 'libre') {
    return Object.entries(_state.libreIngs)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const live   = allIngs.find(x => x.id === id);
        const unidad = live?.unidad || 'gr';
        return { id, qty: q, unidad };
      });
  }
  return [];
}

function renderAnalyzer() {
  _populateFormulaSelect();
  _populateCepaSelect();

  // Banner modo frasco
  const banner = document.getElementById('clab-frasco-banner');
  if (banner) {
    if (_state.expFrascoIngs) {
      banner.style.display = '';
      const fTxt = _state.expFrascoNormFactor !== 1 
        ? `<span style="opacity:0.8;font-size:0.9em;margin-left:8px">(normalizado a 1000ml · factor ×${_state.expFrascoNormFactor.toFixed(2)})</span>`
        : '';
      banner.innerHTML = `<div class="clab-formula-status" style="background:rgba(68,170,255,0.10);border-color:rgba(68,170,255,0.35)">
        <div class="clab-formula-status-msg" style="color:#44AAFF">🔬 Modo frasco — ${esc(_state.expFrascoLabel)} ${fTxt}</div>
        <button class="clab-btn clab-btn-sm clab-btn-s" onclick="clabClearFrascoMode()">← Volver a fórmula</button>
      </div>`;
    } else {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }

  const ings = _getEffectiveIngs();
  const allIngs = readIngredientes();
  const states = calcEstadoRutas(ings, _state.calibCepaId || null);
  const cn = calcCN(ings, allIngs);
  const rizoScore = calcRizomorfico(states, cn.cn);
  const rizoHint  = rizoBottleneckHint(states, cn.cn);

  // Calibración Empírica
  let calibratedData = null;
  let displayRizoScore = rizoScore;
  if (_state.calibCepaId && typeof window._cilab_getCalibratedScore === 'function') {
    calibratedData = window._cilab_getCalibratedScore(ings, _state.calibCepaId);
    if (calibratedData) {
      displayRizoScore = calibratedData.calibratedScore;
    }
  }

  // Card de Calibración
  const calibCard = document.getElementById('clab-anal-calib-card');
  if (calibCard) {
    if (calibratedData && _state.calibCepaId) {
      calibCard.style.display = '';
      const genetics = readGenetics();
      const selectedG = genetics.find(g => g.id === _state.calibCepaId);
      
      const abrevLabel = (label) => {
        if (!label) return '?';
        const partes  = label.split(' / ');
        const especie = partes[0].trim();
        const resto   = partes.slice(1);
        const abrev   = especie.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
        return resto.length ? [abrev, ...resto].join(' / ') : abrev;
      };
      
      const label = selectedG ? abrevLabel(selectedG.label) : 'Cepa seleccionada';
      const bias = calibratedData.bias;
      const netCal = calibratedData.netCalibration;
      const dSign = netCal >= 0 ? '+' : '';
      const dCls = netCal > 0 ? 'cre-delta--pos' : netCal < 0 ? 'cre-delta--neg' : 'cre-delta--zero';
      const dCol = netCal > 0 ? 'var(--primary)' : netCal < 0 ? 'var(--danger,#e74c3c)' : 'var(--tx3)';
      const dBg = netCal > 0 ? 'rgba(0, 204, 51, 0.1)' : netCal < 0 ? 'rgba(231, 76, 60, 0.1)' : 'rgba(255,255,255,0.05)';
      
      let correctionsHTML = '';
      if (calibratedData.corrections && calibratedData.corrections.length) {
        correctionsHTML = calibratedData.corrections.map(c => {
          const sign = c.delta >= 0 ? '+' : '';
          const col = c.delta >= 0 ? 'var(--primary)' : 'var(--danger,#e74c3c)';
          return `<span style="display:inline-flex; align-items:center; gap:4px; font-size:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:2px 8px; border-radius:4px; margin-right:6px; margin-bottom:6px;">
            <span style="color:var(--tx2);">${esc(c.name)}</span>
            <b style="color:${col};">${sign}${c.delta}</b>
          </span>`;
        }).join('');
      } else {
        correctionsHTML = `<span style="font-size:10px; color:var(--tx3); font-style:italic;">Sin sinergias adicionales aplicadas a esta fórmula.</span>`;
      }
      
      calibCard.innerHTML = `<div class="cre-calibration-panel" style="background:rgba(0, 204, 51, 0.02); border:1px solid rgba(0, 204, 51, 0.15); border-radius:8px; padding:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
          <div>
            <div style="font-size:12px; font-weight:800; color:var(--tx); display:flex; align-items:center; gap:6px;">
              <span>🧠 Motor de Calibración Activo</span>
              <span style="font-size:9px; font-weight:700; color:var(--primary); background:rgba(0, 204, 51, 0.1); padding:1px 6px; border-radius:3px; border:1px solid rgba(0, 204, 51, 0.25);">${esc(label)}</span>
            </div>
            <div style="font-size:10px; color:var(--tx2); margin-top:2px;">Ajustando score teórico basado en resultados de laboratorio previos.</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:10px; color:var(--tx3);">Desviación total:</span>
            <span class="cre-delta ${dCls}" style="font-size:12px; font-weight:700; padding:2px 8px; border-radius:4px; color:${dCol}; background:${dBg}; font-family:'JetBrains Mono',monospace;">Δ ${dSign}${netCal} pts</span>
          </div>
        </div>
        <div style="display:flex; flex-wrap:wrap; align-items:center;">
          ${correctionsHTML}
        </div>
      </div>`;
    } else {
      calibCard.style.display = 'none';
      calibCard.innerHTML = '';
    }
  }

  // Diagnóstico empírico — solo en modo fórmula con cepa seleccionada
  if (_state.formulaId && _state.calibCepaId && typeof window.cilabInt !== 'undefined'
      && typeof window.cilabInt.renderDiagnostico === 'function') {
    window.cilabInt.renderDiagnostico('clab-diagnostico-wrap', {
      formulaId:   _state.formulaId,
      cepaId:      _state.calibCepaId,
      ingRows:     ings,
      routeStates: states,
      thScore:     rizoScore,
      cn:          cn.cn,
    });
  } else {
    var _dw = document.getElementById('clab-diagnostico-wrap');
    if (_dw) _dw.innerHTML = '';
  }

  // Grafo
  const gc = document.getElementById('clab-graph-container');
  if (gc) gc.innerHTML = buildGraphSVG(states, { rizoScore: displayRizoScore, rizoHint, _formulaIngs: ings, uid: 'main' });

  // KPIs
  renderKPIs(cn, rizoScore, states, calibratedData);

  // Formula Intelligence Engine — hybrid score + advisor
  const fiPanel = document.getElementById('clab-fi-panel');
  if (fiPanel && window.cilabFI) {
    // Lazy-build FI cache if needed (requires OLS model to exist)
    if (!window.cilabFI.getFormulaIntel() && window.cilabInt && window.cilabInt.getModel()) {
      window.cilabFI.buildFormulaIntel();
    }
    fiPanel.innerHTML = _fiRenderHybridPanel(ings, _state.calibCepaId || null)
                      + _fiRenderAdvisorPanel();
  }

  // Sliders / tabla
  renderIngsPanel(ings, states);
  markSliderConflicts(detectActiveInteractions(ings));

  // Alertas — con sugerencias accionables
  const alerts = buildAlertsList(states, ings, cn.cn);
  const alertsEl = document.getElementById('clab-anal-alerts');
  if (alertsEl) alertsEl.innerHTML = _renderAlertsHTML(alerts);

  // Panel de composicion quimica (Etapa 3)
  renderChemPanel(ings, allIngs, states);

  // Comparación con experimentos
  renderExpComparison();

}

function _fiRenderHybridPanel(ings, geneticaId) {
  if (!window.cilabFI || typeof window.cilabFI.scoreFormula !== 'function') return '';
  const r = window.cilabFI.scoreFormula(ings, geneticaId);
  if (!r) return '';

  const confClass = 'fi-confidence-' + r.confidence;
  const breakdown = [];
  breakdown.push('<span class="fi-hybrid-item">α·teórico <b>' + Math.round(r.thScore) + '</b></span>');
  if (r.olsProjection !== null) {
    breakdown.push('<span class="fi-hybrid-item">β·empírico <b>' + Math.round(r.olsProjection) + '</b></span>');
  }
  if (r.strainBias !== 0) {
    const biasSign = r.strainBias > 0 ? '+' : '';
    breakdown.push('<span class="fi-hybrid-item">bias cepa <b>' + biasSign + r.strainBias + '</b></span>');
  }
  breakdown.push('<span class="fi-hybrid-item">N <b>' + r.N + '</b></span>');

  const overfitHtml = r.overfitWarning
    ? '<div class="fi-overfit-warn">⚠ R² alto con N=' + r.N + ' — posible sobreajuste, confianza reducida</div>'
    : '';

  return '<div class="fi-hybrid-panel">'
    + '<div class="fi-hybrid-label">Score híbrido (teoría + empírico)</div>'
    + '<div>'
      + '<span class="fi-hybrid-score">' + r.hybridScore + '</span>'
      + '<span style="color:#555;font-size:12px;margin-left:4px"> / 100 · </span>'
      + '<span class="' + confClass + '" style="font-size:11px">confianza ' + r.confidence + '</span>'
      + (r.usingStrainModel ? '<span style="color:#888;font-size:10px;margin-left:6px">modelo cepa</span>' : '')
    + '</div>'
    + '<div class="fi-hybrid-breakdown">' + breakdown.join('') + '</div>'
    + overfitHtml
    + '</div>';
}

function _fiRenderAdvisorPanel() {
  if (!window.cilabFI || typeof window.cilabFI.getExperimentAdvice !== 'function') return '';
  const advice = window.cilabFI.getExperimentAdvice();
  if (!advice || !advice.topUncertainIngredients || !advice.topUncertainIngredients.length) return '';

  const rows = advice.topUncertainIngredients.slice(0, 3).map(function(u) {
    const cls  = u.coef >= 0 ? 'fi-unc-pos' : 'fi-unc-neg';
    const sign = u.coef >= 0 ? '+' : '';
    return '<div class="fi-advisor-item">'
      + '⭡ <b>' + esc(u.ingNombre) + '</b> '
      + '<span class="' + cls + '">' + sign + u.coef + ' pts</span> '
      + '<span class="fi-unc-n">n=' + u.n + ' · ' + esc(u.reason) + '</span>'
      + '</div>';
  }).join('');

  if (!rows) return '';
  return '<div class="fi-advisor-panel">'
    + '<div class="fi-advisor-title">💡 Próximo ensayo más informativo</div>'
    + rows
    + '</div>';
}

function renderKPIs(cn, rizoScore, states, calibratedData) {
  const el = document.getElementById('clab-anal-kpis');
  if (!el) return;
  // Estado de NO_PKG y SAM (extras informativos)
  const noStatus = states['N2_NO_PKG']?.status || 'INACTIVA';
  const samStatus = states['N3_SAM']?.status || 'INACTIVA';
  const cnVal = cn.cn != null ? cn.cn.toFixed(2) : '—';
  const cnCls = cn.cn != null ? (cn.cn >= 6 && cn.cn <= 18 ? 'wn' : 'or') : '';
  
  let scoreHTML = '';
  if (calibratedData && _state.calibCepaId) {
    const calScore = Math.round(calibratedData.calibratedScore);
    const thScore = Math.round(calibratedData.theoreticalScore);
    const rizoCls = calScore >= 80 ? 'wn' : calScore >= 50 ? '' : 'or';
    scoreHTML = `<div class="clab-kpi-val ${rizoCls}">${calScore}<span style="font-size:12px;color:var(--tx3);font-weight:400"> (Calib.)</span><br><span style="font-size:12px;color:var(--tx3);font-weight:400;margin-top:2px;display:inline-block">Teórico: ${thScore}/100</span></div>`;
  } else {
    const rizoCls = rizoScore >= 80 ? 'wn' : rizoScore >= 50 ? '' : 'or';
    scoreHTML = `<div class="clab-kpi-val ${rizoCls}">${Math.round(rizoScore)}<span style="font-size:13px;color:var(--tx3)"> / 100</span></div>`;
  }

  const activeLabel = (calibratedData && _state.calibCepaId)
    ? (calibratedData.calibratedScore >= 80 ? 'convergencia favorable' : calibratedData.calibratedScore >= 50 ? 'parcial' : 'limitado')
    : (rizoScore >= 80 ? 'convergencia favorable' : rizoScore >= 50 ? 'parcial' : 'limitado');

  el.innerHTML = `
    <div class="clab-kpi"><div class="clab-kpi-label">Índice rizomórfico</div>
      ${scoreHTML}
      <div class="clab-kpi-sub">${activeLabel}</div>
    </div>
    <div class="clab-kpi wn"><div class="clab-kpi-label">C/N</div>
      <div class="clab-kpi-val ${cnCls}">${cnVal}</div>
      <div class="clab-kpi-sub">C: ${cn.c.toFixed(2)} · N: ${cn.n.toFixed(2)}</div>
    </div>
    <div class="clab-kpi or"><div class="clab-kpi-label">Señal NO/PKG</div>
      <div class="clab-kpi-val or">${esc(STATUS_LABEL[noStatus] || noStatus)}</div>
      <div class="clab-kpi-sub">arginina → fNOS</div>
    </div>
    <div class="clab-kpi blu"><div class="clab-kpi-label">Pool SAM</div>
      <div class="clab-kpi-val blu">${esc(STATUS_LABEL[samStatus] || samStatus)}</div>
      <div class="clab-kpi-sub">membranas / espermina</div>
    </div>`;
}


// ════════════════════════════════════════════
// BADGE VISUAL DE UNIDAD DE MEDIDA
// Colores: ml=naranja, gr=verde, mg=azul, ud=violeta, resto=gris
// ════════════════════════════════════════════
function _unitBadge(unidad) {
  if (!unidad) return '';
  const u = unidad.toLowerCase().trim();
  const map = {
    'ml': { bg: 'rgba(255,140,0,0.15)',  border: 'rgba(255,140,0,0.5)',  color: '#FF8C00', label: 'ml' },
    'gr': { bg: 'rgba(112,173,71,0.15)', border: 'rgba(112,173,71,0.5)', color: '#70AD47', label: 'gr' },
    'mg': { bg: 'rgba(68,170,255,0.15)', border: 'rgba(68,170,255,0.5)', color: '#44AAFF', label: 'mg' },
    'ud': { bg: 'rgba(124,111,255,0.15)',border: 'rgba(124,111,255,0.5)',color: '#7C6FFF', label: 'ud' },
  };
  const s = map[u] || { bg: 'rgba(160,160,160,0.15)', border: 'rgba(160,160,160,0.4)', color: '#A0A0A0', label: unidad };
  return '<span style="display:inline-flex;align-items:center;font-size:9px;font-weight:700;font-family:JetBrains Mono,monospace;padding:1px 5px;border-radius:3px;background:' + s.bg + ';border:1px solid ' + s.border + ';color:' + s.color + ';vertical-align:middle;margin-left:4px">' + s.label + '</span>';
}

function renderIngsPanel(ings, states) {
  const cont = document.getElementById('clab-anal-ings');
  if (!cont) return;
  const allIngs = readIngredientes();
  const meta = loadMeta();

  // Modo frasco — read-only: lista simple de ingredientes consolidados
  if (_state.expFrascoIngs) {
    if (!ings.length) {
      cont.innerHTML = `<div class="clab-empty" style="padding:14px">El frasco no tiene ingredientes.</div>`;
      return;
    }
    const rows = ings.map(fi => {
      const i = allIngs.find(x => x.id === fi.id) || { id: fi.id, nombre: fi.snapshot?.nombre || fi.id, unidad: fi.snapshot?.unidad || '' };
      const m = meta[fi.id];
      const st = classifyQty(fi.qty, m);
      const stClass = _stBadgeClass(fi.qty > 0 ? st : 'INACTIVA');
      const optTxt = m?.rangoOptimo
        ? `<span class="clab-mono clab-muted" style="font-size:9px;margin-left:6px">opt ${m.rangoOptimo.min}–${m.rangoOptimo.max}${_unitBadge(i.unidad)}</span>`
        : '';
      const originBadge = fi.type ? `<span class="clab-badge-origin ${fi.type}">${fi.type.toUpperCase()}</span>` : '';
      
      return `<div class="clab-slider-row" style="opacity:0.9">
        <div class="clab-slider-header" style="display:flex;align-items:center;gap:6px">
          ${originBadge}
          <span class="clab-slider-name">${esc(i.nombre || fi.id)}</span>
          ${optTxt}
          <span class="${stClass}" style="margin-left:auto">${esc(STATUS_LABEL[fi.qty > 0 ? st : 'INACTIVA'] || st)}</span>
        </div>
        <div class="clab-mono clab-muted" style="font-size:10px;padding:2px 0 4px 0">${(+fi.qty).toFixed(2)} ${_unitBadge(i.unidad)} <span style="opacity:0.5;font-size:0.9em">(per Litro)</span></div>
      </div>`;
    }).join('');
    cont.innerHTML = `<div class="clab-empty" style="padding:6px 0 10px 0;font-size:10px;color:var(--tx3)">Vista de sólo lectura · los sliders no están disponibles en modo frasco.</div>${rows}`;
    return;
  }

  if (_state.mode === 'libre') {
    // ── Orden canónico: ingredientes de la fórmula primero, luego resto ──────
    const formulaIds = _state.formulaId
      ? (readForms().find(x => x.id === _state.formulaId)?.ingredientes || []).map(fi => fi.id)
      : [];
    const formulaIdSet = new Set(formulaIds);

    // Grupo 1: ingredientes de la fórmula activa (en orden de fórmula)
    const formulaGroup = formulaIds
      .map(id => allIngs.find(i => i.id === id))
      .filter(Boolean);

    // Grupo 2: resto de la biblioteca con metadata, excluidos los de la fórmula
    const restGroup = allIngs.filter(i => !formulaIdSet.has(i.id) && meta[i.id]);

    // Dropdown: ingredientes sin metadata alguna
    const noMetaGroup = allIngs.filter(i => !formulaIdSet.has(i.id) && !meta[i.id]);

    const buildRow = i => _buildSliderRow({
      ing: i, meta: meta[i.id] || null,
      current: _state.libreIngs[i.id] ?? 0,
      original: null, mode: 'libre',
    });

    const formulaRows = formulaGroup.map(buildRow).join('');
    const restRows    = restGroup.map(buildRow).join('');

    const hdr = (label, extra = '') =>
      `<div class="clab-libre-section-hdr">${label}${extra}</div>`;

    const formulaSection = formulaGroup.length
      ? hdr(`En la fórmula${_state.formulaId ? ' · <span class="clab-mono" style="font-size:10px">' + esc(_state.formulaId) + '</span>' : ''}`) + formulaRows
      : '';

    const restSection = restGroup.length
      ? hdr('Biblioteca · valor 0') + restRows
      : '';

    const otherSel = noMetaGroup.length
      ? `<div class="clab-row" style="margin-top:8px">
          <select class="clab-select" id="clab-libre-add" style="flex:1;font-size:11px">
            <option value="">+ Añadir ingrediente sin metadata...</option>
            ${noMetaGroup.map(i => `<option value="${esc(i.id)}">${esc(i.nombre)} (${esc(i.unidad || '')})</option>`).join('')}
          </select>
          <button class="clab-btn clab-btn-sm clab-btn-s" onclick="clabAddLibreIng()">Añadir</button>
        </div>` : '';

    const newCiBtn = `<div class="clab-libre-actions">
      <button class="clab-btn clab-btn-p clab-libre-newci" onclick="clabOpenNewFormModalFromLibre()">🧫 Nueva Fórmula CI</button>
    </div>`;

    if (!formulaGroup.length && !restGroup.length) {
      cont.innerHTML = `<div class="clab-empty" style="padding:14px">Sin ingredientes con metadata. Cargá rangos en la <b>Biblioteca</b>.</div>` + otherSel;
      return;
    }
    cont.innerHTML = newCiBtn + formulaSection + restSection + otherSel;
    return;
  }

  // Modo fórmula
  if (!_state.formulaId) {
    cont.innerHTML = `<div class="clab-empty" style="padding:14px">Seleccioná una fórmula CI arriba para editarla en vivo,<br>o pasá a <b>Modo libre</b> para construir desde cero.</div>`;
    return;
  }
  if (!ings.length) {
    cont.innerHTML = `<div class="clab-empty" style="padding:14px">La fórmula no tiene ingredientes.</div>`;
    return;
  }

  // Barra de estado: modificada vs original
  const isMod = _formulaIsModified();
  const statusBar = isMod
    ? `<div class="clab-formula-status">
        <div class="clab-formula-status-msg">⚠ Fórmula modificada — los cambios viven sólo en este analizador, no afectan a CI.</div>
        <button class="clab-btn clab-btn-sm clab-btn-s" onclick="clabRestoreOriginal()" title="Restaurar valores originales">↺ Restaurar</button>
        <button class="clab-btn clab-btn-sm clab-btn-p" onclick="clabOpenNewFormModal()" title="Persistir como nueva fórmula CI">📝 Crear Nueva</button>
       </div>`
    : `<div class="clab-formula-status clean">
        <div class="clab-formula-status-msg">✓ Sin cambios — ajustá los sliders para simular variantes en vivo.</div>
       </div>`;

  // Sliders editables — uno por ingrediente de la fórmula
  const rows = ings.map(fi => {
    const i = allIngs.find(x => x.id === fi.id) || { id: fi.id, nombre: fi.snapshot?.nombre || fi.id, unidad: fi.snapshot?.unidad || '' };
    const m = meta[fi.id];
    const original = _state.formulaIngsOriginal[fi.id] || 0;
    const current  = fi.qty;
    return _buildSliderRow({ ing: i, meta: m, current, original, mode: 'formula' });
  }).join('');

  cont.innerHTML = statusBar + rows;
}

/** Construye una fila de slider unificada para modo fórmula y modo libre.
 *  En modo fórmula muestra el marker del valor original sobre el track. */
function _buildSliderRow({ ing, meta, current, original, mode }) {
  current = +current || 0;
  const isFormula = mode === 'formula';

  // max razonable: meta.rangoSeguro.max * 1.5, fallback al original*2.5, fallback 5
  let max;
  if (meta?.rangoSeguro?.max) max = meta.rangoSeguro.max * 1.5;
  else if (original > 0)      max = original * 2.5;
  else                        max = 5;
  if (current > max) max = current * 1.2; // garantizar que el slider no esté topado
  const step = max < 1 ? 0.01 : max < 10 ? 0.05 : 0.1;

  const st = classifyQty(current, meta);
  const stShow = current > 0 ? st : 'INACTIVA';
  const optTxt = meta?.rangoOptimo
    ? `<span class="clab-mono clab-muted" style="font-size:9px">opt ${meta.rangoOptimo.min}–${meta.rangoOptimo.max}${_unitBadge(ing.unidad)}</span>`
    : (meta ? '' : '<span class="clab-mono clab-muted" style="font-size:9px">sin rango</span>');

  // ¿Difiere del original? Sólo aplica a modo fórmula.
  const modif = isFormula && original != null && Math.abs(current - original) > 0.0001;

  // Marker del valor original — sólo en modo fórmula. La fórmula del thumb:
  //   center_x = 7px + (val/max) * (track_width - 14px)
  // → en CSS: left: calc((val/max) * (100% - 14px) + 7px)
  let markerHtml = '';
  if (isFormula && original != null && original >= 0) {
    const ratio = max > 0 ? Math.min(1, original / max) : 0;
    markerHtml = `<span class="clab-slider-marker"
      style="left:calc(${ratio} * (100% - 14px) + 7px)"
      title="Valor original: ${original.toFixed(2)}"></span>`;
  }

  const handler = isFormula
    ? `clabOnFormulaSliderChange('${esc(ing.id)}', this.value)`
    : `clabOnSliderChange('${esc(ing.id)}', this.value)`;

  const valFmt = (+current).toFixed(step < 0.05 ? 2 : 1);

  return `<div class="clab-slider-row${modif ? ' clab-modif' : ''}" data-st="${stShow}" data-ing="${esc(ing.id)}" data-original="${original ?? ''}">
    <div class="clab-slider-name clab-clickable" onclick="clabOpenIngDetail('${esc(ing.id)}')"
         title="${esc(ing.nombre)} — click para editar rangos y rutas">${esc(ing.nombre)}<br>${optTxt}</div>
    <div class="clab-slider-wrap">
      <input type="range" class="clab-slider-track" min="0" max="${max}" step="${step}" value="${current}" oninput="${handler}">
      ${markerHtml}
    </div>
    <span class="clab-slider-val">${valFmt}</span>
    ${_unitBadge(ing.unidad)}
  </div>`;
}

function clabOnSliderChange(ingId, val) {
  _state.libreIngs[ingId] = parseFloat(val) || 0;
  // Actualizar inmediato el grafo + KPIs (no re-renderizamos los sliders enteros para no
  // perder foco / cursor). Pero sí actualizamos sus border-color por estado.
  const ings = _getEffectiveIngs();
  const cepaId = _state.calibCepaId || null;
  const states = calcEstadoRutas(ings, cepaId);
  const allIngs = readIngredientes();
  const cn = calcCN(ings, allIngs);
  const rizoScore = calcRizomorfico(states, cn.cn);
  const rizoHint  = rizoBottleneckHint(states, cn.cn);
  // Calibración Empírica en tiempo real
  let calibratedData = null;
  let displayRizoScore = rizoScore;
  if (cepaId && typeof window._cilab_getCalibratedScore === 'function') {
    calibratedData = window._cilab_getCalibratedScore(ings, cepaId);
    if (calibratedData) displayRizoScore = calibratedData.calibratedScore;
  }
  const gc = document.getElementById('clab-graph-container');
  if (gc) gc.innerHTML = buildGraphSVG(states, { rizoScore: displayRizoScore, rizoHint, _formulaIngs: ings });
  renderKPIs(cn, rizoScore, states, calibratedData);
  // Actualizar cada slider-row con su estado
  document.querySelectorAll('.clab-slider-row').forEach(row => {
    const id = row.dataset.ing;
    const v = _state.libreIngs[id] || 0;
    const m = getIngMeta(id);
    const st = classifyQty(v, m);
    row.dataset.st = v > 0 ? st : 'INACTIVA';
    const valSpan = row.querySelector('.clab-slider-val');
    if (valSpan) valSpan.textContent = v.toFixed(2);
  });
  // Refrescar alertas (mismo helper unificado)
  const alerts = buildAlertsList(states, ings, cn.cn);
  const alertsEl = document.getElementById('clab-anal-alerts');
  if (alertsEl) alertsEl.innerHTML = _renderAlertsHTML(alerts);
  markSliderConflicts(detectActiveInteractions(ings));
  // Perfil bioquimico en tiempo real — pools ya calculados arriba, costo ~0
  renderChemPanel(ings, allIngs, states);
}

/** Versión para modo fórmula: muta formulaIngsCurrent y refresca en sitio
 *  sin re-renderizar todos los sliders (preserva foco). */
function clabOnFormulaSliderChange(ingId, val) {
  const v = parseFloat(val) || 0;
  _state.formulaIngsCurrent[ingId] = v;

  const ings = _getEffectiveIngs();
  const allIngs = readIngredientes();
  const cepaId = _state.calibCepaId || null;
  const states = calcEstadoRutas(ings, cepaId);
  const cn = calcCN(ings, allIngs);
  const rizoScore = calcRizomorfico(states, cn.cn);
  const rizoHint  = rizoBottleneckHint(states, cn.cn);
  // Calibración Empírica en tiempo real
  let calibratedData = null;
  let displayRizoScore = rizoScore;
  if (cepaId && typeof window._cilab_getCalibratedScore === 'function') {
    calibratedData = window._cilab_getCalibratedScore(ings, cepaId);
    if (calibratedData) displayRizoScore = calibratedData.calibratedScore;
  }

  const gc = document.getElementById('clab-graph-container');
  if (gc) gc.innerHTML = buildGraphSVG(states, { rizoScore: displayRizoScore, rizoHint, _formulaIngs: ings });
  renderKPIs(cn, rizoScore, states, calibratedData);

  // Refrescar fila del slider que cambió + estado de "modificada" en barra
  const meta = loadMeta();
  document.querySelectorAll('.clab-slider-row').forEach(row => {
    const id = row.dataset.ing;
    if (!id) return;
    const cur = _state.formulaIngsCurrent[id] != null ? _state.formulaIngsCurrent[id] : 0;
    const m = meta[id];
    const st = classifyQty(cur, m);
    row.dataset.st = cur > 0 ? st : 'INACTIVA';
    const orig = parseFloat(row.dataset.original);
    const isMod = !isNaN(orig) && Math.abs(cur - orig) > 0.0001;
    row.classList.toggle('clab-modif', isMod);
    const valSpan = row.querySelector('.clab-slider-val');
    if (valSpan) {
      const max = parseFloat(row.querySelector('input[type="range"]').max) || 5;
      const step = max < 1 ? 0.01 : max < 10 ? 0.05 : 0.1;
      valSpan.textContent = cur.toFixed(step < 0.05 ? 2 : 1);
    }
  });
  // Re-render barra de estado y alertas (que pueden haber cambiado)
  _refreshFormulaStatusBar();
  _refreshAlertsInPlace();
  markSliderConflicts(detectActiveInteractions(ings));
  // Perfil bioquimico en tiempo real — allIngs ya disponible en este scope
  renderChemPanel(ings, allIngs, states);
}

function _refreshFormulaStatusBar() {
  const cont = document.getElementById('clab-anal-ings');
  if (!cont) return;
  const existing = cont.querySelector('.clab-formula-status');
  const isMod = _formulaIsModified();
  if (!existing && !_state.formulaId) return;
  const html = isMod
    ? `<div class="clab-formula-status">
        <div class="clab-formula-status-msg">⚠ Fórmula modificada — los cambios viven sólo en este analizador, no afectan a CI.</div>
        <button class="clab-btn clab-btn-sm clab-btn-s" onclick="clabRestoreOriginal()" title="Restaurar valores originales">↺ Restaurar</button>
        <button class="clab-btn clab-btn-sm clab-btn-p" onclick="clabOpenNewFormModal()" title="Persistir como nueva fórmula CI">📝 Crear Nueva</button>
       </div>`
    : `<div class="clab-formula-status clean">
        <div class="clab-formula-status-msg">✓ Sin cambios — ajustá los sliders para simular variantes en vivo.</div>
       </div>`;
  if (existing) existing.outerHTML = html;
  else cont.insertAdjacentHTML('afterbegin', html);
}

function _refreshAlertsInPlace() {
  const ings = _getEffectiveIngs();
  const allIngs = readIngredientes();
  const states = calcEstadoRutas(ings, null);
  const cn = calcCN(ings, allIngs);
  const alerts = buildAlertsList(states, ings, cn.cn);
  const el = document.getElementById('clab-anal-alerts');
  if (!el) return;
  el.innerHTML = _renderAlertsHTML(alerts);
}

function _renderAlertsHTML(alerts) {
  if (!alerts.length) {
    return `<div class="clab-empty" style="padding:16px">Sin alertas. Carga una formula o ingredientes para analizar.</div>`;
  }
  const canApply = (_state.mode === 'formula' && _state.formulaId) || _state.mode === 'libre';

  const KIND_COLOR = {
    danger: 'var(--er)',
    warn:   'var(--st-exceso)',
    watch:  'var(--ac4)',
    info:   'var(--ac4)',
    ok:     'var(--wn)',
  };

  return alerts.map((a, idx) => {
    const intensity = Math.max(0, Math.min(100, a.intensity || 0));
    const barH = Math.max(4, Math.round(intensity * 0.6)); // 0-60px
    const barColor = KIND_COLOR[a.kind] || 'var(--tx3)';
    const glowStr = (a.kind === 'danger' || a.kind === 'warn') && intensity >= 65
      ? `box-shadow: 0 0 ${Math.round(intensity * 0.12)}px rgba(192,0,0,${(intensity - 60) / 200})` : '';

    let actionHtml = '';
    if (a.sugerencias && a.sugerencias.length && canApply) {
      const btns = a.sugerencias.map(sg => {
        if (sg.qty == null) return '';
        const cantTxt = sg.qty + (sg.unidad ? ' ' + sg.unidad : '');
        const srcIcon = sg.source === 'learn' ? '🧠 ' : sg.source === 'cepa' ? '🎯 ' : '';
        const srcTip  = sg.source === 'learn'
          ? `Aprendido de fórmulas exitosas (${sg.rizoHits}/${sg.totalForms})`
          : sg.source === 'cepa' ? 'Rango por cepa' : 'Rango base';
        const payload = JSON.stringify({ type: 'set', ingId: sg.ingId, qty: sg.qty }).replace(/"/g, '&quot;');
        return `<button class="clab-alert-action" title="${esc(srcIcon + srcTip)}" data-action="${payload}" onclick="clabApplySuggestionFromBtn(this)">${srcIcon}${esc(sg.nombre)} ${esc(cantTxt)}</button>`;
      }).filter(Boolean).join('');
      if (btns) actionHtml = `<div class="clab-alert-sugs">${btns}</div>`;
    } else if (a.action && canApply) {
      const payload = JSON.stringify(a.action).replace(/"/g, '&quot;');
      actionHtml = `<button class="clab-alert-action"
                     data-action="${payload}"
                     onclick="clabApplySuggestionFromBtn(this)">${esc(a.action.btnLabel || 'Aplicar')}</button>`;
    }

    const intensityBadge = intensity > 0
      ? `<span class="clab-alert-intensity-badge" title="Intensidad: ${intensity}/100" style="--int:${intensity};--bar-color:${barColor}">${intensity}</span>`
      : '';

    return `<div class="clab-alert ${a.kind}" style="--alert-intensity:${intensity};animation-delay:${idx * 0.03}s;${glowStr}">
      <div class="clab-alert-intensity-bar" style="height:${barH}px;background:${barColor}"></div>
      <span class="clab-alert-icon">${esc(a.icon)}</span>
      <span style="flex:1">${a.text}</span>
      ${intensityBadge}
      ${actionHtml}
    </div>`;
  }).join('');
}

function clabApplySuggestionFromBtn(btn) {
  if (!btn || !btn.dataset.action) return;
  try {
    const action = JSON.parse(btn.dataset.action);
    clabApplySuggestion(action);
  } catch (e) {
    console.error('[CILAB] No se pudo parsear la acción:', e);
    notif('Error al aplicar sugerencia', 'err');
  }
}

function clabRestoreOriginal() {
  if (!_state.formulaId) return;
  _state.formulaIngsCurrent = Object.assign({}, _state.formulaIngsOriginal);
  notif('Valores originales restaurados', 'ok');
  renderAnalyzer();
}

// ── Modal: Crear nueva fórmula ─────────────────────────────────────────────
function clabOpenNewFormModal() {
  if (!_state.formulaId) return;
  if (!_formulaIsModified()) {
    notif('No hay cambios respecto al original. Mové algún slider primero.', 'err');
    return;
  }
  const f = readForms().find(x => x.id === _state.formulaId);
  if (!f) return notif('Fórmula base no encontrada', 'err');
  const meta = document.getElementById('clab-newform-meta');
  if (meta) meta.innerHTML = `Variante de <code>${esc(f.id)}</code> — ${esc(f.nombre || '')}`;
  const nameEl = document.getElementById('clab-newform-name');
  if (nameEl) nameEl.value = (f.nombre || 'Fórmula') + ' v2';
  const modal = document.getElementById('clab-newform-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => nameEl?.focus(), 60);
}

function clabCloseNewFormModal() {
  _state.optimizerScenarioId = null;
  _state.libreCreateMode     = false;
  const modal = document.getElementById('clab-newform-modal');
  if (modal) modal.style.display = 'none';
}

// ── Abrir modal "Nueva Fórmula CI" desde Modo libre ──────────────────────
function clabOpenNewFormModalFromLibre() {
  const activeCount = Object.values(_state.libreIngs).filter(q => q > 0).length;
  if (!activeCount) { notif('Configurá al menos un ingrediente antes de crear', 'err'); return; }
  _state.optimizerScenarioId = null;
  _state.libreCreateMode = true;
  const metaEl = document.getElementById('clab-newform-meta');
  if (metaEl) metaEl.innerHTML = `Desde <b>Modo libre</b> · <span style="color:var(--tx2);font-size:11px">${activeCount} ingrediente${activeCount !== 1 ? 's' : ''} activo${activeCount !== 1 ? 's' : ''}</span>`;
  const nameEl = document.getElementById('clab-newform-name');
  if (nameEl) nameEl.value = `Libre ${new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' })}`;
  const modal = document.getElementById('clab-newform-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => { nameEl?.focus(); nameEl?.select(); }, 60);
}

// ── Crear fórmula desde contenido de Modo libre ──────────────────────────
function _clabCreateFormulaFromLibre() {
  const nombre = (document.getElementById('clab-newform-name')?.value || '').trim();
  if (!nombre) return notif('Ingresá un nombre', 'err');
  const allIngs  = readIngredientes();
  const allForms = readForms();
  const newId    = nxtId('CI', allForms);
  const newIngs  = Object.entries(_state.libreIngs)
    .filter(([, q]) => q > 0)
    .map(([id, qty], idx) => {
      const liveIng = allIngs.find(x => x.id === id);
      const snap    = liveIng ? {
        nombre: liveIng.nombre, unidad: liveIng.unidad, aspecto: liveIng.aspecto,
        pc: liveIng.pc || 0, pn: liveIng.pn || 0, notas: liveIng.notas || '',
      } : null;
      return { id, qty, orden: idx, proy: 0, snapshot: snap };
    });
  if (!newIngs.length) return notif('Sin ingredientes activos', 'err');
  const newF = {
    id: newId, nombre,
    fecha: new Date().toISOString(),
    ingredientes: newIngs,
    archivada: false,
    createdBy: 'CILAB-LIBRE',
  };
  allForms.push(newF);
  s(K.forms, allForms);
  try {
    window.dispatchEvent(new CustomEvent('cilab-formulas-changed', {
      detail: { tipo: 'creado', formulaId: newId, source: 'libre' },
    }));
  } catch (e) { /* ignore */ }
  _state.libreCreateMode = false;
  clabCloseNewFormModal();
  notif(`✓ Fórmula ${newId} creada en CI`, 'ok');
  _state.formulaId = newId;
  _loadFormulaIntoState(newId);
  clabSetMode('formula');
}

// ── Abrir modal "Nueva Fórmula CI" desde el optimizador ───────────────────
function clabOpenNewFormModalFromOptimizer(scenarioId) {
  const result = _state.lastOptimizerResult;
  if (!result) { notif('Sin resultado de optimización', 'err'); return; }
  const sc = result.scenarios[scenarioId];
  if (!sc) return;
  _state.optimizerScenarioId = scenarioId;
  const labels = { A: 'Corrección mínima', B: 'Rizomorfismo Grueso', C: 'Fino Rápido' };
  const meta = document.getElementById('clab-newform-meta');
  if (meta) meta.innerHTML = `Optimizador — Escenario <b>${esc(scenarioId)}</b> · ${esc(labels[scenarioId] || '')}
    &nbsp;<span style="color:var(--ac);font-family:var(--mo);font-size:11px">${sc.projectedScore.toFixed(1)}/100</span>`;
  const nameEl = document.getElementById('clab-newform-name');
  if (nameEl) nameEl.value = `OPT-${scenarioId} ${new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' })}`;
  const modal = document.getElementById('clab-newform-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => { nameEl?.focus(); nameEl?.select(); }, 60);
}

// ── Crear fórmula desde proyección del optimizador ────────────────────────
function _clabCreateFormulaFromOptScenario() {
  const result     = _state.lastOptimizerResult;
  const scenarioId = _state.optimizerScenarioId;
  if (!result || !scenarioId) return notif('Contexto de optimización perdido', 'err');
  const sc = result.scenarios[scenarioId];
  if (!sc) return;
  const nombre = (document.getElementById('clab-newform-name')?.value || '').trim();
  if (!nombre) return notif('Ingresá un nombre', 'err');
  const allIngs  = readIngredientes();
  const allForms = readForms();
  const newId    = nxtId('CI', allForms);
  const newIngs  = sc.projRows
    .filter(row => (row.qty || 0) > 0)
    .map((row, idx) => {
      const liveIng = allIngs.find(x => x.id === row.id);
      const snap = row.snapshot || (liveIng ? {
        nombre: liveIng.nombre, unidad: liveIng.unidad, aspecto: liveIng.aspecto,
        pc: liveIng.pc || 0, pn: liveIng.pn || 0, notas: liveIng.notas || '',
      } : null);
      return { id: row.id, qty: row.qty, orden: idx, proy: 0, snapshot: snap };
    });
  const labels = { A: 'Corrección mínima', B: 'Rizomorfismo Grueso', C: 'Fino Rápido' };
  const newF = {
    id: newId, nombre,
    fecha: new Date().toISOString(),
    ingredientes: newIngs,
    archivada: false,
    createdBy: 'CILAB-OPT',
    optimizerScenario: scenarioId,
    optimizerLabel: labels[scenarioId] || '',
    optimizerScore: sc.projectedScore,
  };
  allForms.push(newF);
  s(K.forms, allForms);
  try {
    window.dispatchEvent(new CustomEvent('cilab-formulas-changed', {
      detail: { tipo: 'creado', formulaId: newId, source: 'optimizer', scenario: scenarioId },
    }));
  } catch (e) { /* ignore */ }
  _state.optimizerScenarioId = null;
  clabCloseNewFormModal();
  notif(`✓ Fórmula ${newId} creada en CI`, 'ok');
  // Cargar la nueva fórmula en el analizador
  _state.formulaId = newId;
  _loadFormulaIntoState(newId);
  renderAnalyzer();
}

function clabCreateNewFormula() {
  // Dispatch al handler correcto según contexto
  if (_state.optimizerScenarioId) return _clabCreateFormulaFromOptScenario();
  if (_state.libreCreateMode)     return _clabCreateFormulaFromLibre();
  const f = readForms().find(x => x.id === _state.formulaId);
  if (!f) return notif('Fórmula base no encontrada', 'err');
  const nombre = (document.getElementById('clab-newform-name')?.value || '').trim();
  if (!nombre) return notif('Ingresá un nombre', 'err');

  const allIngs = readIngredientes();
  const allForms = readForms();
  const newId = nxtId('CI', allForms);

  // Construir ingredientes con qty actuales + snapshots preservados.
  // Si un ingrediente original no tiene snapshot (fórmulas antiguas), capturamos uno fresco.
  const newIngs = (f.ingredientes || []).map(ing => {
    const liveIng = allIngs.find(x => x.id === ing.id);
    const snap = ing.snapshot || (liveIng ? {
      nombre: liveIng.nombre, unidad: liveIng.unidad, aspecto: liveIng.aspecto,
      pc: liveIng.pc || 0, pn: liveIng.pn || 0, notas: liveIng.notas || '',
    } : null);
    const cur = _state.formulaIngsCurrent[ing.id];
    return {
      id: ing.id,
      qty: cur != null ? cur : ing.qty,
      orden: ing.orden,
      proy: ing.proy || 0,
      snapshot: snap,
    };
  });

  const newF = {
    id: newId,
    nombre,
    fecha: new Date().toISOString(),
    ingredientes: newIngs,
    archivada: false,
    parentFormulaId: f.id, // metadato extra: trazabilidad de variantes
    createdBy: 'CILAB',
  };

  // Persistir
  allForms.push(newF);
  s(K.forms, allForms);

  // Notificar a CI vía custom event para que refresque sus listas
  try {
    window.dispatchEvent(new CustomEvent('cilab-formulas-changed', { detail: { tipo: 'creado', formulaId: newId, parentId: f.id } }));
  } catch (e) { /* ignore */ }

  // Cargar la nueva fórmula en el analizador automáticamente
  _state.formulaId = newId;
  _loadFormulaIntoState(newId);
  clabCloseNewFormModal();
  notif(`✓ Fórmula ${newId} creada`, 'ok');
  renderAnalyzer();
}

// ── Aplicar sugerencia accionable desde el panel de alertas ────────────────
function clabApplySuggestion(action) {
  if (!action || !action.type) return;
  if (action.type === 'set' && action.ingId) {
    if (_state.mode === 'formula' && _state.formulaId) {
      // Si el ingrediente no estaba en la fórmula, no podemos agregarlo en modo
      // fórmula sin tocar bl2_forms. Avisamos y sugerimos modo libre.
      if (_state.formulaIngsOriginal[action.ingId] == null && _state.formulaIngsCurrent[action.ingId] == null) {
        notif('Ese ingrediente no está en la fórmula. Cambiá a Modo libre para agregarlo.', 'err');
        return;
      }
      _state.formulaIngsCurrent[action.ingId] = +action.qty;
      renderAnalyzer();
    } else if (_state.mode === 'libre') {
      _state.libreIngs[action.ingId] = +action.qty;
      renderAnalyzer();
    }
    notif('Sugerencia aplicada', 'ok');
  }
}

function clabAddLibreIng() {
  const sel = document.getElementById('clab-libre-add');
  if (!sel || !sel.value) return;
  if (!_state.libreIngs[sel.value]) _state.libreIngs[sel.value] = 0;
  // Después de añadir, lo ideal es que el usuario primero le configure rangos.
  // Igual lo añadimos al modo libre.
  const ing = readIngredientes().find(i => i.id === sel.value);
  if (ing) {
    // Estado inicial: 1 unidad (ajustable). Sin rango es SIN_DATOS.
    _state.libreIngs[sel.value] = 1;
    notif(`Añadido ${ing.nombre} sin metadata. Configurá rangos en la Biblioteca.`, 'ok');
  }
  renderAnalyzer();
}

// ────────────────────────────────────────────
// Comparación con experimentos
// ────────────────────────────────────────────
function renderExpComparison() {
  const card = document.getElementById('clab-anal-comp-card');
  const cont = document.getElementById('clab-anal-comp');
  if (!card || !cont) return;
  if (_state.mode !== 'formula' || !_state.formulaId) { card.style.display = 'none'; return; }

  const f = readForms().find(x => x.id === _state.formulaId);
  if (!f) { card.style.display = 'none'; return; }

  // Buscar experimentos de toda la familia de versiones (mismo nombre de fórmula)
  const familyIds = _getFormulaFamilyIds(_state.formulaId);
  const exps = readExperimentos().filter(e => familyIds.includes(e.formulaId));
  if (!exps.length) { card.style.display = 'none'; return; }

  card.style.display = '';
  const expSelHTML = `<select class="clab-select" id="clab-comp-sel" style="max-width:280px"
                      onchange="clabRenderExpFrascos()">
    ${exps.map(e => {
      const verNote = e.formulaId !== _state.formulaId ? ` [${esc(e.formulaId)}]` : '';
      return `<option value="${esc(e.id)}">${esc(e.nombre)} · ${e.frascos.length} frascos${verNote}</option>`;
    }).join('')}
  </select>`;
  cont.innerHTML = `<div class="clab-row" style="margin-bottom:10px">${expSelHTML}</div>
    <div id="clab-comp-frascos"></div>`;
  clabRenderExpFrascos();
}

function clabCopiarSugerencia(texto) {
  var txt = String(texto || '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function() {
      notif('Copiado: ' + txt, 'ok');
    }).catch(function() {
      notif(txt, 'ok');
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); notif('Copiado: ' + txt, 'ok'); }
    catch(e) { notif(txt, 'ok'); }
    document.body.removeChild(ta);
  }
}

/**
 * MOTOR DE NORMALIZACIÓN CILAB (v3 FINAL)
 * Transforma cualquier frasco en una "Fórmula Virtual de 1 Litro".
 */
/**
 * Transforma un frasco de experimento en una lista de ingredientes normalizada a 1 L.
 *
 * Contrato de salida: cada item incluye `unidad` explícito, resuelto con prioridad:
 *   snapshot.unidad > live.unidad > 'gr' (fallback).
 * Esto garantiza que calcCN reciba siempre unidades explícitas sin inferencia.
 *
 * Las qty siguen expresadas en la unidad nativa del ingrediente (la normalización
 * a 1 L sólo escala magnitudes, no cambia unidades). Así classifyQty sigue
 * comparando qty contra rangos definidos en la misma unidad nativa.
 */
function _getNormalizedFrascoIngs(frasco, experimento, formula) {
  if (!frasco || !experimento || !formula) return { ingredientes: [], factor: 1 };

  const allIngs    = readIngredientes();
  const volBase    = parseFloat(experimento.volBase)  || 1000;
  const volFrasco  = parseFloat(frasco.volFrasco)     || volBase;
  const factor     = 1000 / volFrasco;   // escala todo al equivalente de 1 L
  const prepFactor = volFrasco / volBase; // fracción de la fórmula base en este frasco

  // 1. Base: qty_normalizada = qty_formula × (volFrasco/volBase) × (1000/volFrasco)
  //    Simplifica a: qty_formula × (1000/volBase)
  //    La unidad NO cambia — sólo la magnitud.
  const baseNorm = (formula.ingredientes || []).map(ing => {
    const live   = allIngs.find(x => x.id === ing.id);
    const unidad = ing.snapshot?.unidad || live?.unidad || 'gr';
    return {
      id:       ing.id,
      qty:      (ing.qty || 0) * prepFactor * factor,
      unidad,
      snapshot: ing.snapshot,
      type:     'base',
    };
  });

  // 2. Extras del frasco y del experimento (si los hubiera)
  const fExtras  = frasco.extras      || frasco.ingredientesAdicionales      || frasco.adicionales      || [];
  const eExtras  = experimento.extras || experimento.ingredientesAdicionales  || experimento.adicionales || [];
  const rawExtras = [...fExtras, ...eExtras];

  const extrasNorm = rawExtras
    .filter(e => (e.id || e.ingId))
    .map(e => {
      const ingId  = e.id || e.ingId;
      const live   = allIngs.find(x => x.id === ingId);
      const unidad = live?.unidad || 'gr';  // extras no tienen snapshot → sólo live
      return {
        id:     ingId,
        qty:    (e.qty || 0) * factor,
        unidad,
        type:   'extra',
      };
    });

  // 3. Merge: si un extra coincide con un ingrediente base, suma qty (misma unidad garantizada)
  const result = [...baseNorm];
  extrasNorm.forEach(extra => {
    const existing = result.find(i => i.id === extra.id);
    if (existing) {
      existing.qty  += extra.qty;
      existing.type  = 'mixto';
    } else {
      result.push(extra);
    }
  });

  return { ingredientes: result, factor };
}

function _consolidateIngs(ings) {
  const map = {};
  for (const fi of ings) {
    if (!fi.id) continue;
    if (map[fi.id]) {
      map[fi.id].qty += (fi.qty || 0);
    } else {
      map[fi.id] = { id: fi.id, qty: fi.qty || 0, snapshot: fi.snapshot };
    }
  }
  return Object.values(map);
}

// ═══════════════════════════════════════════════════════
// COMPARISON MODE — genética auto desde CI
// ═══════════════════════════════════════════════════════

/** Abrevia especie como CI: "Psilocybe cubensis / APE / 244" → "PC / APE / 244" */
function _abrevEspecie(label) {
  if (!label) return '?';
  const parts = label.split(' / ');
  const base  = parts[0].trim();
  if (!base) return '?';
  const abrev = base.split(/\s+/).map(w => (w[0] || '').toUpperCase()).join('');
  return parts.length > 1 ? [abrev, ...parts.slice(1)].join(' / ') : abrev;
}

/**
 * Lee bl2_seg y devuelve las cepas con totalPlacas para un frasco de experimento.
 * @param {object} exp       - objeto de bl2_experimentos
 * @param {string} frLabel   - frasco.label (ej: "A (Control)", "B")
 * @returns {Array<{geneticaId:string, geneticaLabel:string, totalPlacas:number}>}
 */
function _getCIGeneticasForFrasco(exp, frLabel) {
  const segs = gArr('bl2_seg');
  const rows = segs.filter(s =>
    s.experimentoId === exp.id &&
    s.experimentoFrascoId === frLabel &&
    s.genetica
  );
  const map = {};
  rows.forEach(r => {
    const g = r.genetica;
    if (!map[g]) map[g] = { geneticaId: g, geneticaLabel: _abrevEspecie(g), totalPlacas: 0 };
    map[g].totalPlacas += (Number(r.placas) || 0);
  });
  return Object.values(map);
}

function clabRenderExpFrascos() {
  const sel  = document.getElementById('clab-comp-sel');
  const cont = document.getElementById('clab-comp-frascos');
  if (!sel || !cont) return;
  const expId = sel.value;
  const exp   = readExperimentos().find(e => e.id === expId);
  if (!exp) { cont.innerHTML = ''; return; }
  const f = readForms().find(x => x.id === exp.formulaId);
  if (!f) { cont.innerHTML = '<div class="clab-empty">Fórmula base no disponible.</div>'; return; }
  const allIngs = readIngredientes();

  const panels = exp.frascos.map((fr, frascoIdx) => {
    // ── Datos metabólicos ─────────────────────────────────────────────────
    const norm  = _getNormalizedFrascoIngs(fr, exp, f);
    const ings  = norm.ingredientes;
    const st    = calcEstadoRutas(ings, null);
    const cn    = calcCN(ings, allIngs);
    const score = calcRizomorfico(st, cn.cn);

    // ── Extras del frasco ─────────────────────────────────────────────────
    const fExtras = (fr.extras || []).filter(e => (e.ingId || e.id) && (e.qty || 0) > 0);
    const extrasHTML = fExtras.length
      ? fExtras.map(e => {
          const ingId = e.ingId || e.id;
          const live  = allIngs.find(x => x.id === ingId);
          return `<span class="clab-frasco-extra-tag">+${esc(live ? live.nombre : ingId)} ${e.qty}${live && live.unidad ? ' ' + live.unidad : ''}</span>`;
        }).join('')
      : `<span class="clab-frasco-extra-tag clab-frasco-extra-empty">sin extras</span>`;

    const cepas = _getCIGeneticasForFrasco(exp, fr.label);
    const cepasHTML = cepas.length > 0
      ? `<div class="clab-frasco-cepas">${cepas.map(c =>
          `<span class="clab-gen-chip">🧬 ${esc(c.geneticaLabel)} · ${c.totalPlacas} pl.</span>`
        ).join('')}</div>`
      : '';

    return `<div class="clab-frasco-panel">
      <div class="clab-frasco-panel-header"
           title="Abrir en Analizador"
           onclick="clabLoadFrascoInAnalyzer(${frascoIdx},'${esc(expId)}')">
        <span>${esc(fr.label)} · ${fr.volFrasco}ml</span>
        <b>${score.toFixed(1)}/100</b>
      </div>
      ${buildGraphSVG(st, { rizoScore: score, uid: 'comp-' + frascoIdx })}
      <div class="clab-frasco-panel-meta">
        <span>C/N ${cn.cn != null ? cn.cn.toFixed(1) : '—'}</span>
        <span class="clab-badge-origin mixt" style="font-size:7px;padding:1px 4px;opacity:0.8">×${norm.factor.toFixed(1)}</span>
      </div>
      <div class="clab-frasco-extras-row">${extrasHTML}</div>
      ${cepasHTML}
    </div>`;
  }).join('');

  cont.innerHTML = `<div class="clab-frasco-panel-grid">${panels}</div>`;
}



// ════════════════════════════════════════════
// MODO FRASCO — carga un frasco en el analizador principal
// ════════════════════════════════════════════

/** Carga los ingredientes del frasco `frascoIdx` del experimento `expId`
 *  en el analizador principal como modo de sólo lectura. */
function clabLoadFrascoInAnalyzer(frascoIdx, expId) {
  const exp = readExperimentos().find(e => e.id === expId);
  const f = exp ? readForms().find(x => x.id === exp.formulaId) : null;
  const fr = exp?.frascos[frascoIdx];

  if (!fr || !exp || !f) {
    if (typeof notif === 'function') notif("Error cargando frasco", "danger");
    return;
  }

  const norm = _getNormalizedFrascoIngs(fr, exp, f);
  _state.expFrascoIngs  = norm.ingredientes;
  _state.expFrascoLabel = `${fr.label} · ${fr.volFrasco}ml`;
  _state.expFrascoNormFactor = norm.factor;

  clabSubTab('analizador');
  if (typeof notif === 'function') {
    notif(`✅ Frasco ${fr.label} cargado (×${norm.factor.toFixed(1)} → 1000ml)`, "ok");
  }
}

/** Sale del modo frasco y vuelve al analizador normal. */
function clabClearFrascoMode() {
  _state.expFrascoIngs  = null;
  _state.expFrascoLabel = '';
  _state.expFrascoNormFactor = 1;
  renderAnalyzer();
}

// ════════════════════════════════════════════
// PANEL DE DETALLE (slide-in derecha)
// ════════════════════════════════════════════
function clabOpenRouteDetail(routeId) {
  const r = ROUTES.find(x => x.id === routeId);
  if (!r) return;
  const ings = _getEffectiveIngs();
  const states = calcEstadoRutas(ings, null);
  const st = states[routeId] || { status: 'INACTIVA', triggers: [] };

  const conseq = r.consequence || {};
  const triggersHTML = (st.triggers || []).map(t => {
    const stClass = _stBadgeClass(t.status);
    const range = t.range?.rangoOptimo ? `<span class="clab-detail-trigger-range">opt ${t.range.rangoOptimo.min}-${t.range.rangoOptimo.max}</span>` : '<span class="clab-detail-trigger-range">sin rango</span>';
    return `<div class="clab-detail-trigger-row">
      <span class="clab-detail-trigger-name">${esc(t.ing.nombre)}${t.role ? ` <span class="clab-muted" style="font-size:10px">· ${esc(t.role)}</span>` : ''}</span>
      <span class="clab-detail-trigger-qty">${(+t.qty).toFixed(2)}</span>
      ${range}
      <span class="${stClass}">${esc(STATUS_LABEL[t.status] || t.status)}</span>
    </div>`;
  }).join('');

  const downstream = EDGES.filter(e => e.from === routeId).map(e => ROUTES.find(r => r.id === e.to)?.short || e.to);
  const upstream   = EDGES.filter(e => e.to === routeId).map(e => ROUTES.find(r => r.id === e.from)?.short || e.from);

  document.getElementById('clab-detail-icon').textContent = r.icon || '·';
  document.getElementById('clab-detail-icon').style.color = r.color;
  document.getElementById('clab-detail-title').innerHTML =
    `${esc(r.name)} <span class="clab-mono clab-muted" style="font-size:10px;margin-left:6px">N${r.level}</span>`;

  // Activadores nativos de la ruta (del array activators[] — independiente de la fórmula)
  const nativeActsHTML = (r.activators || [])
    .filter(a => !a._future && (a.name || a.role))
    .map(a => {
      // Extrae un hint legible del regex: primer token antes del pipe, sin chars especiales
      const hint = a.name
        ? a.name.source.split('|')[0]
            .replace(/\[([^\]]+)\]/g, (_, g) => g.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, ''))
            .replace(/[\\^$()?+*{}]/g, '').replace(/\s+/g, ' ').trim()
        : '';
      return `<div style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:11px">
        <span style="color:${r.color};min-width:90px;font-family:'JetBrains Mono',monospace">${esc(hint || '—')}</span>
        ${a.role ? `<span class="clab-muted">${esc(a.role)}</span>` : ''}
      </div>`;
    }).join('');

  const body = document.getElementById('clab-detail-body');
  body.innerHTML = `
    ${r.summary ? `<div class="clab-detail-section" style="border-left:3px solid ${r.color};padding-left:10px">
      <div style="font-size:12px;line-height:1.5;color:var(--tx2)">${esc(r.summary)}</div>
    </div>` : ''}

    <div class="clab-detail-section">
      <h4>Estado actual</h4>
      <span class="${_stBadgeClass(st.status)}">${esc(STATUS_LABEL[st.status] || st.status)}</span>
    </div>

    <div class="clab-detail-section">
      <h4>Mecanismo bioquímico</h4>
      <div class="clab-detail-mech" style="color:${r.color}">${esc(r.mechanism)}</div>
    </div>

    <div class="clab-detail-section">
      <h4>Consecuencia morfológica</h4>
      <div class="clab-detail-conseq">
        <span class="clab-c-wn">↗ Activa:</span> ${esc(conseq.activa || '—')}<br>
        <span class="clab-c-er">↘ Inactiva:</span> ${esc(conseq.inactiva || '—')}
      </div>
    </div>

    ${nativeActsHTML ? `<div class="clab-detail-section">
      <h4>Tipos de activadores</h4>
      <div style="padding:4px 0">${nativeActsHTML}</div>
    </div>` : ''}

    ${triggersHTML ? `<div class="clab-detail-section">
      <h4>Activadores en esta fórmula</h4>
      ${triggersHTML}
    </div>` : `<div class="clab-detail-section">
      <h4>Activadores en esta fórmula</h4>
      <div class="clab-detail-conseq" style="color:var(--tx2);font-size:11px">Ningún ingrediente de la fórmula actual activa esta ruta.</div>
    </div>`}

    <div class="clab-detail-section">
      <h4>Topología</h4>
      <div class="clab-detail-conseq">
        ${upstream.length ? `<span class="clab-mono clab-muted">↑ recibe de:</span> ${upstream.map(esc).join(', ')}<br>` : ''}
        ${downstream.length ? `<span class="clab-mono clab-muted">↓ alimenta:</span> ${downstream.map(esc).join(', ')}` : ''}
      </div>
    </div>
    ${buildRouteSuggestionsHTML(routeId, st.status)}
  `;
  _openDetailPanel();
}

function clabOpenInteractionDetail(routeId) {
  const interactions = detectActiveInteractions(_getEffectiveIngs())
    .filter(rule => rule.rutasAfectadas.includes(routeId));
  if (!interactions.length) return;
  const route = ROUTES.find(r => r.id === routeId);
  const hasCritical = interactions.some(r => r.severidad === 'critica');
  const color = hasCritical ? '#FF2244' : '#FFC000';
  document.getElementById('clab-detail-icon').textContent = hasCritical ? '!' : '?';
  document.getElementById('clab-detail-icon').style.color = color;
  document.getElementById('clab-detail-title').innerHTML =
    `Interacciones en <span style="color:${route?.color || color}">${esc(route?.short || routeId)}</span>`;
  const body = document.getElementById('clab-detail-body');
  body.innerHTML = interactions.map(rule => {
    const sevColor = rule.severidad === 'critica' ? '#FF2244' : '#FFC000';
    const ingsHTML = rule.ingsPresentes.map(p =>
      `<span style="background:rgba(255,255,255,0.06);border:1px solid var(--border);
        border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace">
        ${esc(p.ing.nombre)} · ${(+p.qty).toFixed(2)} ${esc(p.ing.unidad || '')}
      </span>`
    ).join(' + ');
    return `
      <div class="clab-detail-section" style="border-left:3px solid ${sevColor};padding-left:10px">
        <h4 style="color:${sevColor}">${esc(rule.titulo)}</h4>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${ingsHTML}</div>
        <div class="clab-detail-mech">${esc(rule.descripcion)}</div>
        <div style="margin-top:10px;padding:8px 10px;background:rgba(0,204,51,0.07);
          border:1px solid rgba(0,204,51,0.25);border-radius:6px;font-size:12px;color:var(--ac)">
          ${esc(rule.sugerencia)}
        </div>
      </div>`;
  }).join('');
  _openDetailPanel();
}

/** Renderiza la sección "Distribución metabólica" del panel de detalle.
 *  Si el ingrediente tiene `contribuciones` en su meta, muestra un input
 *  por ruta con el porcentaje, la suma en tiempo real, y el badge de estimado.
 *  Si no tiene contribuciones, muestra un placeholder informativo. */
function _renderContribSection(ingId, m) {
  const contrib = m.contribuciones;
  const isEstimado = !!m.contribucionesEstimadas;

  if (!contrib || typeof contrib !== 'object') {
    return `<div class="clab-detail-section">
      <h4>Distribución metabólica</h4>
      <div class="clab-empty" style="padding:8px 0;font-size:11px">
        Sin distribución configurada · importá datos de contribuciones desde JSON.
      </div>
    </div>`;
  }

  // Suma inicial para mostrar al renderizar
  let initSum = 0;
  ROUTES.filter(r => !r.isOutput).forEach(r => {
    initSum += typeof contrib[r.id] === 'number' ? contrib[r.id] : 0;
  });
  initSum = Math.round(initSum * 10) / 10;

  const estimadoBadge = isEstimado
    ? `<span class="clab-badge" style="background:#FFC00022;color:#FFC000;border-color:#FFC00066;
           font-size:10px;padding:2px 8px;display:inline-block;margin-bottom:10px">
         ⚠ Estimado · pendiente calibración
       </span>`
    : '';

  const inputs = ROUTES.filter(r => !r.isOutput).map(r => {
    const val = typeof contrib[r.id] === 'number' ? contrib[r.id] : 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
      <span style="width:100px;font-size:11px;color:${r.color};font-family:'JetBrains Mono',monospace">${esc(r.short)}</span>
      <input type="number" min="0" max="100" step="0.1"
        id="clab-contrib-${esc(r.id)}"
        value="${val}"
        oninput="clabUpdateContribSum()"
        style="width:72px;padding:4px 6px;font-size:12px;background:var(--bg-tertiary);
               border:1px solid var(--border);border-radius:4px;color:var(--tx);text-align:right">
      <span style="font-size:11px;color:var(--tx3)">%</span>
    </div>`;
  }).join('');

  const sumColor = Math.abs(initSum - 100) < 0.5 ? 'var(--wn)' : 'var(--warning)';

  return `<div class="clab-detail-section">
    <h4>Distribución metabólica</h4>
    ${estimadoBadge}
    <div style="margin-bottom:10px">
      ${inputs}
    </div>
    <div id="clab-contrib-sum" style="font-size:12px;font-weight:600;margin-bottom:8px;color:${sumColor}">
      Suma: ${initSum}%${Math.abs(initSum - 100) >= 0.5 ? ' · debe ser 100' : ' ✓'}
    </div>
    <button class="clab-btn clab-btn-p clab-btn-sm" onclick="clabSaveContribuciones('${esc(ingId)}')">
      💾 Guardar distribución
    </button>
  </div>`;
}

/** Actualiza en tiempo real el display de suma de contribuciones. */
function clabUpdateContribSum() {
  let sum = 0;
  ROUTES.filter(r => !r.isOutput).forEach(r => {
    const inp = document.getElementById(`clab-contrib-${r.id}`);
    sum += parseFloat(inp?.value) || 0;
  });
  sum = Math.round(sum * 10) / 10;
  const el = document.getElementById('clab-contrib-sum');
  if (!el) return;
  const ok = Math.abs(sum - 100) < 0.5;
  el.style.color = ok ? 'var(--wn)' : 'var(--warning)';
  el.textContent = `Suma: ${sum}%${!ok ? ' · debe ser 100' : ' ✓'}`;
}

/** Guarda la distribución metabólica editada por el usuario.
 *  Marca contribucionesEstimadas: false porque el usuario editó manualmente. */
function clabSaveContribuciones(ingId) {
  const contrib = {};
  let sum = 0;
  ROUTES.filter(r => !r.isOutput).forEach(r => {
    const inp = document.getElementById(`clab-contrib-${r.id}`);
    const val = Math.max(0, parseFloat(inp?.value) || 0);
    if (val > 0) contrib[r.id] = val;
    sum += val;
  });

  // Edición manual → ya no es estimado
  const all = loadMeta();
  const prev = all[ingId] || {};
  if (Object.keys(contrib).length > 0) {
    all[ingId] = Object.assign({}, prev, {
      contribuciones: contrib,
      contribucionesEstimadas: false,
      updatedAt: now(),
    });
  } else {
    // Si todos son 0, eliminar el campo para no dejar un objeto vacío
    all[ingId] = Object.assign({}, prev, { updatedAt: now() });
    delete all[ingId].contribuciones;
    delete all[ingId].contribucionesEstimadas;
  }
  saveMeta(all);

  const sumRound = Math.round(sum * 10) / 10;
  const sumWarn  = Math.abs(sum - 100) >= 0.5 ? ` · ⚠ suma ${sumRound}%` : '';
  notif(`💾 Distribución guardada${sumWarn}`, 'ok');

  clabOpenIngDetail(ingId);
  renderAnalyzer();
  renderBiblio();
}

function clabOpenIngDetail(ingId) {
  if (_ingDetailDirty && !confirm('Tenés cambios sin guardar. ¿Salir igual?')) return;
  _ingDetailDirty = false;
  const ings = readIngredientes();
  const i = ings.find(x => x.id === ingId);
  if (!i) return;
  const m = getIngMeta(ingId) || {};
  const obs = gArr(K.obs).filter(o => o.ingId === ingId);
  const usedRoutes = ROUTES.filter(r => !r.isOutput && r.activators?.some(a => a.name && a.name.test(i.nombre || '')));

  document.getElementById('clab-detail-icon').textContent = '🧪';
  document.getElementById('clab-detail-icon').style.color = ASP_COLORS[i.aspecto] || 'var(--ac2)';
  document.getElementById('clab-detail-title').innerHTML = `${esc(i.nombre)} <span class="clab-mono clab-muted" style="font-size:10px;margin-left:6px">${esc(i.id)}</span>`;

  const body = document.getElementById('clab-detail-body');
  const estadoBadge = m.estado
    ? `<span class="clab-badge clab-badge-${m.estado === 'sin_datos' ? 'sindata' : m.estado === 'en_ensayo' ? 'ensayo' : m.estado}">${m.estado.replace('_', ' ')}</span>`
    : `<span class="clab-badge clab-badge-sindata">sin datos</span>`;

  body.innerHTML = `
    <div class="clab-detail-section" style="position:sticky;top:0;z-index:1;background:var(--bg-secondary,#1a1a1a);padding-bottom:10px;margin-bottom:4px">
      <button class="clab-btn clab-btn-p" style="width:100%" onclick="clabSaveIngAll('${esc(ingId)}')">💾 Guardar cambios</button>
    </div>
    <div class="clab-detail-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h4>Datos Base</h4>
        ${estadoBadge}
      </div>
      <div class="clab-grid-2">
        <div class="clab-fg">
          <label>Nombre</label>
          <input type="text" id="clab-edit-nombre" class="clab-input" value="${esc(i.nombre)}">
        </div>
        <div class="clab-fg">
          <label>Unidad</label>
          <select id="clab-edit-unidad" class="clab-input">
            ${(() => { const U=['gr','mg','ml','ud'], cur=i.unidad||''; return (cur&&!U.includes(cur)?`<option value="${esc(cur)}" selected>${esc(cur)}</option>`:'')+U.map(u=>`<option value="${u}"${u===cur?' selected':''}>${u}</option>`).join(''); })()}
          </select>
        </div>
      </div>
      <div class="clab-grid-3">
        <div class="clab-fg">
          <label>Aspecto</label>
          <select id="clab-edit-aspecto" class="clab-select">
            ${['Solvente','Soporte','Carbono','Nitrógeno','Mineral','Cofactores'].map(a => 
              `<option value="${a}" ${a === i.aspecto ? 'selected' : ''}>${a}</option>`
            ).join('')}
          </select>
        </div>
        <div class="clab-fg">
          <label>% C</label>
          <input type="number" id="clab-edit-pc" class="clab-input" value="${i.pc || 0}" step="0.1" min="0">
        </div>
        <div class="clab-fg">
          <label>% N</label>
          <input type="number" id="clab-edit-pn" class="clab-input" value="${i.pn || 0}" step="0.1" min="0">
        </div>
      </div>
      <div class="clab-fg">
        <label>Notas</label>
        <textarea id="clab-edit-notas" class="clab-textarea" rows="2">${esc(i.notas || '')}</textarea>
      </div>
      <div class="clab-detail-section" style="margin-top:10px">
        <h4 style="margin-bottom:6px">Rango Base del Advisor</h4>
        <div class="clab-grid-3">
          <div class="clab-fg">
            <label>Mín</label>
            <input type="number" id="clab-edit-rango-min" class="clab-input"
              value="${i.rangoBase?.min ?? ''}" step="0.01" min="0"
              placeholder="0.0">
          </div>
          <div class="clab-fg">
            <label>Máx</label>
            <input type="number" id="clab-edit-rango-max" class="clab-input"
              value="${i.rangoBase?.max ?? ''}" step="0.01" min="0"
              placeholder="0.0">
          </div>
          <div class="clab-fg">
            <label>Unidad</label>
            <select id="clab-edit-rango-unidad" class="clab-input">
              ${(() => { const U=['gr','mg','ml','ud'], cur=i.rangoBase?.unidad??i.unidad??''; return (cur&&!U.includes(cur)?`<option value="${esc(cur)}" selected>${esc(cur)}</option>`:'')+U.map(u=>`<option value="${u}"${u===cur?' selected':''}>${u}</option>`).join(''); })()}
            </select>
          </div>
        </div>
        <p class="clab-muted" style="font-size:10px;margin-top:4px">
          Rango de dosis para recomendaciones del Advisor cuando no hay rango por cepa definido.
        </p>
      </div>
      <div class="clab-row" style="margin-top:8px">
        ${m.seeded ? `<span class="clab-badge clab-badge-seeded" style="margin-left:auto">seed</span>` : ''}
      </div>
    </div>

    <div class="clab-detail-section">
      <h4>Rangos editables</h4>

      <div class="clab-edit-block">
        <label>Rango óptimo (${esc(i.unidad || '')})</label>
        <div class="clab-edit-pair">
          <input type="number" step="0.01" id="clab-edit-opt-min" value="${m.rangoOptimo?.min ?? ''}" placeholder="mín">
          <span>—</span>
          <input type="number" step="0.01" id="clab-edit-opt-max" value="${m.rangoOptimo?.max ?? ''}" placeholder="máx">
        </div>
      </div>

      <div class="clab-edit-block">
        <label>Rango seguro (${esc(i.unidad || '')})</label>
        <div class="clab-edit-pair">
          <input type="number" step="0.01" id="clab-edit-seg-min" value="${m.rangoSeguro?.min ?? ''}" placeholder="mín">
          <span>—</span>
          <input type="number" step="0.01" id="clab-edit-seg-max" value="${m.rangoSeguro?.max ?? ''}" placeholder="máx">
        </div>
      </div>

      <div class="clab-edit-block">
        <label>Alerta crítica · umbral (${esc(i.unidad || '')})</label>
        <input type="number" step="0.01" id="clab-edit-crit-min" value="${m.alertaCritica?.min ?? ''}" placeholder="ej: 3.5 — sobre este valor se activa la alerta">
      </div>

      <div class="clab-edit-block">
        <label>Mensaje de alerta crítica</label>
        <input type="text" id="clab-edit-crit-msg" value="${esc(m.alertaCritica?.msg || '')}" placeholder="qué consecuencia bioquímica produce el exceso">
      </div>

      <div class="clab-edit-block">
        <label>Estado de validación</label>
        <select id="clab-edit-estado" class="clab-select" style="font-size:12px;padding:7px 9px">
          <option value="validado" ${m.estado === 'validado' ? 'selected' : ''}>Validado</option>
          <option value="en_ensayo" ${m.estado === 'en_ensayo' ? 'selected' : ''}>En ensayo</option>
          <option value="peligro" ${m.estado === 'peligro' ? 'selected' : ''}>Peligro</option>
          <option value="sin_datos" ${m.estado === 'sin_datos' || !m.estado ? 'selected' : ''}>Sin datos</option>
        </select>
      </div>

      <div class="clab-row" style="margin-top:10px">
        ${m.seeded ? `<button class="clab-btn clab-btn-d clab-btn-sm" onclick="clabResetSeed('${esc(ingId)}')">↻ Reset al seed</button>` : ''}
      </div>
    </div>

    <div class="clab-detail-section">
      <h4>Mecanismo bioquímico</h4>
      <textarea id="clab-edit-mech" class="clab-textarea" rows="4">${esc(m.mecanismo || '')}</textarea>
    </div>

    <div class="clab-detail-section">
      <h4>Activa rutas metabólicas</h4>
      ${_renderRouteOriginNote(ingId, m)}
      <div class="clab-route-chips">
        ${ROUTES.filter(r => !r.isOutput).map(r => {
          // Si rutas es un array (aunque sea vacío) → override manual gana.
          // Sólo si rutas no existe (undefined) → fallback al regex.
          const isManual = Array.isArray(m.rutas);
          const checked = isManual
            ? m.rutas.includes(r.id)
            : (r.activators || []).some(a => a.name && a.name.test(i.nombre || ''));
          const styleOn  = `background:${r.color}26;color:${r.color};border-color:${r.color}80`;
          const styleOff = `background:var(--bg-tertiary);color:var(--tx2);border-color:var(--border)`;
          const tooltip = `${r.name}${r.summary ? ' — ' + r.summary : ''}`;
          return `<span class="clab-route-chip${checked ? ' on' : ''}"
                       style="${checked ? styleOn : styleOff}"
                       onclick="clabToggleRoute('${esc(ingId)}', '${esc(r.id)}')"
                       title="${esc(tooltip)}">
            <span class="clab-route-chip-dot"></span>
            ${esc(r.short)}
          </span>`;
        }).join('')}
      </div>
      ${Array.isArray(m.rutas)
        ? `<div class="clab-row" style="margin-top:8px">
            <button class="clab-btn clab-btn-s clab-btn-sm" onclick="clabClearRouteOverrides('${esc(ingId)}')">
              ↺ Volver al matching automático
            </button>
          </div>`
        : ''}
    </div>

    ${_renderContribSection(ingId, m)}

    ${(m.alertaCritica || (m.alertas && m.alertas.length)) ? `<div class="clab-detail-section">
      <h4>Alertas</h4>
      ${m.alertaCritica ? `<div class="clab-detail-alert">⚠ <b>>${m.alertaCritica.min}</b>: ${esc(m.alertaCritica.msg || '')}</div>` : ''}
      ${(m.alertas || []).map(a => `<div class="clab-detail-alert" style="background:rgba(255,192,0,0.08);border-color:#FFC000;color:#FFC000">⚠ ${esc(a.msg)}</div>`).join('')}
    </div>` : ''}

    <div class="clab-detail-section">
      <h4>Historial de ensayos (${obs.length})</h4>
      ${_renderObsHistoryFor(ingId)}
    </div>

    <div class="clab-detail-section">
      <h4>Rangos por genética</h4>
      ${_renderStrainBreakdownFor(ingId)}
    </div>

    <div class="clab-detail-section" style="border-top:1px solid #404040;margin-top:20px;padding-top:16px">
      <button class="clab-btn clab-btn-d clab-btn-sm" onclick="cilabEliminarIngrediente('${esc(ingId)}')">✕ Eliminar Ingrediente</button>
    </div>
  `;
  body.oninput = () => { _ingDetailDirty = true; };
  _openDetailPanel();
}

function _renderObsHistoryFor(ingId) {
  const obs = gArr(K.obs).filter(o => o.ingId === ingId).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  if (!obs.length) return `<div class="clab-empty" style="padding:8px">Sin ensayos registrados.</div>`;
  return obs.slice(0, 10).map(o => {
    const phenoCls = `clab-pheno-pill ${_phenoClass(o.fenotipo)}`;
    return `<div class="clab-detail-trigger-row" style="font-size:11px">
      <span class="clab-mono" style="min-width:55px">${esc(fmtDate(o.fecha))}</span>
      <span class="clab-mono" style="color:var(--ac2)">${(+o.qty).toFixed(2)}</span>
      <span class="${phenoCls}">${esc(_phenoLabel(o.fenotipo))}</span>
      <span class="clab-detail-trigger-name" style="font-size:10px;color:var(--tx3)">${esc(o.geneticaLabel || '—')}</span>
    </div>`;
  }).join('') + (obs.length > 10 ? `<div class="clab-help">... y ${obs.length - 10} más</div>` : '');
}

function _renderStrainBreakdownFor(ingId) {
  const obs = gArr(K.obs).filter(o => o.ingId === ingId && o.geneticaId);
  if (!obs.length) return `<div class="clab-empty" style="padding:8px">Sin observaciones vinculadas a genética.</div>`;
  const byGen = {};
  obs.forEach(o => {
    if (!byGen[o.geneticaId]) byGen[o.geneticaId] = { label: o.geneticaLabel, obs: [] };
    byGen[o.geneticaId].obs.push(o);
  });
  return Object.entries(byGen).map(([gid, data]) => {
    const sug = suggestRangeFromObs(data.obs);
    return `<div class="clab-detail-trigger-row" style="font-size:11px">
      <span class="clab-detail-trigger-name">${esc(data.label || gid)}</span>
      <span class="clab-mono">n=${data.obs.length}</span>
      ${sug ? `<span class="clab-mono clab-c-wn">${sug.min}–${sug.max}</span>` : '<span class="clab-muted">insuficiente</span>'}
    </div>`;
  }).join('');
}

function suggestRangeFromObs(obsArr) {
  // Solo observaciones con resultado positivo + fenotipo rizo/rizo_extremo
  const positives = obsArr.filter(o =>
    (o.resultado === 'positivo' || o.fenotipo === 'rizo' || o.fenotipo === 'rizo_extremo') &&
    o.qty > 0
  );
  if (positives.length < 3) return null;
  const qtys = positives.map(o => o.qty).sort((a, b) => a - b);
  // Use 20-80 percentile band
  const lo = qtys[Math.floor(qtys.length * 0.2)];
  const hi = qtys[Math.ceil(qtys.length * 0.8) - 1];
  return { min: +lo.toFixed(2), max: +hi.toFixed(2), n: positives.length };
}

function _openDetailPanel() {
  document.getElementById('clab-detail-panel').classList.add('open');
  document.getElementById('clab-detail-backdrop').classList.add('open');
  document.getElementById('clab-detail-panel').setAttribute('aria-hidden', 'false');
}

function clabCloseDetail() {
  if (_ingDetailDirty && !confirm('Tenés cambios sin guardar. ¿Salir igual?')) return;
  _ingDetailDirty = false;
  document.getElementById('clab-detail-panel').classList.remove('open');
  document.getElementById('clab-detail-backdrop').classList.remove('open');
  document.getElementById('clab-detail-panel').setAttribute('aria-hidden', 'true');
}

/** Hover sobre nodo: resalta sus edges directos, desvanece el resto al 10% */
function clabGraphHover(uid, routeId) {
  const svg = document.querySelector(`.clab-graph-svg[data-uid="${uid}"]`);
  if (!svg) return;
  const connected = new Set([routeId]);
  EDGES.forEach(e => {
    if (e.from === routeId) connected.add(e.to);
    if (e.to === routeId) connected.add(e.from);
  });
  svg.querySelectorAll('.clab-node').forEach(n => {
    n.style.transition = 'opacity 0.15s';
    n.style.opacity = connected.has(n.dataset.route) ? '1' : '0.1';
  });
  svg.querySelectorAll('path.clab-edge').forEach(p => {
    const isConn = p.dataset.from === routeId || p.dataset.to === routeId;
    p.style.transition = 'opacity 0.15s';
    p.style.opacity = isConn ? '1' : '0.06';
    if (isConn) p.style.filter = 'brightness(1.4)';
  });
}

/** Fin hover: restaura opacidades originales */
function clabGraphHoverEnd(uid) {
  const svg = document.querySelector(`.clab-graph-svg[data-uid="${uid}"]`);
  if (!svg) return;
  svg.querySelectorAll('.clab-node').forEach(n => {
    n.style.transition = 'opacity 0.2s';
    n.style.opacity = '';
  });
  svg.querySelectorAll('path.clab-edge').forEach(p => {
    p.style.transition = 'opacity 0.2s';
    p.style.opacity = '';
    p.style.filter = '';
  });
}

function _parseRange(minId, maxId) {
  const min = parseFloat(document.getElementById(minId).value);
  const max = parseFloat(document.getElementById(maxId).value);
  if (isNaN(min) || isNaN(max)) return null;
  if (max < min) return null;
  return { min, max };
}

// ════════════════════════════════════════════
// CRUD BASE DE INGREDIENTES
// ════════════════════════════════════════════

function cilabCrearIngrediente() {
  const modal = document.createElement('div');
  modal.className = 'clab-modal';
  modal.id = 'clab-crud-modal';
  modal.innerHTML = `
    <div class="clab-modal-backdrop" onclick="this.parentNode.remove()"></div>
    <div class="clab-modal-dialog" role="dialog" aria-modal="true" style="width:500px">
      <div class="clab-modal-header">
        <span style="color:#00CC33;font-weight:600">＋ Crear Ingrediente</span>
        <button type="button" class="clab-modal-close" onclick="this.closest('.clab-modal').remove()" title="Cerrar">✕</button>
      </div>
      <div class="clab-modal-body">
        <div class="clab-grid-2">
          <div class="clab-fg">
            <label>Nombre *</label>
            <input type="text" id="clab-crud-nombre" class="clab-input" placeholder="ej: Agar agar">
          </div>
          <div class="clab-fg">
            <label>Unidad *</label>
            <select id="clab-crud-unidad" class="clab-input">
              <option value="">— seleccionar —</option>
              <option value="gr">gr</option>
              <option value="mg">mg</option>
              <option value="ml">ml</option>
              <option value="ud">ud</option>
            </select>
          </div>
        </div>
        <div class="clab-grid-3">
          <div class="clab-fg">
            <label>Aspecto *</label>
            <select id="clab-crud-aspecto" class="clab-select">
              <option value="Solvente">Solvente</option>
              <option value="Soporte">Soporte</option>
              <option value="Carbono">Carbono</option>
              <option value="Nitrógeno">Nitrógeno</option>
              <option value="Mineral">Mineral</option>
              <option value="Cofactores">Cofactores</option>
            </select>
          </div>
          <div class="clab-fg">
            <label>% Carbono</label>
            <input type="number" id="clab-crud-pc" class="clab-input" value="0" min="0" step="0.1">
          </div>
          <div class="clab-fg">
            <label>% Nitrógeno</label>
            <input type="number" id="clab-crud-pn" class="clab-input" value="0" min="0" step="0.1">
          </div>
        </div>
        <div class="clab-fg">
          <label>Notas</label>
          <textarea id="clab-crud-notas" class="clab-textarea" rows="2" placeholder="Opcional..."></textarea>
        </div>
      </div>
      <div class="clab-modal-footer">
        <button type="button" class="clab-btn clab-btn-s" onclick="this.closest('.clab-modal').remove()">Cancelar</button>
        <button type="button" class="clab-btn clab-btn-p" onclick="cilabGuardarNuevoIngrediente(this.closest('.clab-modal'))">✓ Crear</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function cilabGuardarNuevoIngrediente(modal) {
  const nombre = document.getElementById('clab-crud-nombre').value.trim();
  const unidad = document.getElementById('clab-crud-unidad').value.trim();
  const aspecto = document.getElementById('clab-crud-aspecto').value;
  const pc = parseFloat(document.getElementById('clab-crud-pc').value) || 0;
  const pn = parseFloat(document.getElementById('clab-crud-pn').value) || 0;
  const notas = document.getElementById('clab-crud-notas').value.trim();

  if (!nombre || !unidad) return notif('Nombre y unidad son obligatorios', 'error');

  const ings = readIngredientes();
  const newId = nxtId('ING', ings);
  
  // El bio se inicializa sin_datos. La UI reactiva el bio en clabOpenIngDetail
  const bio = { estado: 'sin_datos', updatedAt: now() };
  
  ings.push({ id: newId, nombre, unidad, aspecto, pc, pn, notas, bio, creadoEn: now() });

  if (s(K.ings, ings)) {
    _dispatchIngsChanged({ tipo: 'creado', ingId: newId });
    notif('Ingrediente creado: ' + nombre, 'ok');
    modal.remove();
    renderBiblio();
    renderAnalyzer();
    updateHeaderStats();
    clabOpenIngDetail(newId);
  } else {
    notif('Error al guardar ingrediente', 'error');
  }
}

function clabSaveIngAll(ingId) {
  const nombre = document.getElementById('clab-edit-nombre').value.trim();
  const unidad = document.getElementById('clab-edit-unidad').value.trim();
  const aspecto = document.getElementById('clab-edit-aspecto').value;
  const pc = parseFloat(document.getElementById('clab-edit-pc').value) || 0;
  const pn = parseFloat(document.getElementById('clab-edit-pn').value) || 0;
  const notas = document.getElementById('clab-edit-notas').value.trim();

  if (!nombre || !unidad) return notif('Nombre y unidad son obligatorios', 'error');

  const $val = id => {
    const el = document.getElementById(id);
    if (!el) { console.warn('[CILAB] input no encontrado:', id); return ''; }
    return el.value;
  };

  const opt = _parseRange('clab-edit-opt-min', 'clab-edit-opt-max');
  const seg = _parseRange('clab-edit-seg-min', 'clab-edit-seg-max');
  const critMinRaw = $val('clab-edit-crit-min');
  const critMsg = ($val('clab-edit-crit-msg') || '').trim();
  const estado = $val('clab-edit-estado') || 'sin_datos';
  const mecanismo = document.getElementById('clab-edit-mech').value.trim();

  const rMin = parseFloat(document.getElementById('clab-edit-rango-min')?.value);
  const rMax = parseFloat(document.getElementById('clab-edit-rango-max')?.value);
  const rUnidad = (document.getElementById('clab-edit-rango-unidad')?.value || '').trim();

  const ings = readIngredientes();
  const ing = ings.find(x => x.id === ingId);
  if (!ing) return;

  ing.nombre = nombre;
  ing.unidad = unidad;
  ing.aspecto = aspecto;
  ing.pc = pc;
  ing.pn = pn;
  ing.notas = notas;
  if (!isNaN(rMin) && !isNaN(rMax) && rMin >= 0 && rMax >= rMin) {
    ing.rangoBase = { min: rMin, max: rMax, unidad: rUnidad || ing.unidad || '' };
  } else {
    ing.rangoBase = undefined;
  }
  ing.actualizadoEn = now();

  const bioUpd = { estado, mecanismo, seeded: false, updatedAt: now() };
  bioUpd.rangoOptimo = opt;
  bioUpd.rangoSeguro = seg;
  const critMin = parseFloat(critMinRaw);
  if (!isNaN(critMin)) bioUpd.alertaCritica = { min: critMin, msg: critMsg };
  else if (critMinRaw === '' && !critMsg) bioUpd.alertaCritica = null;
  ing.bio = Object.assign({}, ing.bio || {}, bioUpd);

  if (!s(K.ings, ings)) {
    return notif('Error al guardar — ver consola', 'error');
  }

  _dispatchIngsChanged({ tipo: 'editado', ingId });
  _ingDetailDirty = false;

  const partes = [];
  if (ing.bio.rangoOptimo) partes.push(`opt ${ing.bio.rangoOptimo.min}–${ing.bio.rangoOptimo.max}`);
  if (ing.bio.rangoSeguro) partes.push(`seg ${ing.bio.rangoSeguro.min}–${ing.bio.rangoSeguro.max}`);
  if (ing.bio.alertaCritica) partes.push(`crit >${ing.bio.alertaCritica.min}`);
  partes.push(`estado=${ing.bio.estado || 'sin_datos'}`);
  notif('💾 Guardado: ' + partes.join(' · '), 'ok');

  clabOpenIngDetail(ingId);
  renderBiblio();
  renderAnalyzer();
  updateHeaderStats();
}

function cilabEliminarIngrediente(ingId) {
  const formsEnUso = readForms().filter(f =>
    Array.isArray(f.ingredientes) && f.ingredientes.some(r => r.id === ingId)
  );
  const expEnUso = readExperimentos().filter(e => 
    e.ingredientesAdicionales && e.ingredientesAdicionales.some(r => r.id === ingId)
  );
  const cultivosEnUso = readCultivos().filter(c => c.ingredienteId === ingId);

  if (formsEnUso.length || expEnUso.length || cultivosEnUso.length) {
    let msg = 'No se puede eliminar: en uso en ';
    const parts = [];
    if (formsEnUso.length) parts.push(`${formsEnUso.length} fórmula(s)`);
    if (expEnUso.length) parts.push(`${expEnUso.length} experimento(s)`);
    if (cultivosEnUso.length) parts.push(`${cultivosEnUso.length} cultivo(s)`);
    return notif(msg + parts.join(', '), 'error');
  }

  if (!confirm('¿Eliminar ingrediente definitivamente? Esta acción no se puede deshacer.')) return;
  
  const ings = readIngredientes().filter(x => x.id !== ingId);
  if (s(K.ings, ings)) {
    _dispatchIngsChanged({ tipo: 'eliminado', ingId });
    notif('Ingrediente eliminado', 'ok');
    clabCloseDetail();
    renderBiblio();
    renderAnalyzer();
    updateHeaderStats();
  }
}

/** Texto explicativo bajo la sección de chips: indica si el matching de rutas
 *  para este ingrediente es automático (regex) o manual (override). */
function _renderRouteOriginNote(ingId, m) {
  const ings = readIngredientes();
  const i = ings.find(x => x.id === ingId);
  if (!i) return '';
  // Override manual = `rutas` es un array, sin importar si está vacío.
  // Vacío significa "no activa nada, pisa el regex que sí lo detectaría".
  const isManual = Array.isArray(m?.rutas);
  if (isManual) {
    const lenTxt = m.rutas.length === 0
      ? 'Sin rutas asignadas — este ingrediente no activa ninguna ruta (override explícito).'
      : 'Las rutas marcadas son las que vos asignaste.';
    return `<div class="clab-route-origin">
      Override manual activo. ${lenTxt}
      El matching automático por nombre está desactivado.
    </div>`;
  }
  // Auto-matching: mostrar qué rutas matchearon y por qué
  const matches = ROUTES.filter(r => !r.isOutput).flatMap(r => {
    return (r.activators || []).filter(a => a.name && a.name.test(i.nombre || ''))
      .map(a => ({ route: r, pattern: a.name.toString() }));
  });
  if (!matches.length) {
    return `<div class="clab-route-origin">
      Sin matching automático: ninguna ruta reconoce este ingrediente por su
      nombre. Marcá manualmente las rutas que activa.
    </div>`;
  }
  const txt = matches.map(mm => `<code>${esc(mm.route.short)}</code>`).join(', ');
  return `<div class="clab-route-origin">
    Matching automático por nombre. Detectado en: ${txt}.
    Marcá chips abajo para sobrescribir manualmente.
  </div>`;
}

/** Alterna una ruta en meta.rutas del ingrediente. Si el array no existía,
 *  lo inicializa con las rutas que el regex auto-detectaría — así el primer
 *  click del usuario no borra todo lo que estaba activo. */
function clabToggleRoute(ingId, routeId) {
  const ings = readIngredientes();
  const i = ings.find(x => x.id === ingId);
  if (!i) return;
  const m = getIngMeta(ingId) || {};
  // Si ya hay override (array, incluso vacío), partimos de ahí.
  // Si no, semilla con las rutas que el regex auto-detecta — para que el
  // primer click no borre todo lo previo (regex auto-match).
  let rutas = Array.isArray(m.rutas)
    ? m.rutas.slice()
    : ROUTES.filter(r => !r.isOutput && (r.activators || []).some(a => a.name && a.name.test(i.nombre || '')))
        .map(r => r.id);
  const idx = rutas.indexOf(routeId);
  if (idx >= 0) rutas.splice(idx, 1);
  else rutas.push(routeId);
  const saved = setIngMeta(ingId, { rutas });
  // Verificación post-write: leo de vuelta y comparo
  const verif = getIngMeta(ingId);
  const ok = verif && Array.isArray(verif.rutas)
    && verif.rutas.length === rutas.length
    && rutas.every(x => verif.rutas.includes(x));
  if (!ok) {
    console.error('[CILAB] toggleRoute: persistencia no verificada', { rutas, verif });
    notif('Error al persistir — revisá la consola', 'err');
    return;
  }
  console.log('[CILAB] toggleRoute', ingId, routeId, idx >= 0 ? 'quitada' : 'asignada', '→', rutas);
  notif(`${routeId}: ${idx >= 0 ? 'quitada' : 'asignada'}`, 'ok');
  // Refrescar UI: el panel está abierto, lo regeneramos en sitio
  clabOpenIngDetail(ingId);
  if (document.getElementById('clab-graph-container')?.children.length) {
    renderAnalyzer();
  }
}

/** Quita el override manual: vuelve al matching automático por regex. */
function clabClearRouteOverrides(ingId) {
  if (!confirm('¿Quitar el override manual y volver al matching automático por nombre?')) return;
  // delete la prop 'rutas' completa para que findActivators caiga al regex.
  // setIngMeta con array vacío NO sirve — vacío también es override (semántica nueva).
  const all = loadMeta();
  if (all[ingId]) {
    delete all[ingId].rutas;
    all[ingId].updatedAt = now();
    saveMeta(all);
  }
  notif('Override quitado — usando matching automático', 'ok');
  clabOpenIngDetail(ingId);
  if (document.getElementById('clab-graph-container')?.children.length) {
    renderAnalyzer();
  }
}

// ── Deshabilitar / habilitar ingrediente (excluye del optimizador) ─────────
function clabToggleIngDisabled(ingId, event) {
  if (event) event.stopPropagation();
  const m       = getIngMeta(ingId);
  const wasDisabled = m?.disabled || false;
  setIngMeta(ingId, { disabled: !wasDisabled });
  notif(
    wasDisabled
      ? '✓ Ingrediente habilitado'
      : '⛔ Ingrediente deshabilitado — no aparecerá en sugerencias',
    wasDisabled ? 'ok' : 'warn'
  );
  renderBiblio();
}

function clabResetSeed(ingId) {
  if (!confirm('¿Volver a aplicar los valores del seed inicial?')) return;
  const ings = readIngredientes();
  const ing = ings.find(i => i.id === ingId);
  if (!ing) return;
  const seed = SEED_META.find(sd => sd.match.test(ing.nombre || ''));
  if (!seed) { notif('Este ingrediente no tiene seed definido.', 'err'); return; }
  setIngMeta(ingId, {
    estado:        seed.estado,
    rangoOptimo:   seed.rangoOptimo,
    rangoSeguro:   seed.rangoSeguro,
    alertaCritica: seed.alertaCritica || null,
    alertas:       seed.alertas || [],
    mecanismo:     seed.mecanismo,
    rutas:         seed.rutas || [],
    seeded:        true,
  });
  notif('Seed aplicado', 'ok');
  clabOpenIngDetail(ingId);
  renderBiblio();
  renderAnalyzer();
}

// ════════════════════════════════════════════
// BIBLIOTECA — sección 1
// ════════════════════════════════════════════
/** Inserta (idempotente) un card colapsable con el glosario de las 8 rutas
 *  en la pestaña Biblioteca. El usuario lo abre y aprende qué hace cada ruta. */
function _renderGlosarioRutas() {
  const panel = document.getElementById('clab-sub-biblioteca');
  if (!panel) return;
  if (document.getElementById('clab-glosario-card')) return; // ya insertado

  const card = document.createElement('div');
  card.id = 'clab-glosario-card';
  card.className = 'clab-card';
  card.style.cssText = 'padding:0;overflow:hidden';

  const rutas = ROUTES.filter(r => !r.isOutput);
  const items = rutas.map(r => `
    <div style="display:flex;gap:10px;padding:8px 14px;border-top:1px solid var(--border);align-items:flex-start">
      <span style="display:inline-flex;align-items:center;justify-content:center;
                   width:28px;height:28px;border-radius:50%;
                   background:${r.color}1F;color:${r.color};
                   border:1.5px solid ${r.color}66;font-family:'JetBrains Mono',monospace;
                   font-size:14px;flex-shrink:0">${esc(r.icon || '·')}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:${r.color};font-size:12px;font-family:'JetBrains Mono',monospace">
          ${esc(r.short)}
          <span style="color:var(--tx3);font-weight:400;margin-left:6px">${esc(r.name)} · N${r.level}</span>
        </div>
        <div style="font-size:12px;color:var(--tx2);line-height:1.5;margin-top:3px">
          ${esc(r.summary || r.mechanism.split('.')[0] + '.')}
        </div>
      </div>
    </div>`).join('');

  card.innerHTML = `
    <div onclick="clabToggleGlosario()" style="padding:14px 18px;cursor:pointer;
         display:flex;align-items:center;gap:10px;user-select:none">
      <span style="font-size:14px">📖</span>
      <span style="font-family:'Inter',sans-serif;font-size:13px;font-weight:600;
                   letter-spacing:1px;text-transform:uppercase;color:var(--ac4)">
        Glosario metabólico — qué hace cada ruta
      </span>
      <span id="clab-glosario-chev" style="margin-left:auto;color:var(--tx3);
            font-size:11px;transition:transform .2s">▼</span>
    </div>
    <div id="clab-glosario-body" style="display:none;background:var(--bg-tertiary)">
      ${items}
      <div style="padding:10px 14px;border-top:1px solid var(--border);
                  font-size:11px;color:var(--tx3);font-style:italic">
        Las 4 deben converger simultáneamente para producir rizomorfismo.
        El gradiente (N0) da dirección al sistema completo.
      </div>
    </div>
  `;

  // Insertarlo como primer hijo del panel biblioteca (antes del card existente)
  panel.insertBefore(card, panel.firstChild);
}

/** Importa ingredientes desde un JSON exportado previamente.
 *  Lógica: valida el array completo antes de escribir nada (todo o nada).
 *  Por cada item: pisa/crea en bl2_ings preservando metadata en ing.bio.
 *  bl2_lab_meta queda legacy y no se escribe. */
function clabImportIngredientes(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    let data;
    // 1. Parsear y validar estructura
    try {
      data = JSON.parse(e.target.result);
    } catch (err) {
      notif('❌ El archivo no es JSON válido', 'danger');
      return;
    }
    if (!Array.isArray(data) || !data.length) {
      notif('❌ El archivo debe ser un array con al menos un ingrediente', 'danger');
      return;
    }
    const invalidos = data.filter(item => !item || typeof item !== 'object' || !item.id);
    if (invalidos.length) {
      notif(`❌ ${invalidos.length} entradas sin id — abortado`, 'danger');
      return;
    }

    // 2. Construir los nuevos estados en memoria (sin tocar LS todavía)
    const ingsCurrent = gArr(K.ings);

    const ingsMap = {};
    ingsCurrent.forEach(i => { ingsMap[i.id] = i; });

    let creados = 0, actualizados = 0;
    data.forEach(item => {
      const { id, bio, ...rest } = item;
      const prev = ingsMap[id] || {};
      const base = {
        id,
        nombre:  rest.nombre  ?? prev.nombre  ?? '',
        unidad:  rest.unidad  ?? prev.unidad  ?? '',
        aspecto: rest.aspecto ?? prev.aspecto ?? '',
        pc:      rest.pc      ?? prev.pc      ?? null,
        pn:      rest.pn      ?? prev.pn      ?? null,
        notas:   rest.notas   ?? prev.notas   ?? '',
      };
      if (ingsMap[id]) { actualizados++; } else { creados++; }
      ingsMap[id] = Object.assign({}, prev, base);
      if (bio && typeof bio === 'object') {
        ingsMap[id].bio = Object.assign({}, prev.bio || {}, bio, { updatedAt: bio.updatedAt || now() });
      }
    });

    const ingsNew = Object.values(ingsMap);

    // 3. Escribir — snapshot + rollback ante cualquier fallo
    const snapIngs = localStorage.getItem(K.ings);
    try {
      if (!s(K.ings, ingsNew)) throw new Error('No se pudo escribir bl2_ings');
    } catch (err) {
      // Rollback
      try {
        if (snapIngs !== null) localStorage.setItem(K.ings, snapIngs);
        else localStorage.removeItem(K.ings);
      } catch (_) { /* nada que hacer */ }
      notif(`❌ Error al escribir (¿cuota LS?): ${err.message} — rollback aplicado`, 'danger');
      return;
    }

    // 4. Refrescar UI
    renderBiblio();
    renderAnalyzer();
    updateHeaderStats();
    _dispatchIngsChanged({ tipo: 'importado', count: data.length });

    const partes = [];
    if (creados)     partes.push(`${creados} creados`);
    if (actualizados) partes.push(`${actualizados} actualizados`);
    notif(`✅ Importados: ${partes.join(', ')} (${data.length} total)`, 'ok');
  };
  reader.readAsText(file);
}

/** Abre el selector de archivo oculto para importar JSON. */
function clabTriggerImport() {
  const inp = document.getElementById('clab-import-file-input');
  if (inp) { inp.value = ''; inp.click(); }
}

/** Handler del input file hidden — llamado por onchange inline. */
function clabOnImportFileChange(input) {
  if (input.files && input.files[0]) clabImportIngredientes(input.files[0]);
}

/** Exporta todos los ingredientes de bl2_ings mergeados con su metadata
 *  biológica de bl2_lab_meta como un JSON descargable. */
function clabExportIngredientes() {
  const ings = readIngredientes();
  const meta = loadMeta();
  const merged = ings.map(i => {
    const m = meta[i.id];
    return m ? Object.assign({}, i, { bio: m }) : Object.assign({}, i, { bio: null });
  });
  const fecha = new Date().toISOString().slice(0, 10);
  const filename = `biolab_ingredientes_export_${fecha}.json`;
  const blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  notif(`💾 Exportado: ${filename} (${merged.length} ingredientes)`, 'ok');
}

function clabToggleGlosario() {
  const body = document.getElementById('clab-glosario-body');
  const chev = document.getElementById('clab-glosario-chev');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? 'rotate(0)' : 'rotate(180deg)';
}

function renderBiblio() {
  _renderGlosarioRutas();
  const grid = document.getElementById('clab-lib-grid');
  if (!grid) return;
  const ings = readIngredientes();
  const meta = loadMeta();
  const obs = gArr(K.obs);
  const obsByIng = {};
  obs.forEach(o => { obsByIng[o.ingId] = (obsByIng[o.ingId] || 0) + 1; });

  const fEstado = (document.getElementById('clab-lib-filter-estado')?.value || '').trim();
  const fQ = (document.getElementById('clab-lib-filter-q')?.value || '').trim().toLowerCase();
  const fSort = (document.getElementById('clab-lib-sort')?.value || 'nombre_az').trim();

  const ESTADO_ORD = { validado: 0, en_ensayo: 1, sin_datos: 2, peligro: 3 };

  const items = ings.filter(i => {
    const m = meta[i.id];
    const e = m?.estado || 'sin_datos';
    if (fEstado && e !== fEstado) return false;
    if (fQ && !i.nombre.toLowerCase().includes(fQ)) return false;
    return true;
  }).sort((a, b) => {
    switch (fSort) {
      case 'nombre_za': return (b.nombre || '').localeCompare(a.nombre || '', 'es');
      case 'aspecto':   return (a.aspecto || '').localeCompare(b.aspecto || '', 'es') || (a.nombre || '').localeCompare(b.nombre || '', 'es');
      case 'estado': {
        const ea = ESTADO_ORD[meta[a.id]?.estado] ?? 2;
        const eb = ESTADO_ORD[meta[b.id]?.estado] ?? 2;
        return ea - eb || (a.nombre || '').localeCompare(b.nombre || '', 'es');
      }
      case 'ensayos':   return (obsByIng[b.id] || 0) - (obsByIng[a.id] || 0);
      default:          return (a.nombre || '').localeCompare(b.nombre || '', 'es'); // nombre_az
    }
  });

  const cnt = document.getElementById('clab-lib-count');
  if (cnt) cnt.textContent = `${items.length} de ${ings.length} ingredientes`;

  if (!items.length) {
    grid.innerHTML = `<div class="clab-empty" style="grid-column:1/-1">Sin coincidencias.</div>`;
    return;
  }

  grid.innerHTML = items.map(i => {
    const m = meta[i.id];
    const e = m?.estado || 'sin_datos';
    const badgeKind = e === 'sin_datos' ? 'sindata' : e === 'en_ensayo' ? 'ensayo' : e;
    const aspColor = ASP_COLORS[i.aspecto] || '#666';
    const optTxt = m?.rangoOptimo ? `${m.rangoOptimo.min}–${m.rangoOptimo.max} ${esc(i.unidad || '')}` : '—';
    // Rutas: si hay override manual (m.rutas es array, incluso vacío) usarlo como verdad.
    // Si no existe (undefined) → fallback a regex automático por nombre.
    let usedRoutes;
    if (Array.isArray(m?.rutas)) {
      usedRoutes = ROUTES.filter(r => m.rutas.includes(r.id));
    } else {
      usedRoutes = ROUTES.filter(r => !r.isOutput && r.activators?.some(a => a.name && a.name.test(i.nombre || '')));
    }
    const routeTags = usedRoutes.slice(0, 3).map(r =>
      `<span class="clab-badge" style="background:${r.color}1A;color:${r.color};border-color:${r.color}66;font-size:9px;padding:1px 6px">${esc(r.short)}</span>`
    ).join(' ');
    const isDisabled = !!m?.disabled;
    return `<div class="clab-lib-card${isDisabled ? ' clab-lib-card--disabled' : ''}"
        onclick="clabToggleIngDisabled('${esc(i.id)}', event)"
        ondblclick="clabOpenIngDetail('${esc(i.id)}')"
        title="${isDisabled ? 'Click para habilitar' : 'Click para deshabilitar / doble click para editar'}">
      <div class="clab-lib-card-top">
        <div class="clab-lib-card-name">${esc(i.nombre)}</div>
        <span class="clab-badge clab-badge-${badgeKind}">${e.replace('_', ' ')}</span>
      </div>
      ${isDisabled
        ? `<div class="clab-lib-disabled-banner">⛔ Deshabilitado — no aparecerá en sugerencias</div>`
        : ''}
      <div class="clab-lib-card-asp" style="color:${isDisabled ? 'var(--tx3)' : aspColor}">${esc(i.aspecto || '—')}</div>
      ${routeTags && !isDisabled ? `<div style="margin-bottom:6px">${routeTags}</div>` : ''}
      <div class="clab-lib-card-range">${esc(optTxt)}</div>
      <div class="clab-lib-card-footer">
        <span>${obsByIng[i.id] || 0} ensayo${(obsByIng[i.id] || 0) === 1 ? '' : 's'}</span>
        ${m?.seeded ? '<span class="clab-badge clab-badge-seeded">seed</span>' : ''}
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════
// GENÉTICA × MEDIO — sección 3
// ════════════════════════════════════════════
let _strainChart = null;

function _populateStrainSelectors() {
  const ingSel = document.getElementById('clab-strain-ing');
  const genSel = document.getElementById('clab-strain-gen');
  if (!ingSel || !genSel) return;

  const ings = readIngredientes();
  const meta = loadMeta();
  const ingsWithMeta = ings.filter(i => meta[i.id]);
  const ingsToShow = ingsWithMeta.length ? ingsWithMeta : ings;

  const prevIng = ingSel.value;
  ingSel.innerHTML = ingsToShow.map(i =>
    `<option value="${esc(i.id)}">${esc(i.nombre)}</option>`).join('');
  if (prevIng && ingsToShow.find(i => i.id === prevIng)) ingSel.value = prevIng;
  else if (ingsToShow.length) ingSel.value = ingsToShow[0].id;

  const gens = readGenetics();
  const prevGen = genSel.value;
  genSel.innerHTML = '<option value="__ALL__">Todas las cepas (comparativa)</option>' +
    gens.map(g => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
  if (prevGen && (prevGen === '__ALL__' || gens.find(g => g.id === prevGen))) genSel.value = prevGen;
}

function renderStrain() {
  _populateStrainSelectors();
  const ingId = document.getElementById('clab-strain-ing')?.value;
  const genId = document.getElementById('clab-strain-gen')?.value;
  if (!ingId) {
    document.getElementById('clab-strain-content').style.display = 'none';
    return;
  }
  document.getElementById('clab-strain-content').style.display = '';

  const allObs = gArr(K.obs).filter(o => o.ingId === ingId);
  const empty = document.getElementById('clab-strain-empty');
  const sugBox = document.getElementById('clab-strain-suggestion');
  const vsGrid = document.getElementById('clab-strain-vs-grid');

  if (genId === '__ALL__') {
    // Vista comparativa: bar chart con n por bucket de qty agrupado por genética
    const byGen = {};
    allObs.forEach(o => {
      if (!o.geneticaId) return;
      if (!byGen[o.geneticaId]) byGen[o.geneticaId] = { label: o.geneticaLabel, obs: [] };
      byGen[o.geneticaId].obs.push(o);
    });
    const entries = Object.entries(byGen);
    if (!entries.length) {
      empty.style.display = '';
      sugBox.innerHTML = '';
      vsGrid.innerHTML = '';
      _destroyStrainChart();
      return;
    }
    empty.style.display = 'none';
    sugBox.innerHTML = '';

    // Side-by-side
    vsGrid.innerHTML = entries.map(([gid, d]) => {
      const sug = suggestRangeFromObs(d.obs);
      return `<div class="clab-strain-vs-card">
        <div class="clab-strain-vs-name">${esc(d.label || gid)}</div>
        <div class="clab-strain-vs-range">${sug ? `${sug.min} – ${sug.max}` : '—'}</div>
        <div class="clab-strain-vs-meta">n = ${d.obs.length} ${sug ? '· rango óptimo sugerido' : '· insuficiente'}</div>
        ${sug ? `<button class="clab-btn clab-btn-wn clab-btn-sm" style="margin-top:6px;width:100%"
                  onclick="clabApplyStrainRange('${esc(gid)}','${esc(ingId)}',${sug.min},${sug.max})">↗ Aplicar a esta cepa</button>` : ''}
      </div>`;
    }).join('');

    // Chart: cantidad promedio por cepa, color según fenotipo dominante
    const labels = entries.map(([, d]) => d.label || '?');
    const data = entries.map(([, d]) => {
      const positives = d.obs.filter(o => o.fenotipo === 'rizo' || o.fenotipo === 'rizo_extremo' || o.resultado === 'positivo');
      if (!positives.length) return 0;
      return positives.reduce((s, o) => s + o.qty, 0) / positives.length;
    });
    _renderStrainChart(labels, data, 'Cantidad media de ensayos positivos');
    return;
  }

  // Genética específica
  const genObs = genId ? allObs.filter(o => o.geneticaId === genId) : allObs.filter(o => !o.geneticaId);
  if (!genObs.length) {
    empty.style.display = '';
    sugBox.innerHTML = '';
    vsGrid.innerHTML = '';
    _destroyStrainChart();
    return;
  }
  empty.style.display = 'none';

  // Histograma por bucket de qty + color por fenotipo
  const phenoOrder = ['contam', 'tomentoso', 'normal', 'rizo', 'rizo_extremo'];
  const phenoColors = {
    rizo_extremo: '#00CC33', rizo: '#70AD47', normal: '#A0A0A0',
    tomentoso: '#FFC000',    contam: '#C00000',
  };
  const datasets = phenoOrder.map(p => ({
    label: _phenoLabel(p),
    backgroundColor: phenoColors[p],
    data: genObs.filter(o => o.fenotipo === p).map(o => ({ x: o.qty, y: 1 + Math.random() * 0.6 })),
  })).filter(ds => ds.data.length);

  _renderStrainScatter(datasets);

  // Sugerencia
  const sug = suggestRangeFromObs(genObs);
  if (sug) {
    sugBox.innerHTML = `<div class="clab-strain-suggested">
      <div class="clab-strain-suggested-label">
        <b>Rango óptimo sugerido:</b> ${sug.min} – ${sug.max}<br>
        <span style="color:var(--tx3)">basado en ${sug.n} observación${sug.n > 1 ? 'es' : ''} positiva${sug.n > 1 ? 's' : ''}</span>
      </div>
      <button class="clab-btn clab-btn-wn clab-btn-sm" onclick="clabApplyStrainRange('${esc(genId)}','${esc(ingId)}',${sug.min},${sug.max})">
        ↗ Aplicar a esta cepa
      </button>
    </div>`;
  } else {
    sugBox.innerHTML = `<div class="clab-help" style="margin-top:10px">Necesitás al menos 3 observaciones positivas para una sugerencia automática.</div>`;
  }
  vsGrid.innerHTML = '';
}

function _destroyStrainChart() {
  if (_strainChart) {
    try { _strainChart.destroy(); } catch (e) {}
    _strainChart = null;
  }
}

function _renderStrainChart(labels, data, title) {
  _destroyStrainChart();
  const cv = document.getElementById('clab-strain-chart');
  if (!cv || !window.Chart) return;
  _strainChart = new window.Chart(cv, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: title,
        data,
        backgroundColor: '#7C6FFF',
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#A0A0A0' } },
      },
      scales: {
        x: { ticks: { color: '#A0A0A0' }, grid: { color: '#333' } },
        y: { ticks: { color: '#A0A0A0' }, grid: { color: '#333' }, beginAtZero: true },
      },
    },
  });
}

function _renderStrainScatter(datasets) {
  _destroyStrainChart();
  const cv = document.getElementById('clab-strain-chart');
  if (!cv || !window.Chart) return;
  _strainChart = new window.Chart(cv, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#A0A0A0', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#A0A0A0' }, grid: { color: '#333' }, title: { display: true, text: 'Cantidad', color: '#A0A0A0' } },
        y: { ticks: { color: 'transparent' }, grid: { color: '#222' }, beginAtZero: true, max: 2 },
      },
    },
  });
}

function clabApplyStrainRange(geneticaId, ingId, min, max) {
  const arr = gArr(K.strainRng);
  const existing = arr.findIndex(x => x.geneticaId === geneticaId && x.ingId === ingId);
  const obj = {
    id: existing >= 0 ? arr[existing].id : nxtId('SR', arr),
    geneticaId, ingId, min, max,
    source: 'aplicado',
    updatedAt: now(),
  };
  if (existing >= 0) arr[existing] = obj;
  else arr.push(obj);
  s(K.strainRng, arr);
  notif(`Rango aplicado: ${min}–${max}`, 'ok');
  renderStrain();
  renderAnalyzer();
}

// ════════════════════════════════════════════
// ENSAYOS — sección 4
// ════════════════════════════════════════════
function renderEnsayos() {
  // Inicializar fecha de hoy si está vacía
  const fechaEl = document.getElementById('clab-obs-fecha');
  if (fechaEl && !fechaEl.value) {
    const d = new Date();
    fechaEl.value = d.toISOString().slice(0, 10);
  }
  // Selectores
  _populateObsSelectors();
  renderObsLog();
}

function _populateObsSelectors() {
  const ings = readIngredientes();
  const ingSel = document.getElementById('clab-obs-ing');
  if (ingSel) {
    const prev = ingSel.value;
    ingSel.innerHTML = '<option value="">— Seleccionar —</option>' +
      ings.map(i => `<option value="${esc(i.id)}" data-unidad="${esc(i.unidad || '')}">${esc(i.nombre)} (${esc(i.unidad || '')})</option>`).join('');
    if (prev && ings.find(i => i.id === prev)) ingSel.value = prev;
    ingSel.onchange = () => {
      const opt = ingSel.options[ingSel.selectedIndex];
      const u = opt?.dataset?.unidad || '';
      const uEl = document.getElementById('clab-obs-unidad');
      if (uEl) uEl.textContent = u;
    };
    ingSel.dispatchEvent(new Event('change'));
  }

  const gens = readGenetics();
  const genSel = document.getElementById('clab-obs-gen');
  if (genSel) {
    const prev = genSel.value;
    genSel.innerHTML = '<option value="">— Sin vincular —</option>' +
      gens.map(g => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
    if (prev) genSel.value = prev;
  }

  const formSel = document.getElementById('clab-obs-formula');
  if (formSel) {
    const forms = readForms();
    const prev = formSel.value;
    formSel.innerHTML = '<option value="">— Sin vincular —</option>' +
      forms.map(f => `<option value="${esc(f.id)}">${esc(f.id)} · ${esc(f.nombre || '')}</option>`).join('');
    if (prev) formSel.value = prev;
  }
  clabOnObsFormulaChange();

  // Filtros
  const fIng = document.getElementById('clab-obs-filter-ing');
  if (fIng) {
    const prev = fIng.value;
    fIng.innerHTML = '<option value="">Ingrediente: todos</option>' +
      ings.map(i => `<option value="${esc(i.id)}">${esc(i.nombre)}</option>`).join('');
    if (prev) fIng.value = prev;
  }
  const fGen = document.getElementById('clab-obs-filter-gen');
  if (fGen) {
    const prev = fGen.value;
    fGen.innerHTML = '<option value="">Genética: todas</option>' +
      gens.map(g => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
    if (prev) fGen.value = prev;
  }
}

function clabOnObsFormulaChange() {
  const formSel = document.getElementById('clab-obs-formula');
  const expSel = document.getElementById('clab-obs-exp');
  if (!formSel || !expSel) return;
  const fid = formSel.value;
  const exps = fid ? readExperimentos().filter(e => e.formulaId === fid) : [];
  expSel.innerHTML = '<option value="">— Sin vincular —</option>' +
    exps.map(e => `<option value="${esc(e.id)}">${esc(e.id)} · ${esc(e.nombre)}</option>`).join('');
}

function clabSaveObs() {
  const fecha = document.getElementById('clab-obs-fecha').value;
  const ingId = document.getElementById('clab-obs-ing').value;
  const qty   = parseFloat(document.getElementById('clab-obs-qty').value);
  const genSel = document.getElementById('clab-obs-gen');
  const geneticaId = genSel.value || '';
  const geneticaLabel = genSel.options[genSel.selectedIndex]?.text || '';
  const fenotipo = document.getElementById('clab-obs-pheno').value;
  const resultado = document.getElementById('clab-obs-res').value;
  const formulaId = document.getElementById('clab-obs-formula').value;
  const expIdVinculado = document.getElementById('clab-obs-exp').value;
  const notas = document.getElementById('clab-obs-notas').value.trim();

  if (!fecha) return notif('Fecha requerida', 'err');
  if (!ingId) return notif('Seleccioná un ingrediente', 'err');
  if (isNaN(qty) || qty < 0) return notif('Cantidad inválida', 'err');

  const all = gArr(K.obs);
  const obj = {
    id: nxtId('OBS', all), fecha, ingId, qty,
    geneticaId: geneticaId || null,
    geneticaLabel: geneticaId ? geneticaLabel : '',
    fenotipo, resultado,
    formulaId: formulaId || null,
    expIdVinculado: expIdVinculado || null,
    notas,
    createdAt: now(),
  };
  all.push(obj);
  s(K.obs, all);
  notif(`✓ Observación ${obj.id} guardada`, 'ok');
  clabClearObsForm();
  updateHeaderStats();
  renderObsLog();
}

function clabClearObsForm() {
  document.getElementById('clab-obs-qty').value = '';
  document.getElementById('clab-obs-pheno').value = 'normal';
  document.getElementById('clab-obs-res').value = 'neutral';
  document.getElementById('clab-obs-notas').value = '';
}

function _phenoLabel(p) {
  return ({ rizo_extremo: 'Rizo extremo', rizo: 'Rizomórfico', normal: 'Normal',
            tomentoso: 'Tomentoso', contam: 'Contaminado' })[p] || p;
}
function _phenoClass(p) {
  return ({ rizo_extremo: 'rizo-extremo', rizo: 'rizo', normal: 'normal',
            tomentoso: 'tomentoso', contam: 'contam' })[p] || 'normal';
}

function renderObsLog() {
  const log = document.getElementById('clab-obs-log');
  if (!log) return;
  let obs = gArr(K.obs);
  const fIng = document.getElementById('clab-obs-filter-ing')?.value;
  const fGen = document.getElementById('clab-obs-filter-gen')?.value;
  const fPh  = document.getElementById('clab-obs-filter-pheno')?.value;
  if (fIng) obs = obs.filter(o => o.ingId === fIng);
  if (fGen) obs = obs.filter(o => o.geneticaId === fGen);
  if (fPh)  obs = obs.filter(o => o.fenotipo === fPh);
  obs = obs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  const cnt = document.getElementById('clab-obs-count');
  if (cnt) cnt.textContent = `${obs.length} ensayo${obs.length === 1 ? '' : 's'}`;

  if (!obs.length) {
    log.innerHTML = `<div class="clab-empty">Sin observaciones registradas.</div>`;
    return;
  }
  const ings = readIngredientes();
  log.innerHTML = obs.map(o => {
    const ing = ings.find(i => i.id === o.ingId);
    const nombre = ing?.nombre || o.ingId;
    const unidad = ing?.unidad || '';
    const phenoCls = `clab-pheno-pill ${_phenoClass(o.fenotipo)}`;
    const resCls = o.resultado === 'positivo' ? 'res-pos' : o.resultado === 'negativo' ? 'res-neg' : 'res-neu';
    return `<div class="clab-obs-grid">
      <div class="clab-mono clab-muted">${esc(o.id)}</div>
      <div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b>${esc(nombre)}</b>
          <span class="clab-mono clab-c-ac2">${(+o.qty).toFixed(2)} ${esc(unidad)}</span>
          <span class="${phenoCls}">${esc(_phenoLabel(o.fenotipo))}</span>
          <span class="${resCls}">${o.resultado === 'positivo' ? '+' : o.resultado === 'negativo' ? '−' : '·'} ${o.resultado}</span>
          <span class="clab-obs-meta">${esc(fmtDate(o.fecha))}</span>
        </div>
        <div class="clab-obs-meta" style="margin-top:4px">
          ${o.geneticaLabel ? `🧬 ${esc(o.geneticaLabel)}` : '<span class="clab-muted">sin genética</span>'}
          ${o.formulaId ? ` · 🧪 ${esc(o.formulaId)}` : ''}
          ${o.expIdVinculado ? ` · 🔬 ${esc(o.expIdVinculado)}` : ''}
        </div>
        ${o.notas ? `<div style="margin-top:4px;font-size:12px;color:var(--tx2);font-style:italic">${esc(o.notas)}</div>` : ''}
      </div>
      <div></div>
      <div style="text-align:right">
        <button class="clab-btn clab-btn-d clab-btn-sm" onclick="clabDeleteObs('${esc(o.id)}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function clabDeleteObs(id) {
  if (!confirm(`¿Eliminar observación ${id}?`)) return;
  const arr = gArr(K.obs).filter(o => o.id !== id);
  s(K.obs, arr);
  notif('Observación eliminada', 'ok');
  updateHeaderStats();
  renderObsLog();
}

// ════════════════════════════════════════════
// MOTOR DE OPTIMIZACIÓN — ⚡ OPTIMIZAR
// ════════════════════════════════════════════

/**
 * Computa niveles detallados de cada ruta para una lista de ingredientes.
 * qty en unidades nativas del ingrediente (idéntico a calcEstadoRutas).
 * Retorna { [routeId]: { level, claimed, contributors: [{ingId, qty, unidad, pct, scale, opt}] } }
 */
function _optComputeRouteLevels(ingRows, allMeta) {
  const routeData = {};
  ingRows.forEach(fi => {
    const m = allMeta[fi.id];
    if (!m?.contribuciones || typeof m.contribuciones !== 'object') return;
    const qty = fi.qty || 0;
    // Mismo contrato de escala que calcEstadoRutas (Fix Bug 2): usar classifyQty
    const _qst = classifyQty(qty, m);
    let scale;
    if (_qst === 'LIMITADA') {
      const _opt = m.rangoOptimo;
      scale = _opt?.min > 0 ? Math.min(0.90, qty / _opt.min) : 0.45;
    } else {
      scale = { ACTIVA: 1.00, EXCESO: 0.55, EXCESO_CRIT: 0.10, SIN_DATOS: 0.50 }[_qst] ?? 0.0;
    }
    Object.entries(m.contribuciones).forEach(([routeId, pct]) => {
      if (typeof pct !== 'number' || pct <= 0) return;
      if (!routeData[routeId]) routeData[routeId] = { level: 0, claimed: true, contributors: [] };
      routeData[routeId].contributors.push({
        ingId: fi.id, qty, unidad: fi.unidad || 'gr', pct, scale, opt: m.rangoOptimo || null,
      });
      routeData[routeId].level += pct * scale;
    });
  });
  // Normalizar por máximo posible de la biblioteca — mismo Fix A de calcEstadoRutas
  const _rmp = {};
  Object.values(allMeta).forEach(m => {
    if (!m?.contribuciones) return;
    Object.entries(m.contribuciones).forEach(([rId, pct]) => {
      if (typeof pct === 'number' && pct > 0)
        _rmp[rId] = (_rmp[rId] || 0) + pct;
    });
  });
  Object.keys(routeData).forEach(r => {
    // Mismo invariante que calcEstadoRutas: cap denominador a 100
    const maxRaw = _rmp[r] || 100;
    const denom  = Math.min(maxRaw, 100);
    routeData[r].level = Math.min(100, (routeData[r].level / denom) * 100);
  });
  return routeData;
}

/**
 * Diagnostica gaps: rutas con level < 75.
 * Retorna array ordenado por (peso × déficit) desc.
 */
function _optDiagnoseGaps(routeLevels) {
  return ROUTES.filter(r => !r.isOutput)
    .map(route => {
      const rd = routeLevels[route.id];
      const level = Math.min(100, rd?.level || 0);
      return {
        routeId: route.id, routeName: route.short, routeWeight: route.weight,
        level, deficit: Math.max(0, 75 - level),
        contributors: rd?.contributors || [], claimed: rd?.claimed || false,
      };
    })
    .filter(g => g.deficit > 0.01)
    .sort((a, b) => (b.deficit * b.routeWeight) - (a.deficit * a.routeWeight));
}

/**
 * Encuentra el mejor activador de biblioteca no en existingIngIds para routeId.
 * Criterio: mayor pct de contribución a la ruta, con rangoOptimo definido.
 *
 * @param {string}  routeId
 * @param {Set}     existingIngIds
 * @param {Array}   allIngs
 * @param {Object}  allMeta
 * @param {Object}  [opts]
 * @param {string}  [opts.preferIngId]   — intentar este primero si contribuye a la ruta
 * @param {Set}     [opts.avoidIngIds]   — excluir estos IDs de la búsqueda
 * @returns {{ ingId, ing, pct, opt, unidad, meta } | null}
 */
function _optBestActivatorForRoute(routeId, existingIngIds, allIngs, allMeta, opts = {}) {
  const avoidSet = opts.avoidIngIds instanceof Set ? opts.avoidIngIds : new Set(opts.avoidIngIds || []);

  // Verificar si el preferido aplica antes de buscar genéricamente
  if (opts.preferIngId && !existingIngIds.has(opts.preferIngId) && !avoidSet.has(opts.preferIngId)) {
    const prefIng  = allIngs.find(x => x.id === opts.preferIngId);
    const prefMeta = allMeta[opts.preferIngId];
    if (prefIng && (prefMeta?.contribuciones?.[routeId] || 0) > 0 && prefMeta?.rangoOptimo?.min) {
      const pct = prefMeta.contribuciones[routeId];
      return { ingId: opts.preferIngId, ing: prefIng, pct, opt: prefMeta.rangoOptimo, unidad: prefIng.unidad || 'gr', meta: prefMeta };
    }
  }

  let best = null;
  allIngs.forEach(ing => {
    if (existingIngIds.has(ing.id)) return;
    if (avoidSet.has(ing.id)) return;
    const m = allMeta[ing.id];
    if (!m?.contribuciones) return;
    const pct = m.contribuciones[routeId];
    if (!(pct > 0)) return;
    if (!m.rangoOptimo?.min) return;
    if (!best || pct > best.pct) {
      best = { ingId: ing.id, ing, pct, opt: m.rangoOptimo, unidad: ing.unidad || 'gr', meta: m };
    }
  });
  return best;
}

/**
 * Predice el fenotipo esperado a partir de los niveles de rutas proyectados.
 *
 * Lógica jerárquica:
 *  TOMENTOSO    → N1 < 40 Y N2 < 40 (sin energía ni señal)
 *  GRUESO       → N3 ≥ 68 Y N2 ≥ 65 Y N1 ≥ 55 (síntesis pared + señal sostenida)
 *  FINO_RAPIDO  → N1 ≥ 68 Y N2 ≥ 68 con N3 < 65 (máx energía, mín pared)
 *  PARCIAL      → resto
 *
 * @param {Object} routeLevels — resultado de _optComputeRouteLevels
 * @param {string|null} scenarioId — 'A' | 'B' | 'C' | null
 *   scenarioId es la fuente de verdad sobre la intención fenotípica del escenario.
 *   En zona ambigua y conflictos, tiene prioridad sobre citActiva:
 *     'B' → siempre GRUESO (estrategia: modulación NO sostenida + quitina)
 *     'C' → siempre FINO_RAPIDO (estrategia: burst NO pico vía Arginina pura)
 *     null/'A' → discriminación por citActiva como fallback
 * @returns {{ type: string, label: string, desc: string }}
 */
function _optPredictPhenotype(routeLevels, scenarioId) {
  const lvl  = (r) => Math.min(100, routeLevels[r]?.level || 0);
  const n3avg = (lvl('N3_SAM') + lvl('N3_CHITIN') + lvl('N3_SPITZ')) / 3;
  const n2avg = (lvl('N2_ODC') + lvl('N2_NO_PKG')) / 2;
  const n1avg = (lvl('N1_GLYC') + lvl('N1_ETC')) / 2;

  // Citrulina activa: contribuye con qty > 0 en N2_NO_PKG
  // Nota: usado solo como fallback cuando scenarioId es null o 'A'
  const citActiva = (routeLevels['N2_NO_PKG']?.contributors || [])
    .some(c => c.ingId === 'ING-0017' && (c.qty || 0) > 0);

  // Resolución de intención fenotípica: scenarioId como fuente de verdad
  // 'B' → GRUESO siempre; 'C' → FINO_RAPIDO siempre; null/'A' → depende de métricas
  function resolveAmbiguous() {
    if (scenarioId === 'B') {
      return {
        type: 'GRUESO',
        label: '🍄 Rizomorfismo grueso',
        desc: 'Estrategia B: modulación NO sostenida + quitina maximizada. Colonización estructural y robusta.',
      };
    }
    if (scenarioId === 'C') {
      return {
        type: 'FINO_RAPIDO',
        label: '⚡ Rizomorfismo fino rápido',
        desc: 'Estrategia C: burst NO pico vía Arginina pura. Hifas delgadas y veloces. Colonización rápida.',
      };
    }
    // Fallback para escenario A o llamadas sin contexto
    return {
      type: citActiva ? 'GRUESO' : 'FINO_RAPIDO',
      label: citActiva ? '🍄 Rizomorfismo grueso' : '⚡ Rizomorfismo fino rápido',
      desc: citActiva
        ? 'Citrulina activa → modulación NO sostenida. Colonización estructural.'
        : 'Energía y señal equilibradas. Colonización moderada sin inversión estructural máxima.',
    };
  }

  if (n1avg < 40 && n2avg < 40) {
    return {
      type: 'TOMENTOSO',
      label: '🔴 Riesgo tomentoso',
      desc: 'Energía y señal insuficientes. Alta probabilidad de fenotipo tomentoso o colonización abortada.',
    };
  }
  if (n3avg >= 68 && n2avg >= 65 && n1avg >= 55) {
    // Zona GRUESO por métricas — pero C siempre prioriza FINO_RAPIDO
    if (scenarioId === 'C') {
      return {
        type: 'FINO_RAPIDO',
        label: '⚡ Rizomorfismo fino rápido',
        desc: 'Estrategia C: burst NO pico vía Arginina pura. Colonización rápida — N3 elevado pero no determinante.',
      };
    }
    return {
      type: 'GRUESO',
      label: '🍄 Rizomorfismo grueso',
      desc: citActiva
        ? 'Citrulina activa → modulación NO sostenida. Hifas densas con alta síntesis de quitina y SPITZ. Colonización estructural y robusta.'
        : 'N3 maximizado. Hifas densas con alta síntesis de quitina y SPITZ. Colonización estructural.',
    };
  }
  if (n1avg >= 68 && n2avg >= 68 && n3avg < 65) {
    // Zona FINO_RAPIDO por métricas — B no tiene sentido aquí; respetamos el número
    return {
      type: 'FINO_RAPIDO',
      label: '⚡ Rizomorfismo fino rápido',
      desc: 'Máximo ATP + burst NO pico vía Arginina. Hifas delgadas y veloces. Colonización rápida con menor biomasa estructural.',
    };
  }
  if (n1avg >= 55 && n2avg >= 55 && n3avg >= 55) {
    // Zona ambigua — scenarioId es la fuente de verdad
    return resolveAmbiguous();
  }
  return {
    type: 'PARCIAL',
    label: '◑ Activación parcial',
    desc: 'Cobertura metabólica incompleta. Resultado fenotípico variable según condiciones del sustrato.',
  };
}

// ── Tabla declarativa de constraints del optimizador ─────────────────────────
// Cada regla es evaluada por _optApplyConstraints después de los pasos 1-3.
// Extensible: agregar nuevas reglas sin tocar el motor.
//
// campos:
//   id         → identificador único
//   tipo       → 'reemplazo' | 'companion'
//   condicion  → fn(getQty) → bool : cuándo aplica la regla
//   remover    → [ingId, ...] : ingredientes a dejar en qty=0
//   agregar    → [ingId, ...] : ingredientes a agregar al rangoOptimo.min
//   descripcion → texto para el diff de la UI
//   razon       → fundamentación biológica
// ─────────────────────────────────────────────────────────────────────────────
const OPTIMIZER_CONSTRAINTS = [
  {
    id:   'PREC_CA_PO4_REPLACE',
    tipo: 'reemplazo',
    condicion: (getQty) => getQty('ING-0010') > 0 && getQty('ING-0007') > 0,
    remover:  ['ING-0010'],
    agregar:  ['ING-0020'],
    descripcion: 'Carbonato de calcio → Cloruro de calcio',
    razon: 'CaCO₃ precipita cuantitativamente con KH₂PO₄ — Ca²⁺ libre ≈ 0 durante la preparación del agar.',
  },
  {
    id:   'METIONINA_REQUIERE_GLICINA',
    tipo: 'companion',
    condicion: (getQty) => getQty('ING-0019') > 0 && getQty('ING-0025') <= 0,
    remover:  [],
    agregar:  ['ING-0025'],
    descripcion: 'Glicina (Glicocola) requerida junto a L-Metionina',
    razon: 'Recicla homocisteína vía ciclo de folatos — su ausencia inhibe quitina sintetasa → N3_CHITIN comprometida.',
  },
];

/**
 * Aplica OPTIMIZER_CONSTRAINTS sobre la proyección en construcción.
 * Opera directamente sobre qtyMap y addedMap — sin efecto colateral en ingRows.
 *
 * @param {Object} qtyMap        — qty mutable de ingredientes originales
 * @param {Object} addedMap      — ingredientes nuevos { ingId: {qty, unidad, meta, ing} }
 * @param {Object} unidadMap     — unidades inmutables de los originales
 * @param {Set}    existingIngIds— IDs ya presentes (originales + agregados)
 * @param {Array}  allIngs       — biblioteca completa
 * @param {Object} allMeta       — metadata completa
 * @returns {Array} restricciones resueltas [{id, tipo, descripcion, razon}]
 */
function _optApplyConstraints(qtyMap, addedMap, unidadMap, existingIngIds, allIngs, allMeta) {
  const resolved = [];

  function getQty(ingId) {
    if (qtyMap[ingId] !== undefined) return qtyMap[ingId];
    if (addedMap[ingId]) return addedMap[ingId].qty;
    return 0;
  }

  OPTIMIZER_CONSTRAINTS.forEach(rule => {
    if (!rule.condicion(getQty)) return;

    // Remover ingredientes conflictivos
    rule.remover.forEach(ingId => {
      if (qtyMap[ingId] !== undefined) qtyMap[ingId] = 0;
      if (addedMap[ingId]) delete addedMap[ingId];
    });

    // Agregar ingredientes requeridos (si no están ya presentes)
    let added = false;
    rule.agregar.forEach(ingId => {
      if (getQty(ingId) > 0) return; // ya presente — skip
      const live = allIngs.find(x => x.id === ingId);
      const m    = allMeta[ingId];
      if (!live || !m?.rangoOptimo?.min) return;
      addedMap[ingId] = { qty: m.rangoOptimo.min, unidad: live.unidad || 'gr', meta: m, ing: live };
      existingIngIds.add(ingId);
      added = true;
    });

    resolved.push({ id: rule.id, tipo: rule.tipo, descripcion: rule.descripcion, razon: rule.razon });
  });

  return resolved;
}

/**
 * Construye un escenario de optimización con estrategia metabólica diferenciada.
 *
 * Flujo de pasos:
 *   0. Reducir excesos — EXCESO_CRIT (todos) y EXCESO (B, C)
 *   1. Subir ingredientes existentes por debajo de opt.min (todos)
 *   2. (B, C) Agregar nuevos activadores por gap restante con preferencias estratégicas
 *        B → N2_NO_PKG: preferir Citrulina (ING-0017) — modulación NO sostenida
 *        C → N2_NO_PKG: evitar Citrulina — Arginina pura para burst NO pico
 *   3. Escala estratégica según objetivo:
 *        B (GRUESO)      → escalar contribuidores de N3 (SAM, CHITIN, SPITZ) a opt.max
 *        C (FINO RÁPIDO) → escalar contribuidores de N1+N2 (GLYC, ETC, ODC, NO_PKG) a opt.max
 *                           + Arginina (ING-0006) a opt.max para burst pico
 *   4. Corrección de saturación ARG + CITRULINA (fNOS)
 *   5. Resolución de constraints de interacción (reemplazos + companions)
 *   6. Calcular diff, score proyectado, fenotipo y metadata de resultado
 */
function _optBuildScenario(ingRows, allIngs, allMeta, scenarioId, calibCepaId) {
  // Mapa mutable de qtys (unidades nativas del ingrediente)
  const qtyMap = {};
  ingRows.forEach(fi => { qtyMap[fi.id] = fi.qty || 0; });

  // Mapa de unidades (inmutable — resuelto de live library)
  const unidadMap = {};
  ingRows.forEach(fi => {
    const live = allIngs.find(x => x.id === fi.id);
    unidadMap[fi.id] = fi.unidad || live?.unidad || 'gr';
  });

  // Ingredientes nuevos a agregar { ingId → { qty, unidad, meta, ing } }
  const addedMap = {};
  const existingIngIds = new Set(ingRows.map(fi => fi.id));

  // ── Helpers de lectura/escritura sobre la proyección en construcción ──────
  function getCurrentQty(ingId) {
    if (qtyMap[ingId] !== undefined) return qtyMap[ingId];
    if (addedMap[ingId]) return addedMap[ingId].qty;
    return 0;
  }
  function setCurrentQty(ingId, newQty) {
    if (qtyMap[ingId] !== undefined) { qtyMap[ingId] = newQty; }
    else if (addedMap[ingId]) { addedMap[ingId].qty = newQty; }
  }
  function buildProjectedRows() {
    const rows = ingRows.map(fi => ({
      id: fi.id, qty: qtyMap[fi.id] ?? 0, unidad: unidadMap[fi.id], snapshot: fi.snapshot,
    }));
    Object.entries(addedMap).forEach(([ingId, a]) => {
      rows.push({ id: ingId, qty: a.qty, unidad: a.unidad });
    });
    return rows;
  }

  // ── Paso 0: reducir excesos ───────────────────────────────────────────────
  // EXCESO_CRIT (qty ≥ alertaCritica.min): todos los escenarios
  // EXCESO simple (qty > rangoOptimo.max): B y C
  ingRows.forEach(fi => {
    const m      = allMeta[fi.id];
    if (!m) return;
    const qty    = qtyMap[fi.id] || 0;
    const optMax  = m.rangoOptimo?.max;
    const critMin = m.alertaCritica?.min;
    if (qty <= 0 || !optMax) return;
    if (critMin && qty >= critMin) {
      qtyMap[fi.id] = optMax;
    } else if ((scenarioId === 'B' || scenarioId === 'C') && qty > optMax) {
      qtyMap[fi.id] = optMax;
    }
  });

  // ── Paso 1: subir existentes debajo de opt.min para cerrar gaps ───────────
  const initGaps = _optDiagnoseGaps(_optComputeRouteLevels(buildProjectedRows(), allMeta));
  initGaps.forEach(gap => {
    if (gap.level >= 75) return;
    let remaining = gap.deficit;
    const contribs = gap.contributors
      .filter(c => c.scale < 1.0 && c.opt?.min > 0)
      .sort((a, b) => b.pct - a.pct);
    for (const contrib of contribs) {
      if (remaining <= 0.01) break;
      const curQty    = qtyMap[contrib.ingId] || 0;
      const targetQty = contrib.opt.min;
      if (targetQty <= curQty) continue;
      const gainIfMaxed = contrib.pct * (1.0 - contrib.scale);
      qtyMap[contrib.ingId] = targetQty;
      remaining -= gainIfMaxed;
    }
  });

  // ── Paso 2 (B y C): agregar nuevos activadores por gap restante ───────────
  // Estrategia diferenciada por escenario en N2_NO_PKG:
  //   B → preferir Citrulina malato (ING-0017): modulación NO sostenida, hifas densas
  //   C → evitar Citrulina, dejar que Arginina (paso 3) provea burst NO pico
  if (scenarioId === 'B' || scenarioId === 'C') {
    const midGaps = _optDiagnoseGaps(_optComputeRouteLevels(buildProjectedRows(), allMeta));
    midGaps.forEach(gap => {
      if (gap.level >= 75) return;
      let activatorOpts = {};
      if (gap.routeId === 'N2_NO_PKG') {
        if (scenarioId === 'B') activatorOpts = { preferIngId: 'ING-0017' };
        if (scenarioId === 'C') activatorOpts = { avoidIngIds: new Set(['ING-0017']) };
      }
      const activator = _optBestActivatorForRoute(gap.routeId, existingIngIds, allIngs, allMeta, activatorOpts);
      if (!activator || addedMap[activator.ingId]) return;
      addedMap[activator.ingId] = { qty: activator.opt.min, unidad: activator.unidad, meta: activator.meta, ing: activator.ing };
      existingIngIds.add(activator.ingId);
    });
  }

  // ── Paso 3B (GRUESO): escalar contribuidores de N3 a opt.max ─────────────
  // Maximizar inversión estructural: quitina, SAM y SPITZ → hifas densas y robustas.
  // Solo se escalan ingredientes ya presentes (no se agregan nuevos aquí).
  if (scenarioId === 'B') {
    const N3_ROUTES = ['N3_SAM', 'N3_CHITIN', 'N3_SPITZ'];
    buildProjectedRows().forEach(fi => {
      const m = allMeta[fi.id];
      if (!m?.contribuciones || !m.rangoOptimo?.max) return;
      const contributesToN3 = N3_ROUTES.some(r => (m.contribuciones[r] || 0) > 0);
      if (!contributesToN3) return;
      const curQty    = getCurrentQty(fi.id);
      if (curQty <= 0) return; // no agregar nuevos en este paso
      const targetQty = m.rangoOptimo.max;
      if (targetQty > curQty) setCurrentQty(fi.id, targetQty);
    });
  }

  // ── Paso 3C (FINO RÁPIDO): escalar N1+N2 a opt.max + Arginina al máximo ──
  // Maximizar energía (N1) y señal (N2). Menos inversión en pared celular (N3).
  // Arginina a opt.max provee el burst NO pico que define el fenotipo fino rápido.
  if (scenarioId === 'C') {
    const N1N2_ROUTES = ['N1_GLYC', 'N1_ETC', 'N2_ODC', 'N2_NO_PKG'];
    buildProjectedRows().forEach(fi => {
      const m = allMeta[fi.id];
      if (!m?.contribuciones || !m.rangoOptimo?.max) return;
      const contributesToN1N2 = N1N2_ROUTES.some(r => (m.contribuciones[r] || 0) > 0);
      if (!contributesToN1N2) return;
      const curQty    = getCurrentQty(fi.id);
      if (curQty <= 0) return;
      const targetQty = m.rangoOptimo.max;
      if (targetQty > curQty) setCurrentQty(fi.id, targetQty);
    });
    // Arginina (ING-0006) a opt.max: burst NO pico — firma del fenotipo fino rápido
    const argMeta = allMeta['ING-0006'];
    if (argMeta?.rangoOptimo?.max) {
      const argCur = getCurrentQty('ING-0006');
      if (argCur > 0 && argMeta.rangoOptimo.max > argCur) {
        setCurrentQty('ING-0006', argMeta.rangoOptimo.max);
      }
    }
  }

  // ── Paso 4: corrección ARG + CITRULINA (interacción de saturación fNOS) ──
  // [Arg] + [Cit] × CIT_TO_ARG_FACTOR > 3.0 gr → riesgo de inhibición paradójica del ETC.
  const argId = 'ING-0006', citId = 'ING-0017';
  const argQtyRaw = getCurrentQty(argId);
  const citQtyRaw = getCurrentQty(citId);
  if (argQtyRaw > 0 && citQtyRaw > 0) {
    const argGr = toGrams(argQtyRaw, unidadMap[argId] || 'gr');
    const citUnidad = addedMap[citId]?.unidad || unidadMap[citId] || 'gr';
    const citGr = toGrams(citQtyRaw, citUnidad);
    if (argGr + citGr * CIT_TO_ARG_FACTOR > 3.0) {
      const safeArgGr = Math.max(1.5, 3.0 - citGr * CIT_TO_ARG_FACTOR);
      const argUnidad = unidadMap[argId] || 'gr';
      setCurrentQty(argId, argUnidad === 'mg' ? safeArgGr * 1000 : safeArgGr);
    }
  }

  // ── Paso 5: resolución de constraints de interacción ─────────────────────
  const resolvedConstraints = _optApplyConstraints(qtyMap, addedMap, unidadMap, existingIngIds, allIngs, allMeta);

  // ── Construir diff de cambios ─────────────────────────────────────────────
  const changes = [];
  ingRows.forEach(fi => {
    const before = fi.qty || 0;
    const after  = qtyMap[fi.id] ?? before;
    if (Math.abs(after - before) > 0.0001) {
      const live = allIngs.find(x => x.id === fi.id);
      changes.push({
        ingId: fi.id, nombre: (fi.snapshot?.nombre) || live?.nombre || fi.id,
        before, after, delta: after - before, isNew: false, unidad: unidadMap[fi.id] || 'gr',
      });
    }
  });
  Object.entries(addedMap).forEach(([ingId, a]) => {
    changes.push({ ingId, nombre: a.ing?.nombre || ingId, before: 0, after: a.qty, delta: a.qty, isNew: true, unidad: a.unidad });
  });

  // ── Score, C/N, fenotipo y niveles proyectados ────────────────────────────
  const projRows   = buildProjectedRows();
  const cepaId     = calibCepaId || null;
  const projStates = calcEstadoRutas(projRows, cepaId);
  const projCN     = calcCN(projRows, allIngs);
  const projThScore = calcRizomorfico(projStates, projCN.cn);
  // Aplicar calibración empírica al score proyectado si hay cepa activa
  let projScore = projThScore;
  let projCalibData = null;
  if (cepaId && typeof window._cilab_getCalibratedScore === 'function') {
    projCalibData = window._cilab_getCalibratedScore(projRows, cepaId);
    // Proyecciones usan solo bias de cepa: las synergías por ingrediente son correlacionales
    // y aplastan a 0 escenarios con combinaciones de ingredientes no probadas antes.
    if (projCalibData) projScore = Math.max(0, Math.min(100, projThScore + projCalibData.bias));
  }
  const projLevels = _optComputeRouteLevels(projRows, allMeta);
  const projGaps   = _optDiagnoseGaps(projLevels);
  const cnOk       = projCN.cn == null || (projCN.cn >= 6 && projCN.cn <= 18);
  const phenotype  = _optPredictPhenotype(projLevels, scenarioId);

  return {
    id: scenarioId, changes, projRows, resolvedConstraints,
    projectedScore: projScore, projThScore, projCalibData, projCN: projCN.cn,
    cnOk, routeLevels: projLevels, gaps: projGaps, phenotype,
    activeCount: ROUTES.filter(r => !r.isOutput).length - projGaps.length,
    totalRoutes:  ROUTES.filter(r => !r.isOutput).length,
  };
}

/**
 * Motor principal de optimización.
 * @param {Array} ingRows - ingredientes actuales [{id, qty, unidad, ...}]
 * @returns {{ currentScore, currentLevels, gaps, cn, scenarios: {A,B,C} }}
 */
function optimizeFormula(ingRows, calibCepaId) {
  const allIngs  = readIngredientes();
  const allMeta  = loadMeta();
  const cepaId   = calibCepaId || null;
  // Ingredientes deshabilitados no son candidatos para nuevas sugerencias.
  // Los que YA están en la fórmula (ingRows) se siguen procesando aunque estén disabled.
  const eligibleIngs = allIngs.filter(i => !allMeta[i.id]?.disabled);
  const routeStates = calcEstadoRutas(ingRows, cepaId);
  const cnData      = calcCN(ingRows, allIngs);
  const thScore     = calcRizomorfico(routeStates, cnData.cn);
  // Si hay cepa activa, el score base del optimizador es el calibrado
  let currentScore = thScore;
  let calibrationModel = null;
  if (cepaId && typeof window._cilab_getCalibratedScore === 'function') {
    const cal = window._cilab_getCalibratedScore(ingRows, cepaId);
    if (cal) {
      currentScore     = cal.calibratedScore;
      calibrationModel = cal;
    }
  }
  const currentLevels = _optComputeRouteLevels(ingRows, allMeta);
  return {
    currentScore, thScore, calibrationModel, cepaId,
    currentLevels, cn: cnData.cn,
    gaps: _optDiagnoseGaps(currentLevels),
    scenarios: {
      A: _optBuildScenario(ingRows, eligibleIngs, allMeta, 'A', cepaId),
      B: _optBuildScenario(ingRows, eligibleIngs, allMeta, 'B', cepaId),
      C: _optBuildScenario(ingRows, eligibleIngs, allMeta, 'C', cepaId),
    },
  };
}

// Candidatos a probar: ingredientes no típicos de las DBs de usuarios que
// podrían activar rutas deficitarias. El motor los sugiere cuando la ruta
// objetivo tiene nivel < 60% y el candidato no está en readIngredientes().
const OPT_PROBE_CANDIDATES = [
  {
    id: 'PC_PUTRESCINA',
    nombre: 'Putrescina (Diaminobutano)',
    routeId: 'N2_ODC',
    namePattern: /putrescina|diaminobutano|diaminobutan/i,
    dosisMin: 50, dosisMax: 100, unidad: 'mg',
    justificacion: 'Diamina precursora de espermidina vía ODC. Refuerza el gradiente de Ca²⁺ en el Spitzenkörper — clave para polaridad apical en APE y cepas de alta velocidad.',
  },
  {
    id: 'PC_ESPERMIDINA',
    nombre: 'Espermidina',
    routeId: 'N2_ODC',
    namePattern: /espermidina|spermidine/i,
    dosisMin: 10, dosisMax: 30, unidad: 'mg',
    justificacion: 'Poliamina directa — no requiere síntesis vía ODC. Sinergia comprobada con L-Arginina. Estabiliza el Spitzenkörper con menor carga metabólica que la vía endógena.',
  },
  {
    id: 'PC_BETAINA',
    nombre: 'Betaína (Trimetilglicina)',
    routeId: 'N3_SAM',
    namePattern: /betaína|betaina|trimetilglicina|tmg/i,
    dosisMin: 500, dosisMax: 1000, unidad: 'mg',
    justificacion: 'Donante de grupos metilo — alimenta la ruta SAM directamente. Barato, estable y sin efectos inhibitorios conocidos. No reportado en la mayoría de las bases caseras.',
  },
  {
    id: 'PC_GLUCOSAMINA',
    nombre: 'Glucosamina HCl',
    routeId: 'N3_CHITIN',
    namePattern: /glucosamina|glucosamine/i,
    dosisMin: 200, dosisMax: 500, unidad: 'mg',
    justificacion: 'Precursor directo de quitina para la pared celular de hifas. Reduce la carga metabólica de síntesis de quitina de novo, liberando recursos para elongación.',
  },
  {
    id: 'PC_TREHALOSA',
    nombre: 'Trehalosa',
    routeId: 'N1_GLYC',
    namePattern: /trehalosa|trehalose/i,
    dosisMin: 2, dosisMax: 5, unidad: 'g',
    justificacion: 'Disacárido de liberación lenta con efecto osmoprotector. Evita la inhibición por exceso de glucosa — genera una curva de carbono más plana y sostenida que la sacarosa.',
  },
  {
    id: 'PC_COLINA',
    nombre: 'Cloruro de Colina',
    routeId: 'N3_SAM',
    namePattern: /colina|choline/i,
    dosisMin: 100, dosisMax: 300, unidad: 'mg',
    justificacion: 'Fuente alternativa de grupos metilo para la ruta SAM cuando la betaína no está disponible. También actúa como precursor de fosfatidilcolina para membranas hifales.',
  },
];

// ════════════════════════════════════════════
// OPTIMIZADOR — TAB
// ════════════════════════════════════════════

// Utilidades compartidas por _buildOptimizerTab y _genRandomCards
function _optScoreColor(s) {
  return s >= 80 ? 'var(--st-activa)' : s >= 55 ? '#FFC000' : 'var(--st-crit)';
}
function _optFmtQty(qty) {
  if (qty === 0) return '0';
  if (qty < 1) return (+qty.toFixed(3)).toString();
  if (qty % 1 === 0) return qty.toString();
  return (+qty.toFixed(2)).toString();
}

// Cambia cepa desde el selector del tab Optimizador y recalcula
function clabOptCepaChange(val) {
  _state.calibCepaId = val || null;
  const sel = document.getElementById('clab-anal-cepa');
  if (sel) sel.value = val || '';
  _buildOptimizerTab();
}

// Construye y renderiza el contenido del tab Optimizador en #clab-sub-optimizador
function _buildOptimizerTab() {
  const container = document.getElementById('clab-sub-optimizador');
  if (!container) return;

  const ingRows = _getEffectiveIngs();
  if (!ingRows.length) {
    container.innerHTML = `<div class="clab-optab-empty">
      Seleccioná una fórmula en el 🧬 Analizador metabólico para activar el Optimizador.
    </div>`;
    return;
  }

  const result = optimizeFormula(ingRows, _state.calibCepaId || null);
  _state.lastOptimizerResult = result;

  const genetics = typeof readGenetics === 'function' ? readGenetics() : [];

  // Nombre de la fórmula activa
  const forms = readForms();
  const activeForm = forms.find(f => f.id === _state.formulaId);
  const formLabel = activeForm ? esc(activeForm.nombre || activeForm.id) : 'Modo libre';

  // Selector de cepas
  const cepaOptions = genetics.map(g => {
    const sel = _state.calibCepaId === g.id ? ' selected' : '';
    return `<option value="${esc(g.id)}"${sel}>${esc(g.label)}</option>`;
  }).join('');

  // Score actual
  const gapCount = result.gaps.length;
  const cnStr    = result.cn != null ? ` · C/N ${result.cn.toFixed(1)}` : '';
  const calibStr = result.calibrationModel
    ? ` <span style="font-size:10px;color:var(--tx3)">(calibrado · teórico: ${result.thScore?.toFixed(1)})</span>` : '';

  // ── Header ──────────────────────────────────────────────────────────────
  const headerHTML = `
    <div class="clab-optab-header">
      <div class="clab-optab-header-left">
        <span class="clab-optab-title">⚡ Optimizador</span>
        <span class="clab-optab-formula-badge">📋 ${formLabel}</span>
        <span class="clab-optab-score-badge">
          Score actual: <b style="color:${_optScoreColor(result.currentScore)}">${result.currentScore.toFixed(1)}/100</b>${calibStr}
          &nbsp;·&nbsp; ${gapCount} ruta${gapCount !== 1 ? 's' : ''} por optimizar${cnStr}
        </span>
      </div>
      <div class="clab-optab-cepa-wrap">
        <span class="clab-optab-cepa-label">Calibrar para cepa</span>
        <select class="clab-select" style="min-width:200px;font-size:11px" onchange="clabOptCepaChange(this.value)">
          <option value="" ${!_state.calibCepaId ? 'selected' : ''}>— Global (todas las cepas) —</option>
          ${cepaOptions}
        </select>
      </div>
    </div>`;

  // ── Sección 1: Metabólica ────────────────────────────────────────────────
  function buildMetabolicCard(sc, label, cardIcon, desc) {
    const delta    = sc.projectedScore - result.currentScore;
    const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1);
    const deltaClr = delta > 0 ? 'var(--st-activa)' : delta < 0 ? 'var(--st-crit)' : 'var(--tx3)';

    const routeCoverage = ROUTES.filter(r => !r.isOutput).map(route => {
      const lvl   = Math.min(100, sc.routeLevels[route.id]?.level || 0);
      const clr   = lvl >= 75 ? 'var(--st-activa)' : lvl > 0 ? '#FFC000' : 'var(--st-inactiva)';
      const stIco = lvl >= 75 ? '✓' : lvl > 0 ? '◑' : '✗';
      return `<span class="clab-opt-rt" style="color:${clr}" title="${esc(route.name)} · ${Math.round(lvl)}">${stIco} ${esc(route.short)}</span>`;
    }).join('');

    const changesHTML = sc.changes.length === 0
      ? `<div class="clab-opt-nochange">Sin cambios necesarios ✓</div>`
      : sc.changes.map(ch => {
          const sign   = ch.isNew ? '＋ Agregar' : ch.delta > 0 ? '↑ Subir' : '↓ Reducir';
          const cls    = ch.isNew ? 'new' : ch.delta > 0 ? 'up' : 'dn';
          const before = ch.isNew ? '' : `${_optFmtQty(ch.before)} → `;
          return `<div class="clab-opt-change clab-opt-ch-${cls}">
            <span class="clab-opt-sign">${sign}</span>
            <span class="clab-opt-cname">${esc(ch.nombre)}</span>
            <span class="clab-opt-cqty">${before}<b>${_optFmtQty(ch.after)}</b> ${esc(ch.unidad)}</span>
          </div>`;
        }).join('');

    const cnWarnHTML = !sc.cnOk && sc.projCN != null
      ? `<div class="clab-opt-cn-warn">⚠ C/N proyectado: <b>${sc.projCN.toFixed(1)}</b> — fuera del rango óptimo (6–18).</div>`
      : '';

    const phenotype = sc.phenotype;
    const pClr = phenotype ? ({
      GRUESO: '#9B6DFF', FINO_RAPIDO: '#00C4FF', PARCIAL: '#FFC000', TOMENTOSO: 'var(--st-crit)',
    }[phenotype.type] || 'var(--tx2)') : null;
    const phenoHTML = phenotype
      ? `<div class="clab-opt-phenotype" style="color:${pClr}"><b>${esc(phenotype.label)}</b> <span class="clab-opt-phenotype-desc">${esc(phenotype.desc)}</span></div>`
      : '';

    const constraintsHTML = (sc.resolvedConstraints || []).length > 0
      ? `<div class="clab-opt-constraints">${sc.resolvedConstraints.map(c => {
          const ico = c.tipo === 'reemplazo' ? '⇄' : '＋';
          return `<div class="clab-opt-cstr"><span class="clab-opt-cstr-ico">${ico}</span><div>
            <div class="clab-opt-cstr-desc">${esc(c.descripcion)}</div>
            <div class="clab-opt-cstr-reason">${esc(c.razon)}</div>
          </div></div>`;
        }).join('')}</div>` : '';

    return `<div class="clab-optab-card metabolic">
      <div class="clab-optab-card-title">${cardIcon} ${label}</div>
      <div class="clab-optab-score-row">
        <span class="clab-optab-score-val" style="color:${_optScoreColor(sc.projectedScore)}">${sc.projectedScore.toFixed(1)}</span>
        <span class="clab-optab-score-delta" style="color:${deltaClr}">${deltaStr}</span>
      </div>
      <div class="clab-opt-routes">${routeCoverage}</div>
      ${phenoHTML}${constraintsHTML}${cnWarnHTML}
      <hr class="clab-optab-divider">
      <div class="clab-opt-changes">${changesHTML}</div>
      <div class="clab-opt-actions">
        <button class="clab-btn clab-btn-p clab-opt-apply" onclick="clabApplyOptimizerScenario('${sc.id}')">▶ Aplicar en Modo libre</button>
        <button class="clab-btn clab-opt-newci" onclick="clabOpenNewFormModalFromOptimizer('${sc.id}')">🧫 Nueva Fórmula CI</button>
      </div>
    </div>`;
  }

  const sec1HTML = `
    <div class="clab-optab-section">
      <div class="clab-optab-section-hdr">
        <span class="clab-optab-section-icon">🔬</span>
        <span class="clab-optab-section-title">Optimización Metabólica</span>
        <span class="clab-optab-section-desc">Motor de rutas — detecta gaps y sugiere ajustes</span>
      </div>
      <div class="clab-optab-cards">
        ${buildMetabolicCard(result.scenarios.A, 'Escenario A · Corrección mínima',   '🔧', '')}
        ${buildMetabolicCard(result.scenarios.B, 'Escenario B · Rizomorfismo Grueso', '🍄', '')}
        ${buildMetabolicCard(result.scenarios.C, 'Escenario C · Fino Rápido',         '⚡', '')}
      </div>
    </div>`;

  // Secciones 2, 3, 4 se agregan en las siguientes tareas.

  // ── Sección 2: IA Empírica ───────────────────────────────────────────────
  function buildSec2HTML() {
    var cards = '';
    var hasContent = false;

    // Cards A/B/C: Fórmulas generadas por FI Engine
    if (window.cilabFI && typeof window.cilabFI.generateFormula === 'function') {
      var candidates;
      try { candidates = window.cilabFI.generateFormula(80, _state.calibCepaId || null); } catch(e) { candidates = null; }
      if (candidates && candidates.length) {
        _state.lastFICandidates = candidates;

        var intModel = (window.cilabInt && typeof window.cilabInt.getModel === 'function') ? window.cilabInt.getModel() : null;
        var activeCoefs = (intModel && !intModel.error && _state.calibCepaId && intModel.byStrain && intModel.byStrain[_state.calibCepaId])
          ? intModel.byStrain[_state.calibCepaId].coefs
          : (intModel && !intModel.error ? intModel.coefs : {});
        var ingMeta = typeof window._cilab_loadMeta === 'function' ? window._cilab_loadMeta() : {};

        var candidateConfig = {
          'Maximo hibrido': {
            letra: 'A', icon: '🧠',
            estrategia: 'Maximiza el score híbrido combinando el modelo OLS empírico con la cobertura de rutas teóricas. Prioriza ingredientes que tienen evidencia en tus ensayos anteriores Y activación metabólica documentada. Es la sugerencia más informada por tus datos reales.',
          },
          'Compacta (8 ingredientes max)': {
            letra: 'B', icon: '⚡',
            estrategia: 'Misma estrategia que Fórmula A, pero limitada a 8 ingredientes. Menor costo y preparación. Útil para confirmar si los ingredientes más importantes alcanzan para replicar el resultado antes de invertir en una fórmula compleja.',
          },
          'Conservadora (teorica)': {
            letra: 'C', icon: '🔬',
            estrategia: 'Ignorar el modelo OLS y basarse exclusivamente en rutas metabólicas teóricas. Recomendada cuando el modelo empírico tiene R² bajo o pocos ensayos (N < 10). No está sesgada por datos históricos — es la "línea de base bioquímica".',
          },
        };

        candidates.forEach(function(cand, idx) {
          var cfg = candidateConfig[cand.label] || { letra: String(idx + 1), icon: '🧬', estrategia: '' };
          var cScore = cand.projectedHybridScore;
          var delta  = cScore - result.currentScore;
          var dStr   = (delta >= 0 ? '+' : '') + delta.toFixed(1);
          var dClr   = delta > 0 ? 'var(--st-activa)' : delta < 0 ? 'var(--st-crit)' : 'var(--tx3)';
          var cnStr  = cand.projectedCN != null ? ` · C/N: <b>${cand.projectedCN}</b>` : '';

          // Per-ingredient justification
          var ings = cand.ings || [];
          function ingJustification(ing) {
            var coefData = activeCoefs && activeCoefs[ing.id];
            if (coefData && coefData.confidence !== 'insuficiente' && coefData.coef > 0) {
              return 'Coef empírico: +' + coefData.coef.toFixed(1) + ' (n=' + coefData.n + ' ensayos)';
            }
            var meta = ingMeta && ingMeta[ing.id];
            if (meta && meta.contribuciones) {
              var topRouteId = null, topPct = 0;
              Object.keys(meta.contribuciones).forEach(function(rId) {
                var pct = meta.contribuciones[rId];
                if (pct > topPct) { topPct = pct; topRouteId = rId; }
              });
              if (topRouteId) {
                var routeObj = ROUTES.find(function(r) { return r.id === topRouteId; });
                var shortName = routeObj ? routeObj.short : topRouteId;
                return 'Activa: ' + shortName + ' (+' + topPct + '%)';
              }
            }
            return 'Ingrediente del rango óptimo metabólico';
          }

          var keyIngs = ings.slice(0, 4);
          var keyHTML = keyIngs.map(function(ing) {
            return '<div style="margin:2px 0"><span style="color:var(--ac)">•</span> <b>' + esc(ing.nombre) + '</b> — <span style="color:var(--tx2);font-size:10px">' + esc(ingJustification(ing)) + '</span></div>';
          }).join('');

          var allIngHTML = ings.map(function(ing) {
            return '<div><span style="color:var(--tx2)">' + esc(ing.nombre) + '</span> <b style="color:var(--ac2)">' + ing.qty + esc(ing.unidad) + '</b></div>';
          }).join('');

          var detailsHTML = ings.length > 4
            ? '<details style="margin-top:6px"><summary style="cursor:pointer;font-size:10px;color:var(--tx3)">Mostrar todos los ingredientes ▼</summary><div class="clab-optab-ing-list" style="margin-top:4px">' + allIngHTML + '</div></details>'
            : '<div class="clab-optab-ing-list" style="margin-top:4px">' + allIngHTML + '</div>';

          cards += `<div class="clab-optab-card empirical">
            <div class="clab-optab-card-title">${cfg.icon} Fórmula ${cfg.letra} — ${esc(cand.label)}</div>
            <div class="clab-optab-score-row">
              <span class="clab-optab-score-val" style="color:var(--ac2)">${cScore}</span>
              <span class="clab-optab-score-delta" style="color:${dClr}">${dStr}</span>
            </div>
            <div class="clab-optab-score-meta">Híbrido: ${cScore}/100 · Teórico: <b>${cand.projectedThScore}</b>/100${cnStr} · N=${cand.N} · confianza ${esc(cand.confidence)}</div>
            <div style="font-size:10px;color:var(--tx2);margin-top:6px;line-height:1.5">${esc(cfg.estrategia)}</div>
            <hr class="clab-optab-divider">
            <div style="font-size:10px;color:var(--tx3);margin-bottom:4px">Ingredientes clave:</div>
            ${keyHTML}
            ${detailsHTML}
            <div class="clab-opt-actions" style="margin-top:8px">
              <button class="clab-btn clab-btn-p" onclick="clabApplyFICandidate(${idx})">▶ Aplicar en Modo libre</button>
              <button class="clab-btn clab-opt-newci" onclick="clabNewCIFICandidate(${idx})">🧫 Nueva Fórmula CI</button>
            </div>
          </div>`;
          hasContent = true;
        });
      }
    }

    // Card Top impacto: coeficientes OLS
    if (window.cilabInt && typeof window.cilabInt.getModel === 'function') {
      var intModel = window.cilabInt.getModel();
      if (intModel && !intModel.error && intModel.r2 >= 0.30 && intModel.nRecords >= 5) {
        var coefs = (_state.calibCepaId && intModel.byStrain && intModel.byStrain[_state.calibCepaId])
          ? intModel.byStrain[_state.calibCepaId].coefs
          : intModel.coefs;
        var _emIngs = readIngredientes();
        var rows = [];
        Object.keys(coefs).forEach(function(ingId) {
          var d = coefs[ingId];
          if (!d || d.confidence === 'insuficiente' || Math.abs(d.coef) < 0.5) return;
          var live = _emIngs.find(function(i) { return i.id === ingId; });
          var name = ingId === '__cn__' ? 'Ratio C/N' : ((live && live.nombre) || ingId);
          rows.push({ name, coef: d.coef, n: d.n });
        });
        rows.sort(function(a, b) { return Math.abs(b.coef) - Math.abs(a.coef); });
        if (rows.length) {
          const rowsHTML = rows.slice(0, 8).map(function(r) {
            const clr = r.coef > 0 ? 'var(--st-activa)' : 'var(--st-crit)';
            const arrow = r.coef > 0 ? '▲' : '▼';
            return `<div class="clab-optab-impact-row">
              <span style="color:${clr}">${arrow} ${r.coef > 0 ? '+' : ''}${r.coef.toFixed(1)}</span>
              ${esc(r.name)} <span style="color:var(--tx3);font-size:10px">(n=${r.n})</span>
            </div>`;
          }).join('');
          cards += `<div class="clab-optab-card empirical">
            <div class="clab-optab-card-title">📊 Top ingredientes por impacto</div>
            <div class="clab-optab-score-meta">Modelo OLS · R²=${intModel.r2.toFixed(2)} · N=${intModel.nRecords}</div>
            <hr class="clab-optab-divider">
            ${rowsHTML}
          </div>`;
          hasContent = true;
        }
      }
    }

    if (!hasContent) {
      return `<div class="clab-optab-section">
        <div class="clab-optab-section-hdr">
          <span class="clab-optab-section-icon">🧠</span>
          <span class="clab-optab-section-title">Optimización IA Empírica</span>
        </div>
        <div class="clab-optab-empty">Se necesitan al menos 5 ensayos calificados en Conocimiento y R² ≥ 0.30 para activar esta sección.</div>
      </div>`;
    }

    return `<div class="clab-optab-section">
      <div class="clab-optab-section-hdr">
        <span class="clab-optab-section-icon">🧠</span>
        <span class="clab-optab-section-title">Optimización IA Empírica</span>
        <span class="clab-optab-section-desc">OLS + conocimiento empírico · N=${result.cepaId ? 'cepa específica' : 'global'}</span>
      </div>
      <div class="clab-optab-cards">${cards}</div>
    </div>`;
  }

  // ── Sección 3: Prueba de Ingredientes ───────────────────────────────────
  const sec3HTML = `
    <div class="clab-optab-section">
      <div class="clab-optab-section-hdr">
        <span class="clab-optab-section-icon">🧪</span>
        <span class="clab-optab-section-title">Prueba de Ingredientes</span>
        <span class="clab-optab-section-desc">El motor aprende cuando calificás el crecimiento en Conocimiento</span>
      </div>
      <div class="clab-optab-cards">${_genProbeCards(ingRows, result)}</div>
    </div>`;

  // ── Sección 4: Aleatorio ─────────────────────────────────────────────────
  const sec4HTML = `
    <div class="clab-optab-section">
      <div class="clab-optab-section-hdr">
        <span class="clab-optab-section-icon">🎲</span>
        <span class="clab-optab-section-title">Aleatorio — Sinergia Experimental</span>
        <span class="clab-optab-section-desc">Combinaciones no exploradas para descubrir interacciones</span>
        <button class="clab-optab-section-btn" onclick="clabSubTab('optimizador')">🔄 Regenerar</button>
      </div>
      <div class="clab-optab-cards">${_genRandomCards(ingRows, result)}</div>
    </div>`;

  container.innerHTML = headerHTML + sec1HTML + buildSec2HTML() + sec3HTML + sec4HTML;
}

function clabApplyScenarioDFromTab() {
  if (!window.cilabFI || typeof window.cilabFI.generateFormula !== 'function') return;
  var candidates;
  try { candidates = window.cilabFI.generateFormula(80, _state.calibCepaId || null); } catch(e) { return; }
  if (!candidates || !candidates.length) return;
  const best = candidates[0];
  _state.libreIngs = {};
  (best.ings || []).forEach(function(ing) {
    if (ing.id && ing.qty > 0) _state.libreIngs[ing.id] = ing.qty;
  });
  clabSubTab('analizador');
  _state.mode = 'libre';
  document.querySelectorAll('.clab-mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'libre'));
  notif('Escenario D cargado en Modo libre', 'ok');
  renderAnalyzer();
}

function clabNewCIFromFormula(ingRows, labelPrefix, scenarioMeta) {
  if (!ingRows.length) return;
  _state.libreIngs = {};
  ingRows.forEach(r => { if ((r.qty || 0) > 0) _state.libreIngs[r.id] = r.qty; });
  _state.mode = 'libre';
  clabSubTab('analizador');
  document.querySelectorAll('.clab-mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'libre'));
  renderAnalyzer();
  setTimeout(function() {
    clabOpenNewFormModalFromLibre();
    const nameEl = document.getElementById('clab-newform-name');
    if (nameEl) {
      nameEl.value = labelPrefix + ' ' + new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });
      nameEl.select();
    }
    const metaEl = document.getElementById('clab-newform-meta');
    if (metaEl && scenarioMeta) metaEl.innerHTML = scenarioMeta;
  }, 80);
}

function clabNewCIFromScenarioD() {
  if (!window.cilabFI || typeof window.cilabFI.generateFormula !== 'function') return;
  var candidates;
  try { candidates = window.cilabFI.generateFormula(80, _state.calibCepaId || null); } catch(e) { return; }
  if (!candidates || !candidates.length) return;
  const best = candidates[0];
  const ingRows = (best.ings || []).map(ing => ({ id: ing.id, qty: ing.qty, unidad: ing.unidad }));
  clabNewCIFromFormula(ingRows, 'OPT-D', `Escenario <b>D</b> · IA Empírica · <span style="color:var(--ac)">${best.projectedHybridScore}/100</span>`);
}

function clabApplyFICandidate(idx) {
  var candidates = _state.lastFICandidates;
  if (!candidates || !candidates[idx]) return;
  var cand = candidates[idx];
  _state.libreIngs = {};
  (cand.ings || []).forEach(function(ing) {
    if (ing.id && ing.qty > 0) _state.libreIngs[ing.id] = ing.qty;
  });
  clabSubTab('analizador');
  _state.mode = 'libre';
  document.querySelectorAll('.clab-mode-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mode === 'libre');
  });
  notif('Fórmula ' + (cand.label || idx) + ' cargada en Modo libre', 'ok');
  renderAnalyzer();
}

function clabNewCIFICandidate(idx) {
  var candidates = _state.lastFICandidates;
  if (!candidates || !candidates[idx]) return;
  var cand = candidates[idx];
  var ingRows = (cand.ings || []).map(function(ing) { return { id: ing.id, qty: ing.qty, unidad: ing.unidad }; });
  var letra = idx === 0 ? 'A' : idx === 1 ? 'B' : 'C';
  clabNewCIFromFormula(ingRows, 'OPT-' + letra, 'Fórmula <b>' + letra + '</b> · IA · <span style="color:var(--ac)">' + cand.projectedHybridScore + '/100</span>');
}

function _genProbeCards(ingRows, result) {
  const allIngs     = readIngredientes();
  const userIngNames = allIngs.map(i => i.nombre || '');

  // Filtrar candidatos: ruta deficitaria + no está en la DB del usuario
  const cards = OPT_PROBE_CANDIDATES.filter(function(pc) {
    const routeLevel = result.currentLevels[pc.routeId]?.level || 0;
    if (routeLevel >= 60) return false;
    const alreadyInDB = userIngNames.some(n => pc.namePattern.test(n));
    return !alreadyInDB;
  });

  if (!cards.length) {
    return `<div class="clab-optab-empty">Todas las rutas activas tienen buena cobertura, o ya tenés los candidatos registrados en tu DB.</div>`;
  }

  return cards.slice(0, 4).map(function(pc) {
    const routeObj = ROUTES.find(r => r.id === pc.routeId);
    const routeName = routeObj ? routeObj.name : pc.routeId;
    return `<div class="clab-optab-card probe">
      <div class="clab-optab-probe-name">🧪 ${esc(pc.nombre)}</div>
      <div style="font-size:10px;color:#00b894;margin-top:-4px">Activa: ${esc(routeName)}</div>
      <div class="clab-optab-probe-desc">${esc(pc.justificacion)}</div>
      <div class="clab-optab-probe-meta">Dosis sugerida: ${pc.dosisMin}–${pc.dosisMax} ${esc(pc.unidad)} · Sin datos en tu DB</div>
    </div>`;
  }).join('');
}

function _genRandomCards(ingRows, result) {
  var variants;
  try { variants = _optBuildVariants(ingRows, result); } catch(e) { variants = []; }
  _state.explorerVariants = variants;

  if (!variants.length) {
    return `<div class="clab-optab-empty">No se encontraron variantes válidas. Necesitás una fórmula con al menos 3 ingredientes.</div>`;
  }

  const tagLabels = { V1: 'Sinergia teórica', V2: 'Exploración rutas', V3: 'Dosis extrema' };

  return variants.map(function(v) {
    const delta    = v.projectedScore - result.currentScore;
    const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1);
    const deltaClr = delta > 0 ? 'var(--st-activa)' : delta < 0 ? 'var(--st-crit)' : 'var(--tx3)';
    const tag      = tagLabels[v.id] || 'Experimental';

    const cambiosHTML = (v.cambios || []).map(ch =>
      `<div class="clab-opt-change clab-opt-ch-new">
        <span class="clab-opt-sign">＋ Agregar</span>
        <span class="clab-opt-cname">${esc(ch.nombre)}</span>
        <span class="clab-opt-cqty"><b>${_optFmtQty(ch.qty)}</b> ${esc(ch.unidad)}</span>
      </div>`
    ).join('');

    return `<div class="clab-optab-card random">
      <span class="clab-optab-random-tag">${esc(tag)}</span>
      <div class="clab-optab-card-title">${esc(v.nombre)}</div>
      <div class="clab-optab-score-row">
        <span class="clab-optab-score-val" style="color:${_optScoreColor(v.projectedScore)}">${v.projectedScore.toFixed(1)}</span>
        <span class="clab-optab-score-delta" style="color:${deltaClr}">${deltaStr}</span>
      </div>
      <div class="clab-optab-probe-desc">${v.porQueVale || ''}</div>
      <hr class="clab-optab-divider">
      <div class="clab-opt-changes">${cambiosHTML}</div>
      <div class="clab-opt-actions">
        <button class="clab-btn clab-btn-p" onclick="clabApplyExplorerVariant('${esc(v.id)}')">▶ Probar en Modo libre</button>
      </div>
    </div>`;
  }).join('');
}

// ── UI del Optimizador ─────────────────────────────────────────────────────

function clabOpenOptimizer() {
  clabSubTab('optimizador');
}

// ── Explorador de Variantes Experimentales 🎲 ─────────────────────────────
//
// Genera hasta 3 variantes desde el perfil bioquímico actual:
//   V1 — Refuerzo de ruta deficitaria más crítica
//   V2 — Sinergia no explotada de CRITICAL_INTERACTIONS
//   V3 — Ingrediente desde historial bl2_forms con perfil compatible
//
// Cada variante incluye razonamiento bioquímico explícito ("Por qué vale la pena").
// Las variantes se almacenan en _state.explorerVariants para evitar pasar JSON en onclick.
// ─────────────────────────────────────────────────────────────────────────────

function _optBuildVariants(ingRows, result) {
  const allIngs     = readIngredientes();
  const allMeta     = loadMeta();
  const eligibleIngs = allIngs.filter(i => !allMeta[i.id]?.disabled);
  const currentIds  = new Set(ingRows.map(r => r.id));
  const variants    = [];

  // Helper: proyectar score + phenotype + routeLevels desde un conjunto de filas
  function computeProjection(varRows) {
    const projLevels = _optComputeRouteLevels(varRows, allMeta);
    const projStates = calcEstadoRutas(varRows, null);
    const projCN     = calcCN(varRows, allIngs);
    const projScore  = calcRizomorfico(projStates, projCN.cn);
    const phenotype  = _optPredictPhenotype(projLevels, null);
    return { projLevels, projScore, phenotype, projCN: projCN.cn };
  }

  // ── V1: Refuerzo de ruta metabólica deficitaria ──────────────────────────
  // Diagnóstico de gaps → top 2 rutas más críticas → mejor activador por ruta
  try {
    const gaps = _optDiagnoseGaps(result.currentLevels);
    if (gaps.length) {
      const workIds = new Set(currentIds); // copia mutable para evitar duplicados
      const added = [];
      gaps.slice(0, 2).forEach(gap => {
        const act = _optBestActivatorForRoute(gap.routeId, workIds, eligibleIngs, allMeta);
        if (act) {
          added.push({ gap, act });
          workIds.add(act.ingId);
        }
      });
      if (added.length) {
        const varRows = [
          ...ingRows,
          ...added.map(({ act }) => ({
            id: act.ingId, qty: act.opt.min || 1, unidad: act.unidad,
          })),
        ];
        const proj = computeProjection(varRows);
        const razonLines = added.map(({ gap, act }) =>
          `<b>${esc(act.ing.nombre)}</b> es el activador más potente de `
          + `<b>${esc(gap.routeName)}</b> (aporta ${act.pct}% de cobertura directa). `
          + `Ruta actualmente en ${Math.round(gap.level)}/100 — bajo umbral de activación (75).`
        );
        variants.push({
          id: 'V1',
          nombre: 'Refuerzo ' + added[0].gap.routeName,
          estrategia: 'Activación de ruta metabólica deficitaria',
          ingRows: varRows,
          projectedScore: proj.projScore,
          projCN: proj.projCN,
          routeLevels: proj.projLevels,
          phenotype: proj.phenotype,
          porQueVale: razonLines.join('<br>'),
          cambios: added.map(({ act }) => ({
            ingId: act.ingId, nombre: act.ing.nombre,
            qty: act.opt.min || 1, unidad: act.unidad, isNew: true,
          })),
        });
      }
    }
  } catch(e) { /* skip V1 si falla */ }

  // ── V2: Sinergia no explotada de CRITICAL_INTERACTIONS ───────────────────
  // Busca pares sinérgicos (severity=sinergia, condicion=ambos_presentes)
  // donde 1+ ingrediente YA está en la fórmula y el otro NO.
  // El que falta es el candidato a agregar.
  try {
    if (typeof CRITICAL_INTERACTIONS !== 'undefined') {
      const sinergias = CRITICAL_INTERACTIONS.filter(
        i => i.severity === 'sinergia' && i.condicion === 'ambos_presentes'
      );
      let best = null;
      sinergias.forEach(inter => {
        const ings = inter.ingredientes || [];
        if (ings.length < 2) return;
        const inFormula = ings.filter(id => currentIds.has(id));
        const missing   = ings.filter(id => !currentIds.has(id));
        if (!inFormula.length || !missing.length) return;
        const missingId   = missing[0];
        const missingIng  = allIngs.find(x => x.id === missingId);
        const missingMeta = allMeta[missingId];
        if (!missingIng || !missingMeta?.rangoOptimo?.min || missingMeta.disabled) return;
        // Priorizar la sinergia con más ingredientes ya presentes en la fórmula
        if (!best || inFormula.length > best.inFormula.length) {
          best = { inter, inFormula, missingId, missingIng, missingMeta };
        }
      });
      if (best) {
        const varRows = [
          ...ingRows,
          { id: best.missingId, qty: best.missingMeta.rangoOptimo.min, unidad: best.missingIng.unidad || 'gr' },
        ];
        const proj = computeProjection(varRows);
        const inFormulaNames = best.inFormula.map(id => {
          const ing = allIngs.find(x => x.id === id);
          return ing ? `<b>${esc(ing.nombre)}</b>` : esc(id);
        }).join(' + ');
        const rutasStr = (best.inter.rutasAfectadas || []).join(', ');
        variants.push({
          id: 'V2',
          nombre: 'Sinergia · ' + best.inter.nombre,
          estrategia: 'Potenciación de sinergia bioquímica (' + best.inter.id + ')',
          ingRows: varRows,
          projectedScore: proj.projScore,
          projCN: proj.projCN,
          routeLevels: proj.projLevels,
          phenotype: proj.phenotype,
          porQueVale: `Activaría <b>${esc(best.inter.nombre)}</b> (${esc(best.inter.id)}). `
            + `Ya tenés ${inFormulaNames} en la fórmula. `
            + `Agregar <b>${esc(best.missingIng.nombre)}</b> completa el par sinérgico`
            + (rutasStr ? `, potenciando las rutas: <b>${esc(rutasStr)}</b>.` : '.'),
          interaccion: best.inter,
          cambios: [{
            ingId: best.missingId, nombre: best.missingIng.nombre,
            qty: best.missingMeta.rangoOptimo.min, unidad: best.missingIng.unidad || 'gr', isNew: true,
          }],
        });
      }
    }
  } catch(e) { /* skip V2 si falla */ }

  // ── V3: Exploración desde historial de fórmulas (bl2_forms) ──────────────
  // Busca la fórmula guardada con mayor solapamiento de ingredientes con la actual.
  // Del resto de ingredientes de esa fórmula, propone el que mejor cubre los gaps actuales.
  try {
    const forms = JSON.parse(localStorage.getItem('bl2_forms') || '[]');
    if (forms.length) {
      let bestFormula = null, bestOverlap = 0;
      forms.forEach(f => {
        if (!Array.isArray(f.ingredientes) || !f.ingredientes.length) return;
        const fIds = new Set(f.ingredientes.map(i => i.id || i.ingId).filter(Boolean));
        const overlap = [...currentIds].filter(id => fIds.has(id)).length;
        if (overlap > bestOverlap) { bestOverlap = overlap; bestFormula = f; }
      });
      if (bestFormula && bestOverlap >= 1) {
        const historyIds = (bestFormula.ingredientes || []).map(i => i.id || i.ingId).filter(Boolean);
        const candidates = historyIds.filter(id => !currentIds.has(id) && allMeta[id] && !allMeta[id].disabled);
        if (candidates.length) {
          const gaps = _optDiagnoseGaps(result.currentLevels);
          const gapRouteIds = new Set(gaps.map(g => g.routeId));
          let topCand = null, topCandScore = -1;
          candidates.forEach(id => {
            const m = allMeta[id];
            if (!m?.contribuciones || !m.rangoOptimo?.min) return;
            // Puntaje: suma de contribuciones a rutas deficitarias
            const routeScore = Object.entries(m.contribuciones)
              .filter(([r, p]) => gapRouteIds.has(r) && typeof p === 'number' && p > 0)
              .reduce((sum, [, p]) => sum + p, 0);
            if (routeScore > topCandScore) { topCandScore = routeScore; topCand = id; }
          });
          // Si ningún candidato cubre gaps, tomar el primero con rangoOptimo
          if (!topCand) {
            topCand = candidates.find(id => allMeta[id]?.rangoOptimo?.min) || null;
          }
          if (topCand) {
            const candIng  = allIngs.find(x => x.id === topCand);
            const candMeta = allMeta[topCand];
            if (candIng && candMeta) {
              const varRows = [
                ...ingRows,
                { id: topCand, qty: candMeta.rangoOptimo.min, unidad: candIng.unidad || 'gr' },
              ];
              const proj   = computeProjection(varRows);
              const fLabel = bestFormula.nombre || bestFormula.id || 'historial';
              const gapCovered = topCandScore > 0
                ? ` Cubre rutas deficitarias: <b>${esc(gaps.slice(0, 3).map(g => g.routeName).join(', '))}</b>.`
                : ' Complementa el perfil bioquímico existente.';
              variants.push({
                id: 'V3',
                nombre: candIng.nombre + ' · historial',
                estrategia: 'Exploración desde historial de fórmulas',
                ingRows: varRows,
                projectedScore: proj.projScore,
                projCN: proj.projCN,
                routeLevels: proj.projLevels,
                phenotype: proj.phenotype,
                porQueVale: `<b>${esc(candIng.nombre)}</b> aparece en tu fórmula guardada `
                  + `<b>${esc(fLabel)}</b> (${bestOverlap} ingrediente${bestOverlap !== 1 ? 's' : ''} en común).`
                  + gapCovered,
                cambios: [{
                  ingId: topCand, nombre: candIng.nombre,
                  qty: candMeta.rangoOptimo.min, unidad: candIng.unidad || 'gr', isNew: true,
                }],
              });
            }
          }
        }
      }
    }
  } catch(e) { /* skip V3 si falla */ }

  return variants;
}

function clabOpenExplorer() {
  const ingRows = _getEffectiveIngs();
  if (!ingRows.length) { notif('Seleccioná una fórmula primero', 'err'); return; }
  const result = _state.lastOptimizerResult;
  if (!result) { notif('Abrí el Optimizador al menos una vez', 'err'); return; }
  const variants = _optBuildVariants(ingRows, result);
  _state.explorerVariants = variants;
  _buildExplorerModal(result, variants);
}

function _buildExplorerModal(result, variants) {
  const existing = document.getElementById('clab-explorer-modal');
  if (existing) existing.remove();

  function scoreColor(s) {
    return s >= 80 ? 'var(--st-activa)' : s >= 55 ? '#FFC000' : 'var(--st-crit)';
  }
  function fmtQty(qty) {
    if (qty === 0) return '0';
    if (qty < 1) return (+qty.toFixed(3)).toString();
    if (qty % 1 === 0) return qty.toString();
    return (+qty.toFixed(2)).toString();
  }

  function buildVariantCard(v) {
    const delta    = v.projectedScore - (result.currentScore || 0);
    const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1);
    const deltaClr = delta > 0 ? 'var(--st-activa)' : delta < 0 ? 'var(--st-crit)' : 'var(--tx3)';
    const pClr = {
      GRUESO:      '#9B6DFF',
      FINO_RAPIDO: '#00C4FF',
      PARCIAL:     '#FFC000',
      TOMENTOSO:   'var(--st-crit)',
    }[v.phenotype?.type] || 'var(--tx2)';

    const routeCoverage = ROUTES.filter(r => !r.isOutput).map(route => {
      const lvl   = Math.min(100, v.routeLevels[route.id]?.level || 0);
      const clr   = lvl >= 75 ? 'var(--st-activa)' : lvl > 0 ? '#FFC000' : 'var(--st-inactiva)';
      const stIco = lvl >= 75 ? '✓' : lvl > 0 ? '◑' : '✗';
      return `<span class="clab-opt-rt" style="color:${clr}" title="${esc(route.name)} · ${Math.round(lvl)}">${stIco} ${esc(route.short)}</span>`;
    }).join('');

    const cambiosHTML = (v.cambios || []).map(ch =>
      `<div class="clab-opt-change clab-opt-ch-new">
        <span class="clab-opt-sign">＋ Agregar</span>
        <span class="clab-opt-cname">${esc(ch.nombre)}</span>
        <span class="clab-opt-cqty"><b>${fmtQty(ch.qty)}</b> ${esc(ch.unidad)}</span>
      </div>`
    ).join('');

    return `<div class="clab-opt-card" style="border-top:3px solid #3D5AFE">
      <div class="clab-opt-ch">
        <span class="clab-opt-lbl">🧬 ${esc(v.nombre)}</span>
        <div class="clab-opt-sw">
          <span class="clab-opt-sc" style="color:${scoreColor(v.projectedScore)}">${v.projectedScore.toFixed(1)}</span>
          <span class="clab-opt-sd" style="color:${deltaClr}">${deltaStr}</span>
        </div>
      </div>
      <div class="clab-opt-desc" style="color:var(--tx3);font-size:11px;text-transform:uppercase;letter-spacing:.04em">${esc(v.estrategia)}</div>
      ${v.phenotype ? `<div class="clab-opt-phenotype" style="color:${pClr}">
        <b>${esc(v.phenotype.label)}</b>
        <span class="clab-opt-phenotype-desc">${esc(v.phenotype.desc)}</span>
      </div>` : ''}
      <div class="clab-opt-routes">${routeCoverage}</div>
      <div style="margin:10px 0 6px;padding:8px 10px;background:rgba(61,90,254,.08);border-left:3px solid #3D5AFE;border-radius:0 4px 4px 0">
        <div style="font-size:11px;color:#3D5AFE;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">💡 Por qué vale la pena probar esto</div>
        <div style="font-size:12px;color:var(--tx2);line-height:1.55">${v.porQueVale || ''}</div>
      </div>
      <div class="clab-opt-changes">${cambiosHTML}</div>
      <div class="clab-opt-actions">
        <button class="clab-btn clab-btn-p clab-opt-apply" onclick="clabApplyExplorerVariant('${esc(v.id)}')">▶ Aplicar en Modo libre</button>
      </div>
    </div>`;
  }

  const cardsHTML = variants.length
    ? variants.map(buildVariantCard).join('')
    : `<div class="clab-empty">No se encontraron variantes válidas. Probá con una fórmula con más ingredientes o guardá fórmulas en el historial.</div>`;

  const html = `
    <div class="clab-opt-bg" onclick="clabCloseExplorer()"></div>
    <div class="clab-opt-dlg" onclick="event.stopPropagation()">
      <div class="clab-opt-hdr" style="background:linear-gradient(90deg,#1a1f3a,#1e2740)">
        <span>🎲 Explorador de Variantes Experimentales</span>
        <button class="clab-modal-close" onclick="clabCloseExplorer()" title="Cerrar">✕</button>
      </div>
      <div class="clab-opt-body">
        <div style="font-size:12px;color:var(--tx3);margin-bottom:12px">
          Variantes generadas desde el perfil bioquímico actual ·
          Score base: <b style="color:${scoreColor(result.currentScore || 0)}">${(result.currentScore || 0).toFixed(1)}/100</b>
        </div>
        <div class="clab-opt-cards">${cardsHTML}</div>
      </div>
    </div>`;

  const modal = document.createElement('div');
  modal.id = 'clab-explorer-modal';
  modal.className = 'clab-opt-modal';
  modal.style.zIndex = '10001';
  modal.innerHTML = html;
  document.body.appendChild(modal);
}

function clabCloseExplorer() {
  const modal = document.getElementById('clab-explorer-modal');
  if (modal) modal.remove();
}

/**
 * Aplica una variante del explorador al Modo libre.
 * Merge aditivo: ingredientes actuales + cambios de la variante.
 */
function clabApplyExplorerVariant(variantId) {
  const v = (_state.explorerVariants || []).find(x => x.id === variantId);
  if (!v) { notif('Variante no encontrada', 'err'); return; }
  const ingRows = _getEffectiveIngs();
  _state.libreIngs = {};
  ingRows.forEach(r => { if ((r.qty || 0) > 0) _state.libreIngs[r.id] = r.qty; });
  (v.cambios || []).forEach(ch => {
    if (ch.ingId && ch.qty > 0) _state.libreIngs[ch.ingId] = ch.qty;
  });
  clabCloseExplorer();
  _state.mode = 'libre';
  document.querySelectorAll('.clab-mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'libre'));
  notif(`Variante ${variantId} cargada en Modo libre`, 'ok');
  renderAnalyzer();
}

function clabApplyOptimizerScenario(scenarioId) {
  const result = _state.lastOptimizerResult;
  if (!result) return;
  const scenario = result.scenarios[scenarioId];
  if (!scenario) return;
  // Cargar proyección directamente en libreIngs — sin pasar por clabSetMode()
  // para no sobreescribir con los valores de la fórmula base.
  _state.libreIngs = {};
  scenario.projRows.forEach(row => {
    if ((row.qty || 0) > 0) _state.libreIngs[row.id] = row.qty;
  });
  // Activar modo libre manualmente (sólo UI + render)
  _state.mode = 'libre';
  document.querySelectorAll('.clab-mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'libre'));
  notif(`Escenario ${scenarioId} cargado en Modo libre`, 'ok');
  renderAnalyzer();
}

// ════════════════════════════════════════════
// INIT / UNLOAD
// ════════════════════════════════════════════
let _docKeyHandler = null;
let _ingsChangedHandler = null;
let _storageHandler = null;

function _refreshAfterIngredientesChanged() {
  updateHeaderStats();
  const anal = document.getElementById('clab-sub-analizador');
  const biblio = document.getElementById('clab-sub-biblioteca');
  const strain = document.getElementById('clab-sub-strain');
  const ensayos = document.getElementById('clab-sub-ensayos');
  if (anal && anal.style.display !== 'none') renderAnalyzer();
  if (biblio && biblio.style.display !== 'none') renderBiblio();
  if (strain && strain.style.display !== 'none') renderStrain();
  if (ensayos && ensayos.style.display !== 'none') renderEnsayos();
  const conoc = document.getElementById('clab-sub-conocimiento');
  if (conoc && conoc.style.display !== 'none' && typeof renderConocimiento === 'function') renderConocimiento();
}

// ════════════════════════════════════════════
// AUTO-SEED DE INGREDIENTES DESDE JSON CANÓNICO
// Carga biolab_ingredientes v4.json si bl2_ings no tiene los datos bio completos.
// Idempotente: usa versión stamp 'bl2_ings_seed_v' para no re-seedear en cada init.
// Preserva datos existentes (merge, no overwrite) — safe para datos legacy.
// ════════════════════════════════════════════
const _INGREDIENTS_SEED_VERSION = 'v5'; // v5: +lecitina soja, +ac.ascorbico, +remolacha

function _autoSeedIngredientsV4() {
  // Verificar si ya seeded con esta versión
  try {
    if (localStorage.getItem('bl2_ings_seed_v') === _INGREDIENTS_SEED_VERSION) return;
  } catch(e) { return; }

  // Ruta relativa al JSON canónico (mismo directorio que cilab_index.html)
  const jsonPath = './biolab_ingredientes%20v4.json';

  fetch(jsonPath)
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      if (!Array.isArray(data) || !data.length) throw new Error('JSON vacío o formato inválido');

      const ingsCurrent = gArr(K.ings);
      const ingsMap = {};
      ingsCurrent.forEach(function(i) { ingsMap[i.id] = i; });

      let creados = 0, actualizados = 0;
      data.forEach(function(item) {
        if (!item || !item.id) return;
        const prev = ingsMap[item.id] || {};
        // Merge conservador: los campos base solo se setean si no existen
        const base = {
          id:      item.id,
          nombre:  item.nombre  != null ? item.nombre  : (prev.nombre  || ''),
          unidad:  item.unidad  != null ? item.unidad  : (prev.unidad  || 'gr'),
          aspecto: item.aspecto != null ? item.aspecto : (prev.aspecto || ''),
          pc:      item.pc      != null ? item.pc      : (prev.pc      != null ? prev.pc : null),
          pn:      item.pn      != null ? item.pn      : (prev.pn      != null ? prev.pn : null),
          notas:   item.notas   != null ? item.notas   : (prev.notas   || ''),
        };
        if (ingsMap[item.id]) { actualizados++; } else { creados++; }
        ingsMap[item.id] = Object.assign({}, prev, base);
        // bio: merge — los campos bio del JSON v4 ganan sobre legacy seed simple,
        // pero si el usuario editó manualmente (updatedAt posterior), se preserva.
        if (item.bio && typeof item.bio === 'object') {
          const prevBio   = prev.bio || {};
          const prevTs    = prevBio.updatedAt ? new Date(prevBio.updatedAt).getTime() : 0;
          const seedTs    = item.bio.updatedAt ? new Date(item.bio.updatedAt).getTime() : 0;
          // Si el usuario tiene datos más recientes que el seed, no piso
          const userHasNewer = prevTs > 0 && prevTs > seedTs && !prevBio.seeded;
          if (!userHasNewer) {
            ingsMap[item.id].bio = Object.assign({}, prevBio, item.bio, { updatedAt: item.bio.updatedAt || now() });
          }
        }
      });

      const ingsNew = Object.values(ingsMap);
      const snapIngs = localStorage.getItem(K.ings);
      try {
        if (!s(K.ings, ingsNew)) throw new Error('Write falló (¿cuota?)');
        localStorage.setItem('bl2_ings_seed_v', _INGREDIENTS_SEED_VERSION);
        console.log('[CILAB] auto-seed v4: ' + creados + ' creados, ' + actualizados + ' actualizados');
        _dispatchIngsChanged({ tipo: 'auto-seed-v4', count: data.length });
        // Re-render para que el grafo refleje los nuevos datos
        renderAnalyzer();
        updateHeaderStats();
      } catch(err) {
        // Rollback ante error de escritura
        try {
          if (snapIngs !== null) localStorage.setItem(K.ings, snapIngs);
          else localStorage.removeItem(K.ings);
        } catch(_) {}
        console.error('[CILAB] auto-seed rollback:', err);
      }
    })
    .catch(function(err) {
      // No bloquear init si el fetch falla (modo offline, etc.)
      console.warn('[CILAB] auto-seed fetch falló (no crítico):', err.message);
    });
}

function cilabInit() {
  // Sembrar metadata si corresponde (idempotente)
  try { seedMetaIfNeeded(); } catch (e) { console.warn('[CILAB] seed falló:', e); }

  // Auto-seed desde JSON canónico v4 (async, no bloquea init)
  _autoSeedIngredientsV4();

  updateHeaderStats();

  // Subtab por defecto
  clabSubTab('analizador');

  // Listener Esc → cerrar detail panel
  if (_docKeyHandler) document.removeEventListener('keydown', _docKeyHandler);
  _docKeyHandler = function (e) {
    if (e.key === 'Escape') clabCloseDetail();
  };
  document.addEventListener('keydown', _docKeyHandler);

  if (_ingsChangedHandler) window.removeEventListener('cilab-ings-changed', _ingsChangedHandler);
  if (_storageHandler) window.removeEventListener('storage', _storageHandler);
  _ingsChangedHandler = function () { _refreshAfterIngredientesChanged(); };
  _storageHandler = function (e) {
    if (e.key === K.ings || e.key === K.meta) _refreshAfterIngredientesChanged();
    // Handoff CI → CILAB (cross-tab): consumir pending action sin navegar a Conocimiento (C2)
    if (e.key === 'bl2_pending_crec_action' && typeof _creConsumePendingAction === 'function') {
      _creConsumePendingAction();
    }
  };
  window.addEventListener('cilab-ings-changed', _ingsChangedHandler);
  window.addEventListener('storage', _storageHandler);

  // Hoist del detail panel al body para escapar stacking contexts del loader
  _hoistDetailPanel();

  console.log('[CILAB] Módulo inicializado — BIOLAB ENGINE v3');
}

function _hoistDetailPanel() {
  ['clab-detail-panel', 'clab-detail-backdrop', 'clab-notif', 'clab-newform-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentNode !== document.body) document.body.appendChild(el);
  });
}

function cilabUnload() {
  if (_docKeyHandler) {
    document.removeEventListener('keydown', _docKeyHandler);
    _docKeyHandler = null;
  }
  if (_notifTimer) { clearTimeout(_notifTimer); _notifTimer = null; }
  _destroyStrainChart();
  if (_ingsChangedHandler) {
    window.removeEventListener('cilab-ings-changed', _ingsChangedHandler);
    _ingsChangedHandler = null;
  }
  if (_storageHandler) {
    window.removeEventListener('storage', _storageHandler);
    _storageHandler = null;
  }
  // Retirar los nodos hoisteados al body. Si los dejamos, persisten al cambiar
  // de módulo y, peor, quedan sin estilos cuando el loader limpia cilab_styles.css
  // — el panel se haría visible sin transform.
  ['clab-detail-panel', 'clab-detail-backdrop', 'clab-notif', 'clab-newform-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentNode === document.body) el.remove();
  });
}

// ════════════════════════════════════════════
// EXPOSICIÓN AL SCOPE GLOBAL
// ════════════════════════════════════════════
Object.assign(window, {
  // init / unload
  cilabInit,
  // Subtabs
  clabSubTab,
  // Utilidades internas expuestas para cilab_conocimiento.js (mismo origen, scope separado)
  _cilab_esc:              esc,
  _cilab_notif:            notif,
  _cilab_now:              now,
  _cilab_gArr:             gArr,
  _cilab_s:                s,
  _cilab_readIngredientes: readIngredientes,
  _cilab_readForms:        readForms,
  _cilab_calcEstadoRutas:  calcEstadoRutas,
  _cilab_calcCN:           calcCN,
  _cilab_calcRizomorfico:  calcRizomorfico,
  _cilab_SIGNAL_BANK:              SIGNAL_BANK,
  _cilab_sortSignals:              sortSignalsByRelevance,
  _cilab_attributeSignal:          attributeSignalToIngredients,
  _cilab_calcRecomendaciones: calcRecomendaciones,
  _cilab_loadMeta:            loadMeta,
  _cilab_getActiveFormulaId:  function() { return _state.formulaId || null; },
  // Analizador
  clabSetMode,
  clabOnFormulaChange,
  clabOnCepaChange,
  clabOnSliderChange,
  clabOnFormulaSliderChange,
  clabRestoreOriginal,
  clabOpenNewFormModal,
  clabOpenNewFormModalFromOptimizer,
  clabOpenNewFormModalFromLibre,
  clabCloseNewFormModal,
  clabCreateNewFormula,
  clabApplySuggestion,
  clabApplySuggestionFromBtn,
  clabCopiarSugerencia,
  clabAddLibreIng,
  clabRenderExpFrascos,
  clabLoadFrascoInAnalyzer,
  clabClearFrascoMode,
  _cilab_getNormalizedFrascoIngs: _getNormalizedFrascoIngs,
  _cilab_readGenetics:            readGenetics,
  // Optimizador
  clabOpenOptimizer,
  clabOptCepaChange,
  clabApplyOptimizerScenario,
  clabApplyScenarioDFromTab,
  clabNewCIFromScenarioD,
  clabApplyFICandidate,
  clabNewCIFICandidate,
  clabOpenExplorer,
  clabCloseExplorer,
  clabApplyExplorerVariant,
  // Detail panel y CRUD
  clabOpenRouteDetail,
  clabOpenInteractionDetail,
  clabOpenIngDetail,
  clabCloseDetail,
  clabGraphHover,
  clabGraphHoverEnd,
  clabSaveIngAll,
  clabResetSeed,
  clabToggleRoute,
  clabClearRouteOverrides,
  clabToggleIngDisabled,
  clabMigrarBioDesdeLegacy: migrateLegacyMetaToIngBio,
  detectActiveInteractions,
  cilabCrearIngrediente,
  cilabGuardarNuevoIngrediente,
  cilabEliminarIngrediente,
  // Biblioteca
  clabRenderBiblio: renderBiblio,
  clabToggleGlosario,
  clabExportIngredientes,
  clabTriggerImport,
  clabOnImportFileChange,
  clabUpdateContribSum,
  clabSaveContribuciones,
  // Strain
  clabRenderStrain: renderStrain,
  clabApplyStrainRange,
  // Ensayos
  clabSaveObs,
  clabClearObsForm,
  clabOnObsFormulaChange,
  clabRenderObsLog: renderObsLog,
  clabDeleteObs,
  // Conocimiento — expuesto para CI (📊 handoff) y para HTML inline
  // (renderConocimiento y las funciones cre* viven en cilab_conocimiento.js,
  //  que se carga después de este archivo. El guard typeof evita errores
  //  si conocimiento.js no está presente.)
  get renderConocimiento()    { return typeof renderConocimiento    === 'function' ? renderConocimiento    : undefined; },
});

window.onModuleUnload = cilabUnload;

})();
