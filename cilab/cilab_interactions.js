/* ═══════════════════════════════════════════════════════════════════════════
   BIOLAB ENGINE — CILAB · INTERACCIONES CRÍTICAS
   cilab_interactions.js

   Fuente de verdad de todas las interacciones cruzadas entre ingredientes
   que afectan el flujo metabólico fúngico (Psilocybe cubensis).

   Este archivo es SOLO datos. No contiene lógica de evaluación.
   La lógica vive en cilab_app.js: detectActiveInteractions(),
   buildInteractionOverlaysSVG(), buildAlertsList().

   ─────────────────────────────────────────────────────────────────────────────
   CÓMO AGREGAR UNA NUEVA INTERACCIÓN

   1. PRÓXIMO ID DISPONIBLE: INT-050
      Formato: "INT-" + número de 3 dígitos con cero a la izquierda.
      NO reutilizar IDs de interacciones eliminadas.

   2. Agregar al final del array, ANTES del cierre `];`
      Separar con coma del elemento anterior.

   3. SCHEMA OBLIGATORIO:
      {
        "id": "INT-NNN",
        "nombre": "Descripción breve (no duplicar el msg)",
        "severity": "sinergia" | "atencion" | "critica",
        "ingredientes": ["ING-XXXX"],          // IDs de ingredientes trigger
        "rutasAfectadas": ["N1_GLYC"],         // IDs de rutas del motor
        "condicion": "ambos_presentes" | "ausencia_complementaria",
        "ingAusente": "ING-XXXX" | null,       // Solo en ausencia_complementaria
        "msg": "Texto técnico preciso con mecanismo y solución si aplica.",
        "locked": true
      }

   4. RUTAS VÁLIDAS DEL MOTOR:
      N0_GRADIENT   Gradiente nutricional (señal direccional)
      N1_GLYC       Glucólisis → Krebs → ATP
      N1_ETC        Cadena respiratoria (ETC)
      N2_ODC        Síntesis de poliaminas (ODC) — requiere Arg
      N2_NO_PKG     NO → GMPc → PKG — requiere Arg como sustrato fNOS
      N2_CAMP       cAMP → PKA — señalización de carbono
      N2_AUTOPHAGY  Autofagia regulada por TOR
      N2_REDOX      Glutatión / escudo oxidativo
      N3_SAM        SAM → Espermina — requiere Met + B12
      N3_CHITIN     Síntesis de quitina — requiere Mg²⁺ + Gly
      N3_SPITZ      Spitzenkörper (Ca²⁺) — requiere Ca libre
      N3_ZINC       Zinc libre para RNA pol II y metiltransferasas apicales
      N3_MEMBRANE   Membranas apicales (peroxidación lipídica)
      RIZO          Output — NO usar como ruta de ingredientes

   5. CONDICIONES:
      "ambos_presentes"         → activa cuando TODOS los "ingredientes[]"
                                   tienen qty > 0 en la fórmula activa.
      "ausencia_complementaria" → activa cuando "ingredientes[]" presentes
                                   PERO "ingAusente" está ausente (qty = 0).

   6. DESPUÉS DE AGREGAR:
      - No requiere cambios en cilab_app.js ni en cilab_index.html.
      - La interacción se evalúa automáticamente en la próxima carga del motor.
      - Verificar en CILAB → 🔬 Analizador que aparece en el panel de alertas.
      - Si la interacción está vinculada a un ingrediente nuevo, primero
        importar el ingrediente en CILAB → 🧪 Biblioteca → ⬆ Importar JSON.

   DEPENDENCIAS: ninguna. Este archivo no importa ni requiere otros módulos.
   CARGA: ANTES de cilab_app.js (declarado en cilab_index.html).
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/**
 * Interacciones críticas entre ingredientes que afectan el flujo metabólico.
 *
 * Próximo ID disponible: INT-050
 *
 * Evaluado por:  detectActiveInteractions()      en cilab_app.js
 * Renderizado en: buildInteractionOverlaysSVG()  en cilab_app.js
 *                 buildAlertsList()               en cilab_app.js
 */
const CRITICAL_INTERACTIONS = [
  {
    "id": "INT-001",
    "nombre": "Si coexiste con extracto de levadura ...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0005",
      "ING-0012"
    ],
    "rutasAfectadas": [
      "N1_ETC",
      "N2_ODC",
      "N3_SAM"
    ],
    "condicion": "ambos_presentes",
    "msg": "Si coexiste con extracto de levadura (ING-0012), evaluar la carga total de nitrógeno: la suma de ambos puede elevar el N disponible por encima del óptimo C/N, generando micelio tomentoso por exceso de N.",
    "locked": true
  },
  {
    "id": "INT-002",
    "nombre": "Sinergia con Citrulina malato (ING-00...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0006",
      "ING-0017"
    ],
    "rutasAfectadas": [
      "N2_ODC",
      "N2_NO_PKG"
    ],
    "condicion": "ambos_presentes",
    "msg": "Sinergia con Citrulina malato (ING-0017): la citrulina eleva el pool de arginina endógena vía ciclo de la urea (citrulina + aspartato → argininosuccinato → arginina), amplificando tanto la vía fNOS como la ODC. La concentración efectiva combinada puede superar el umbral crítico aunque la arginina exógena esté dentro del rango óptimo. Calcular la concentración equivalente de arginina como: [Arg] + [Cit]*0.6.",
    "locked": true
  },
  {
    "id": "INT-003",
    "nombre": "Competencia con L-Glutamina (ING-0016...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0006",
      "ING-0016"
    ],
    "rutasAfectadas": [
      "N2_ODC",
      "N2_NO_PKG"
    ],
    "condicion": "ambos_presentes",
    "msg": "Competencia con L-Glutamina (ING-0016) por transportadores de aminoácidos del sistema y+: alta concentración de arginina puede reducir la captación de glutamina. Mantener ratio Arg:Gln < 3:1 en masa.",
    "locked": true
  },
  {
    "id": "INT-004",
    "nombre": "PRECIPITACIÓN CON CaCO₃ (ING-0010)",
    "severity": "critica",
    "ingredientes": [
      "ING-0007",
      "ING-0010"
    ],
    "rutasAfectadas": [
      "N1_GLYC",
      "N3_SPITZ"
    ],
    "condicion": "ambos_presentes",
    "msg": "PRECIPITACIÓN CON CaCO₃ (ING-0010): el ion fosfato (H₂PO₄⁻/HPO₄²⁻) reacciona con Ca²⁺ en solución formando fosfato cálcico tribásico [Ca₃(PO₄)₂, Ksp=1.2×10⁻²⁹] e hidroxiapatita. A pH del agar (6.0-7.0) y temperatura de vertido (55-60°C) la precipitación es inmediata y cuantitativa. Resultado: Ca²⁺ libre ≈ 0 y PO₄³⁻ biodisponible ≈ 0, aunque ambos estén presentes en la fórmula. SOLUCIÓN: reemplazar CaCO₃ por CaCl₂ (ING-0020), que no precipita con fosfatos.",
    "locked": true
  },
  {
    "id": "INT-005",
    "nombre": "Sinergia obligatoria con ATP",
    "severity": "atencion",
    "ingredientes": [
      "ING-0008"
    ],
    "rutasAfectadas": [
      "N1_ETC",
      "N3_CHITIN"
    ],
    "condicion": "ambos_presentes",
    "msg": "Sinergia obligatoria con ATP: el Mg²⁺ forma el complejo Mg-ATP que es el sustrato real de todas las ATPasas, kinasas y la ATP sintasa mitocondrial. Sin Mg²⁺ suficiente, el ATP libre (sin Mg) tiene afinidad 10-100x menor por estos enzimas — el pool de ATP puede ser alto pero funcionalmente inactivo.",
    "locked": true
  },
  {
    "id": "INT-006",
    "nombre": "Los comprimidos contienen excipientes...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0009"
    ],
    "rutasAfectadas": [
      "N1_GLYC",
      "N1_ETC",
      "N2_ODC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Los comprimidos contienen excipientes con calcio (fosfato dicálcico). A 2+ comprimidos/L el Ca²⁺ aportado por excipientes puede ser relevante si no hay otras fuentes de Ca. Considerar al calcular la carga total de Ca²⁺ en la fórmula.",
    "locked": true
  },
  {
    "id": "INT-007",
    "nombre": "PRECIPITACIÓN CON KH₂PO₄ (ING-0007)",
    "severity": "critica",
    "ingredientes": [
      "ING-0010",
      "ING-0007"
    ],
    "rutasAfectadas": [
      "N3_SPITZ"
    ],
    "condicion": "ambos_presentes",
    "msg": "PRECIPITACIÓN CON KH₂PO₄ (ING-0007): el Ca²⁺ de CaCO₃ reacciona con el fosfato de KH₂PO₄ formando fosfato cálcico tribásico [Ca₃(PO₄)₂] e hidroxiapatita [Ca₅(PO₄)₃OH], ambos prácticamente insolubles a pH fisiológico (Ksp ≈ 10⁻²⁹). La precipitación ocurre durante la preparación del medio a 55-60°C. El resultado es Ca²⁺ libre ≈ 0 para el Spitzenkörper. SOLUCIÓN DEFINITIVA: usar CaCl₂ (ING-0020) cuando la fórmula contiene KH₂PO₄.",
    "locked": true
  },
  {
    "id": "INT-008",
    "nombre": "Si coexiste con levadura de cerveza (...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0011",
      "ING-0005"
    ],
    "rutasAfectadas": [
      "N1_ETC",
      "N2_ODC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Si coexiste con levadura de cerveza (ING-0005) o extracto de levadura (ING-0012), la carga total de N puede superar el óptimo C/N. Calcular la suma de N aportado (pn × cantidad) entre todos los ingredientes nitrogenados y verificar que el C/N resultante esté en rango (6-18).",
    "locked": true
  },
  {
    "id": "INT-009",
    "nombre": "Si coexiste con levadura de cerveza (...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0012",
      "ING-0005"
    ],
    "rutasAfectadas": [
      "N1_ETC",
      "N2_ODC",
      "N3_SAM"
    ],
    "condicion": "ambos_presentes",
    "msg": "Si coexiste con levadura de cerveza (ING-0005): el extracto de levadura aporta el mismo perfil de vitaminas B pero en forma libre e inmediatamente disponible, mientras que la levadura de cerveza las libera lentamente. La combinación genera un perfil bifásico: disponibilidad inmediata (extracto) + liberación sostenida (levadura entera). Esto es sinérgico, pero la carga total de N debe calcularse como suma de ambos para verificar C/N.",
    "locked": true
  },
  {
    "id": "INT-010",
    "nombre": "Si coexiste con Pharmaton G115 (ING-0...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0014",
      "ING-0009"
    ],
    "rutasAfectadas": [
      "N1_GLYC",
      "N1_ETC",
      "N2_ODC",
      "N3_SPITZ"
    ],
    "condicion": "ambos_presentes",
    "msg": "Si coexiste con Pharmaton G115 (ING-0009): ambos aportan tiamina, Zn y Mn. Calcular la carga total de cada micronutriente sumando ambas fuentes para evitar acumulación por encima del rango seguro de cada uno.",
    "locked": true
  },
  {
    "id": "INT-011",
    "nombre": "El ácido ascórbico (vitamina C) prese...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0014",
      "ING-0023"
    ],
    "rutasAfectadas": [
      "N1_GLYC",
      "N1_ETC",
      "N2_ODC",
      "N3_SPITZ"
    ],
    "condicion": "ambos_presentes",
    "msg": "El ácido ascórbico (vitamina C) presente en esta fórmula puede reducir Fe³⁺ a Fe²⁺ en solución, aumentando la biodisponibilidad del hierro de otras fuentes. Es sinérgico con Sulfato de hierro (ING-0023) pero puede generar exceso de Fe²⁺ libre si ambos están en rango alto — el Fe²⁺ libre cataliza la reacción de Fenton (Fe²⁺ + H₂O₂ → Fe³⁺ + OH• + OH⁻) produciendo daño oxidativo.",
    "locked": true
  },
  {
    "id": "INT-012",
    "nombre": "Si coexiste con Tiamina complex (ING-...",
    "severity": "critica",
    "ingredientes": [
      "ING-0015",
      "ING-0014"
    ],
    "rutasAfectadas": [
      "N1_GLYC",
      "N3_SPITZ"
    ],
    "condicion": "ambos_presentes",
    "msg": "Si coexiste con Tiamina complex (ING-0014) o Pharmaton G115 (ING-0009): ambos también aportan tiamina. Calcular la carga total de B1 entre todas las fuentes. La tiamina libre es estable en solución ácida pero se degrada rápidamente a pH >7 y a temperaturas de esterilización (121°C, 15min). Se recomienda agregar la solución de tiamina DESPUÉS de autoclavar o usar filtro estéril, si la concentración es crítica.",
    "locked": true
  },
  {
    "id": "INT-013",
    "nombre": "Competencia con L-Arginina (ING-0006)...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0016",
      "ING-0006"
    ],
    "rutasAfectadas": [
      "N1_ETC",
      "N2_ODC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Competencia con L-Arginina (ING-0006) por transportadores de aminoácidos del sistema y+: mantener ratio Arg:Gln < 3:1 en masa para evitar inhibición competitiva de la captación de glutamina.",
    "locked": true
  },
  {
    "id": "INT-014",
    "nombre": "SINERGIA CON L-ARGININA (ING-0006)",
    "severity": "sinergia",
    "ingredientes": [
      "ING-0017",
      "ING-0006"
    ],
    "rutasAfectadas": [
      "N1_ETC",
      "N2_ODC",
      "N2_NO_PKG"
    ],
    "condicion": "ambos_presentes",
    "msg": "SINERGIA CON L-ARGININA (ING-0006): la citrulina se convierte en arginina por argininosuccinato sintasa (ASS) + argininosuccinato liasa (ASL) usando aspartato como donante de N. La arginina endógena resultante amplifica la actividad fNOS y ODC. CÁLCULO DE EQUIVALENCIA: considerar [Arg_efectiva] = [Arg_exógena] + [Cit] × 0.55 (factor de conversión aproximado en hongos, asumiendo que ~55% de la citrulina se convierte en arginina). Esta equivalencia evita superar el umbral crítico de 3.5 g/L de arginina efectiva.",
    "locked": true
  },
  {
    "id": "INT-015",
    "nombre": "REGLA CRÍTICA: Glicina obligatoria con Metionina",
    "severity": "critica",
    "ingredientes": [
      "ING-0025",
      "ING-0019"
    ],
    "rutasAfectadas": [
      "N3_SAM",
      "N3_CHITIN"
    ],
    "condicion": "ambos_presentes",
    "msg": "SINERGIA CRÍTICA Glicina (ING-0025) + L-Metionina (ING-0019): la glicina recicla la homocisteína generada por el metabolismo de metionina vía ciclo de folatos (SHMT + metionina sintasa). Sin glicina, la homocisteína se acumula e inhibe la quitina sintetasa → daño en N3_CHITIN. REGLA: siempre agregar Glicina (Glicocola) 100mg/L cuando se usa L-Metionina.",
    "locked": true
  },
  {
    "id": "INT-016",
    "nombre": "ALERTA: Metionina sin Glicina — homocisteína",
    "severity": "critica",
    "ingredientes": [
      "ING-0019"
    ],
    "rutasAfectadas": [
      "N3_SAM",
      "N3_CHITIN"
    ],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0025",
    "msg": "ALERTA: L-Metionina presente SIN Glicina (Glicocola, ING-0025). La homocisteína generada por el metabolismo de metionina se acumula e inhibe enzimas de síntesis de quitina → N3_CHITIN comprometida. SOLUCIÓN: agregar Glicina (Glicocola) 100mg/L mínimo.",
    "locked": true
  },
  {
    "id": "INT-017",
    "nombre": "Alternativa superior a CaCO₃ (ING-001...",
    "severity": "sinergia",
    "ingredientes": [
      "ING-0020",
      "ING-0010"
    ],
    "rutasAfectadas": [
      "N3_SPITZ"
    ],
    "condicion": "ambos_presentes",
    "msg": "Alternativa superior a CaCO₃ (ING-0010) cuando coexiste KH₂PO₄ (ING-0007): CaCl₂ es altamente soluble (745 g/L a 20°C) y no precipita con fosfatos en el rango de concentraciones usadas en medios de cultivo. El Ca²⁺ queda completamente biodisponible.",
    "locked": true
  },
  {
    "id": "INT-018",
    "nombre": "Competencia con Cu²⁺ (ING-0022) por e...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0021",
      "ING-0022"
    ],
    "rutasAfectadas": [
      "N2_ODC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Competencia con Cu²⁺ (ING-0022) por el transportador ZIP/ZnT (ZRT/IRT-like proteins): altas concentraciones de Zn²⁺ inhiben la captación de Cu²⁺ porque ambos comparten transportadores de metales divalentes. Mantener ratio Zn:Cu < 10:1 en masa para evitar deficiencia inducida de Cu.",
    "locked": true
  },
  {
    "id": "INT-019",
    "nombre": "Los fitatos de la Peptona de soja (IN...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0021",
      "ING-0011"
    ],
    "rutasAfectadas": [
      "N2_ODC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Los fitatos de la Peptona de soja (ING-0011) pueden quelar Zn²⁺ formando complejos Zn-fitato de muy baja solubilidad, reduciendo la biodisponibilidad del zinc si ambos coexisten. La forma quelada orgánica (glicinato) es más resistente a la quelación por fitatos que el ZnSO₄.",
    "locked": true
  },
  {
    "id": "INT-020",
    "nombre": "INTERACCIÓN CON L-ARGININA (ING-0006)...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0022",
      "ING-0006"
    ],
    "rutasAfectadas": [
      "N1_ETC"
    ],
    "condicion": "ambos_presentes",
    "msg": "INTERACCIÓN CON L-ARGININA (ING-0006) — CONTRABALANCE DEL COMPLEJO IV: el Cu²⁺ es el cofactor del sitio CuA/CuB del Complejo IV (citocromo c oxidasa). Un nivel adecuado de Cu permite que el Complejo IV opere con mayor velocidad máxima (Vmax), parcialmente compensando la inhibición por NO que genera la arginina en exceso. No es antídoto completo pero sí modifica el umbral de inhibición.",
    "locked": true
  },
  {
    "id": "INT-021",
    "nombre": "Competencia con Zn²⁺ (ING-0021) por t...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0022",
      "ING-0021"
    ],
    "rutasAfectadas": [
      "N1_ETC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Competencia con Zn²⁺ (ING-0021) por transportadores ZIP: el Cu²⁺ inhibe la captación de Zn²⁺ a través de transportadores compartidos. Mantener ratio Zn:Cu > 2:1 en masa para que el Zn no quede limitado por exceso de Cu.",
    "locked": true
  },
  {
    "id": "INT-022",
    "nombre": "Sinergia con ácido ascórbico (Tiamina...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0023"
    ],
    "rutasAfectadas": [
      "N1_ETC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Sinergia con ácido ascórbico (Tiamina complex, ING-0014): el ascorbato reduce Fe³⁺ → Fe²⁺, aumentando la biodisponibilidad del hierro. Es sinérgico a concentraciones normales pero puede generar exceso de Fe²⁺ libre catalítico de reacción de Fenton si ambos están en rango alto. Calcular la carga total de Fe²⁺ libre considerando la reducción por ascorbato.",
    "locked": true
  },
  {
    "id": "INT-023",
    "nombre": "Competencia con Zn²⁺ (ING-0021) por e...",
    "severity": "atencion",
    "ingredientes": [
      "ING-0023",
      "ING-0021"
    ],
    "rutasAfectadas": [
      "N1_ETC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Competencia con Zn²⁺ (ING-0021) por el transportador DMT1/Fet3 (divalent metal transporter): el Fe²⁺ y el Zn²⁺ compiten por el mismo transportador de metales divalentes en la membrana plasmática. Concentraciones altas de Fe pueden reducir la captación de Zn y viceversa. Mantener ratio Fe:Zn < 5:1 en masa.",
    "locked": true
  },
  {
    "id": "INT-024",
    "nombre": "Becozym + Pharmaton — duplicación espectro B",
    "severity": "atencion",
    "ingredientes": [
      "ING-0024",
      "ING-0009"
    ],
    "rutasAfectadas": [
      "N1_GLYC",
      "N1_ETC",
      "N2_ODC"
    ],
    "condicion": "ambos_presentes",
    "msg": "Becozym (ING-0024) + Pharmaton G115 (ING-0009) duplican el espectro B. B6 total hasta 12mg/L — dentro del rango seguro pero no agregar otras fuentes de B6. B1 total hasta 16.4mg/L — seguro (<50mg/L). La combinación es válida y sinérgica para cubrir B3 y B5 que Pharmaton tiene bajo, pero calcular la carga total antes de agregar Tiamina complex.",
    "locked": true
  },
  {
    "id": "INT-025",
    "nombre": "Glicina + Becozym — ciclo completo folatos",
    "severity": "sinergia",
    "ingredientes": [
      "ING-0025",
      "ING-0024"
    ],
    "rutasAfectadas": [
      "N3_SAM"
    ],
    "condicion": "ambos_presentes",
    "msg": "SINERGIA: Glicina (ING-0025) + Becozym (ING-0024) vía B12. La cianocobalamina del Becozym (10mcg/comprimido) es cofactor de la metionina sintasa (EC 2.1.1.13) que regenera metionina desde homocisteína. La glicina aporta el THF necesario para esa reacción. Glicina + B12 (Becozym) + Metionina forman un ciclo completo y autorregulado más eficiente que cualquiera solo.",
    "locked": true
  },
  {
    "id": "INT-026",
    "nombre": "ALERTA CRÍTICA: Metionina sin Glicina activa",
    "severity": "critica",
    "ingredientes": [
      "ING-0019"
    ],
    "rutasAfectadas": [
      "N3_SAM",
      "N3_CHITIN"
    ],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0025",
    "msg": "L-Metionina detectada en la fórmula. Verificar que Glicina (Glicocola, ING-0025) esté presente a mínimo 100mg/L. Sin glicina, la homocisteína generada por el metabolismo de metionina se acumula e inhibe la quitina sintetasa → N3_CHITIN comprometida → hifas con pared celular debilitada.",
    "locked": true
  },
  {
    "id": "INT-027",
    "nombre": "Freno SAH — Metionina sin recicladores de homocisteína",
    "severity": "critica",
    "ingredientes": ["ING-0019"],
    "rutasAfectadas": ["N3_SAM"],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0024",
    "msg": "L-Metionina (ING-0019) activa SIN recicladores de SAH detectados. El ciclo SAM→metilación→SAH acumula S-adenosil-homocisteína, inhibidor competitivo de todas las SAM-metiltransferasas (Ki ≈ 1–10 µM). La ratio SAH/SAM sube por encima de 0.4 → frena metilaciones del ARNr y fosfolípidos apicales aunque el pool SAM sea alto. MECANISMO: SAH + H₂O → adenosina + homocisteína (SAH hidrolasa); homocisteína + CH₃ → metionina vía metionina sintasa (requiere B12 como cofactor, EC 2.1.1.13). SOLUCIÓN: agregar Becozym (ING-0024) como fuente de B12 (cianocobalamina 10mcg/comprimido). Dosis mínima efectiva: 0.5 comprimido/L. La betaína (vía BHMT) sería alternativa; pendiente de registro como ingrediente.",
    "locked": true
  },
  {
    "id": "INT-028",
    "nombre": "Exceso de carbono → PKA hiperactivo → supresión de autofagia",
    "severity": "atencion",
    "ingredientes": ["ING-0021", "ING-0023"],
    "rutasAfectadas": ["N2_CAMP", "N2_AUTOPHAGY"],
    "condicion": "ambos_presentes",
    "msg": "NOTA ARQUITECTURAL: INT-028 está pendiente de IDs definitivos para fuentes de carbono concentradas (melaza, miel, glucosa pura). Mientras tanto: cuando Zn y Fe de alta densidad coexisten con múltiples fuentes de carbono, la ETC hiperactiva eleva el cAMP basal y PKA puede quedar sobre-estimulado. Exceso de PKA activo suprime el eje TOR-autophagy → proteínas dañadas se acumulan en hifas activas → N2_AUTOPHAGY pierde eficiencia. El rango óptimo de C total para rizomorfismo es C/N entre 6 y 18. Por encima de C/N 22 el PKA queda hiperestimulado. SOLUCIÓN: reducir la fuente de carbono principal hasta C/N ≤ 18.",
    "locked": true
  },
  {
    "id": "INT-029",
    "nombre": "Zn + Fe — competencia por metalotioneínas, baja Zn libre para RNA pol II",
    "severity": "atencion",
    "ingredientes": ["ING-0021", "ING-0023"],
    "rutasAfectadas": ["N3_ZINC", "N2_ODC"],
    "condicion": "ambos_presentes",
    "msg": "Zinc (ING-0021) y hierro (ING-0023) presentes simultáneamente. El Fe²⁺ compite con Zn²⁺ por las metalotioneínas citoplasmáticas (proteínas de almacenamiento de metales), reduciendo el pool de Zn²⁺ libre disponible para RNA polimerasa II y metiltransferasas apicales (N3_ZINC). La concentración efectiva de Zn puede ser mucho menor que la total aportada. CÁLCULO: mantener ratio Fe:Zn < 5:1 en masa para preservar la biodisponibilidad del zinc. Si Fe > 5×Zn: N3_ZINC queda funcionalmente limitado aunque la cantidad de Zn en la fórmula sea correcta. Verificar también INT-023 (competencia DMT1).",
    "locked": true
  },
  {
    "id": "INT-030",
    "nombre": "Cu + Fe juntos sin escudo redox — daño oxidativo en cadena",
    "severity": "critica",
    "ingredientes": ["ING-0022", "ING-0023"],
    "rutasAfectadas": ["N2_REDOX", "N3_MEMBRANE", "N3_SPITZ"],
    "condicion": "ambos_presentes",
    "msg": "Cobre (ING-0022) y hierro (ING-0023) presentes simultáneamente activan maximalmente la cadena respiratoria (ETC). La ETC hiperactiva genera H₂O₂ y O₂•⁻ proporcionales al flujo electrónico. Sin escudo redox activo (N2_REDOX: glutatión/NAC/vitamina C), los ROS peroxidan los ácidos grasos de las membranas del Spitzenkörper → rigidez → fusión vesicular bloqueada → freno apical. El daño puede ocurrir aunque Ca²⁺ y poliaminas estén en rango. Este es el mecanismo de daño que los edges de inhibición N1_ETC ⊣ N3_MEMBRANE y N1_ETC ⊣ N3_SPITZ representan en el grafo. SOLUCIÓN PREVENTIVA: agregar glutatión reducido (0.05–0.2 g/L), N-acetilcisteína (NAC) o ácido ascórbico cuando Cu y Fe coexisten.",
    "locked": true
  },
  {
    "id": "INT-031",
    "nombre": "Creatina + Arginina — sinergia SAM-sparing y liberación de precursores AGAT",
    "severity": "sinergia",
    "ingredientes": ["ING-0031", "ING-0006"],
    "rutasAfectadas": ["N3_SAM", "N2_ODC", "N2_NO_PKG"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Creatina monohidrato (ING-0031) y L-Arginina (ING-0006) presentes simultáneamente. MECANISMO HIPOTÉTICO: si P. cubensis posee AGAT (arginin:glicina amidinotransferasa, EC 2.1.4.1), la creatina exógena genera feedback negativo sobre AGAT, reduciendo el consumo de Arg en la síntesis endógena de guanidinoacetato. Resultado: más Arg libre disponible para ODC (N2_ODC → espermidina → N3_SPITZ) y fNOS (N2_NO_PKG → NO → PKG). Simultáneamente, la Gly que AGAT hubiera consumido también queda libre, apoyando el reciclado de homocisteína (N3_SAM) y la síntesis de quitina (N3_CHITIN). ADVERTENCIA: esta sinergia opera solo si el hongo sintetiza creatina endógenamente — si no posee AGAT, la interacción es nula. Mecanismo AGAT no documentado en Basidiomycota al 2026. Ref: PMID:11595668, PMC4580963.",
    "locked": true
  },
  {
    "id": "INT-032",
    "nombre": "Creatina sin reciclador SAH — beneficio SAM-sparing reducido sin B12",
    "severity": "atencion",
    "ingredientes": ["ING-0031"],
    "rutasAfectadas": ["N3_SAM"],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0024",
    "msg": "Creatina monohidrato (ING-0031) presente SIN Becozym (ING-0024, fuente de B12). El mecanismo de ahorro SAM que justifica el uso de creatina depende de que el ciclo de metionina esté activo: SAM → metilación → SAH → homocisteína → (B12 + metionina sintasa) → metionina → SAM. Sin B12 como cofactor de metionina sintasa (EC 2.1.1.13), la homocisteína acumula y SAH hidrolasa actúa en reversa → bloqueo de metiltransferasas (Ki SAH ≈ 1–10 µM). En este contexto, aunque la creatina exógena reduzca parcialmente la producción de SAH (al inhibir AGAT), el SAH de otras reacciones de metilación sigue acumulándose. El beneficio neto sobre N3_SAM queda reducido estimado al 20–30% del potencial. SOLUCIÓN: agregar Becozym (ING-0024) >= 0.5 comprimido/L para mantener el ciclo SAM activo y maximizar el efecto de la creatina. Ref: INT-027, PMID:11595668.",
    "locked": true
  },

  // --- CEREALES SIN NITRÓGENO COMPLEMENTARIO ---
  {
    "id": "INT-033",
    "nombre": "Cereal C/N alto sin N complementario → déficit aminoacídico",
    "severity": "critica",
    "ingredientes": ["ING-0032"],
    "rutasAfectadas": ["N2_ODC", "N3_CHITIN", "N3_SAM"],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0005",
    "msg": "Grano de Maíz (ING-0032) sin fuente de N de calidad: C/N >40 genera déficit de aminoácidos esenciales (Lys, Trp) para síntesis de enzimas apicales y quitina. Agregar mínimo 3–8 g/L de levadura (ING-0005) o equivalente nitrogenado para C/N 20–30:1.",
    "locked": true
  },
  {
    "id": "INT-034",
    "nombre": "Harina de Maíz cruda sin N complementario → C/N crítico",
    "severity": "critica",
    "ingredientes": ["ING-0038"],
    "rutasAfectadas": ["N2_ODC", "N3_CHITIN"],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0005",
    "msg": "Harina de Maíz cruda (ING-0038) sin fuente de N: C/N >43. Mismo déficit de Lys y Trp que ING-0032 pero con mayor velocidad de disponibilidad de C por granulometría fina — el desbalance se manifiesta más rápido. Combinar siempre con N complementario.",
    "locked": true
  },
  {
    "id": "INT-035",
    "nombre": "Arroz blanco sin N → C/N extremo 87:1",
    "severity": "critica",
    "ingredientes": ["ING-0036"],
    "rutasAfectadas": ["N2_ODC", "N3_CHITIN", "N3_SAM", "N3_ZINC"],
    "condicion": "ausencia_complementaria",
    "ingAusente": "ING-0005",
    "msg": "Arroz blanco (ING-0036) sin fuente de N: C/N ≈87:1, el más alto de los cereales del sistema. Deficiencia severa de N que bloquea síntesis de enzimas, quitina y poliaminas. No usar como fuente única bajo ninguna circunstancia.",
    "locked": true
  },

  // --- SORGO ROJO: TANINOS ---
  {
    "id": "INT-036",
    "nombre": "Sorgo Rojo + Fe²⁺ → complejos tanato-Fe inhibitorios",
    "severity": "critica",
    "ingredientes": ["ING-0034"],
    "rutasAfectadas": ["N1_ETC", "N3_ZINC"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Sorgo Rojo (ING-0034) contiene taninos condensados (procianidinas 0.3–3.6% bs) que precipitan con Fe²⁺ formando complejos tanato-Fe insolubles. Reduce biodisponibilidad de Fe esencial para cadena respiratoria (N1_ETC) y metaloproteínas apicales. No combinar con sales de Fe²⁺ sin pretratamiento alcalino del sorgo (NaOH 0.1%/30 min) o usar Sorgo Blanco (ING-0033) en su lugar.",
    "locked": true
  },
  {
    "id": "INT-037",
    "nombre": "Sorgo Rojo + proteasas → inhibición por taninos",
    "severity": "critica",
    "ingredientes": ["ING-0034"],
    "rutasAfectadas": ["N2_ODC", "N3_CHITIN", "N3_SAM"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Los taninos condensados del Sorgo Rojo (ING-0034) forman complejos con proteínas extracelulares, inhibiendo amilasas y proteasas fúngicas hasta en un 70% en variedades de alto tanino. Esto bloquea la hidrólisis proteica necesaria para el pool de aminoácidos que alimenta N2_ODC, N3_CHITIN y N3_SAM. Usar pretratamiento alcalino o limitar dosis a ≤15 g/L.",
    "locked": true
  },
  {
    "id": "INT-038",
    "nombre": "Sorgo Rojo dosis baja → sinergia antioxidante N2_REDOX",
    "severity": "sinergia",
    "ingredientes": ["ING-0034"],
    "rutasAfectadas": ["N2_REDOX", "N3_MEMBRANE"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Sorgo Rojo (ING-0034) en dosis ≤15 g/L: los taninos condensados en concentración subinhibitorias actúan como antioxidantes exógenos que modulan N2_REDOX y protegen membranas apicales. En dosis controladas puede complementar la actividad antioxidante de las isoflavonas de Soja (ING-0037).",
    "locked": true
  },

  // --- AVENA ---
  {
    "id": "INT-039",
    "nombre": "Avena >25 g/L → gelificación por β-glucanos",
    "severity": "critica",
    "ingredientes": ["ING-0035"],
    "rutasAfectadas": ["N1_GLYC", "N1_ETC"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Avena (ING-0035) en concentración >25 g/L: los β-glucanos solubles (4–5% bs) gelifican durante autoclavado (≥80°C), aumentando viscosidad del medio hasta impedir difusión de O₂ y nutrientes. Resultado: zonas anóxicas, inhibición de ETC y colapso de colonización. Verificar textura post-esterilización antes de inocular. Limitar a ≤20 g/L en formulaciones sin previo ensayo.",
    "locked": true
  },
  {
    "id": "INT-040",
    "nombre": "Avena → peroxidación lipídica sin antioxidante",
    "severity": "atencion",
    "ingredientes": ["ING-0035"],
    "rutasAfectadas": ["N2_REDOX", "N3_MEMBRANE"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Avena (ING-0035) contiene ≈7% de lípidos insaturados (linoleico/oleico). Durante esterilización o almacenamiento prolongado se peroxidan generando aldehídos (malondialdehído) tóxicos para membranas apicales. Usar lote fresco, almacenar en frío/oscuridad, y considerar adición de antioxidante (vitamina E/C) o ciclo de esterilización corto.",
    "locked": true
  },
  {
    "id": "INT-041",
    "nombre": "Avena + Soja → C/N balanceado con soporte antioxidante",
    "severity": "sinergia",
    "ingredientes": ["ING-0035", "ING-0037"],
    "rutasAfectadas": ["N1_GLYC", "N2_ODC", "N3_CHITIN", "N2_REDOX"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Avena (ING-0035) + Soja (ING-0037): combinación complementaria. C sostenido por β-glucanos+almidón de avena con pool de aminoácidos completo de soja. Las isoflavonas de soja (genisteína/daidzeína) compensan el estrés oxidativo lipídico de la avena via N2_REDOX. C/N ajustable entre 10–20:1 con ratio 3:1 avena/soja. NOTA: soja debe estar autoclavada para activar perfil proteico.",
    "locked": true
  },

  // --- SOJA CRUDA ---
  {
    "id": "INT-042",
    "nombre": "Soja cruda sin autoclave → inhibición de proteasas fúngicas",
    "severity": "critica",
    "ingredientes": ["ING-0037"],
    "rutasAfectadas": ["N2_ODC", "N3_CHITIN", "N3_SAM"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Soja entera cruda (ING-0037) sin autoclavado 121°C/20 min: los inhibidores de tripsina de Kunitz y las hemaglutininas (lectinas) están activos. Bloquean proteasas extracelulares fúngicas hasta un 70%, anulando la digestibilidad proteica. Las rutas dependientes de aminoácidos (N2_ODC, N3_CHITIN, N3_SAM) quedan sin sustrato aunque el pn sea alto. La esterilización estándar del medio inactiva estos factores — verificar tiempo y temperatura del ciclo.",
    "locked": true
  },
  {
    "id": "INT-043",
    "nombre": "Soja + Arg libre → umbral acumulativo Arg > 3.5 g/L",
    "severity": "critica",
    "ingredientes": ["ING-0037", "ING-0006"],
    "rutasAfectadas": ["N2_NO_PKG", "N1_ETC"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Soja (ING-0037) aporta 2.67 g Arg/100g proteína. Combinada con Arginina libre (ING-0006) la suma puede superar el umbral de 3.5 g/L de Arg total exógena, con riesgo de exceso de NO vía fNOS → inhibición del Complejo IV (N1_ETC). Calcular: [Arg_soja] + [Arg_ING-0006] + [Cit×0.6 si presente]. Si supera 3.5 g/L reducir una de las fuentes.",
    "locked": true
  },
  {
    "id": "INT-044",
    "nombre": "Soja + Levadura → sobrecarga N acumulativa",
    "severity": "atencion",
    "ingredientes": ["ING-0037", "ING-0005"],
    "rutasAfectadas": ["N2_ODC", "N2_AUTOPHAGY"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Soja (ING-0037) + Levadura (ING-0005): verificar N total acumulado. Superar 15 g/L de proteína equivalente puede activar represión catabólica de N, inhibiendo rutas de exploración y rizomorfismo. Calcular suma de pn×dosis de ambos ingredientes antes de formular. Reducir levadura si la soja ya aporta N suficiente.",
    "locked": true
  },
  {
    "id": "INT-045",
    "nombre": "Soja + fitatos → quelación Zn²⁺ y Fe²⁺",
    "severity": "atencion",
    "ingredientes": ["ING-0037"],
    "rutasAfectadas": ["N3_ZINC", "N1_ETC"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Soja entera (ING-0037) contiene fitatos abundantes que quelan Zn²⁺ y Fe²⁺ a pH 5–7. Si la fórmula incluye sales minerales de Zn o Fe como micronutriente funcional, la biodisponibilidad de estos metales cae significativamente. Compensar con dosis adicional de Zn/Fe o usar pretratamiento con fitasa (pH ácido <4.5 o enzima exógena).",
    "locked": true
  },

  // --- SINERGIAS ENTRE CEREALES Y SOJA ---
  {
    "id": "INT-046",
    "nombre": "Maíz semolín + Soja → sinergia C/N clásica alta producción",
    "severity": "sinergia",
    "ingredientes": ["ING-0032", "ING-0037"],
    "rutasAfectadas": ["N1_GLYC", "N2_CAMP", "N2_ODC", "N3_CHITIN"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Maíz semolín (ING-0032, C/N≈40) + Soja (ING-0037, C/N≈4.3): combinación clásica de alta productividad. El almidón de maíz sostiene N1_GLYC y N2_CAMP mientras la proteína de soja activa N2_ODC y N3_CHITIN. Ratio recomendado 3–4:1 (maíz:soja) para C/N resultante 18–22:1. REQUISITO: soja autoclavada.",
    "locked": true
  },
  {
    "id": "INT-047",
    "nombre": "Harina de Maíz fina + Soja → C disponible rápido + N completo",
    "severity": "sinergia",
    "ingredientes": ["ING-0038", "ING-0037"],
    "rutasAfectadas": ["N1_GLYC", "N2_CAMP", "N2_ODC", "N3_CHITIN"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Harina de Maíz fina (ING-0038) + Soja (ING-0037): igual lógica que maíz semolín+soja pero con mayor velocidad de disponibilidad de C por granulometría fina. Pico de N1_GLYC más temprano. Útil cuando se busca colonización rápida en etapas iniciales. Ratio 3:1 para C/N ≈20:1.",
    "locked": true
  },
  {
    "id": "INT-048",
    "nombre": "Arroz + Soja → C/N ultra-ajustable para rizomorfismo",
    "severity": "sinergia",
    "ingredientes": ["ING-0036", "ING-0037"],
    "rutasAfectadas": ["N1_GLYC", "N2_ODC", "N3_CHITIN", "N2_AUTOPHAGY"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Arroz (ING-0036, C/N≈87) + Soja (ING-0037, C/N≈4.3): combinación con mayor rango de ajuste de C/N del sistema. Pequeñas variaciones en la proporción soja permiten afinar el C/N entre 10:1 y 50:1. El almidón fino de arroz da pico de glucosa temprano (N1_GLYC) mientras la proteína de soja completa el pool de aminoácidos. Ratio 6:1 arroz:soja → C/N ≈20:1.",
    "locked": true
  },
  {
    "id": "INT-049",
    "nombre": "Sorgo Blanco + Soja → cereal-leguminosa sin riesgo taninos",
    "severity": "sinergia",
    "ingredientes": ["ING-0033", "ING-0037"],
    "rutasAfectadas": ["N1_GLYC", "N2_ODC", "N3_CHITIN"],
    "condicion": "ambos_presentes",
    "ingAusente": null,
    "msg": "Sorgo Blanco (ING-0033) + Soja (ING-0037): combinación cereal-leguminosa libre de taninos. Compatible con sales de Fe²⁺ y Zn²⁺ sin riesgo de precipitación. Las kafirinas del sorgo blanco aportan N mínimo; la soja provee el pool de aminoácidos completo. C/N ajustable 3:1 sorgo:soja → C/N ≈18:1.",
    "locked": true
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AGREGAR NUEVAS INTERACCIONES AQUÍ — próximo ID: INT-050
  // Ver instrucciones en el header de este archivo.
  // ─────────────────────────────────────────────────────────────────────────
];
