// =====================================================================
// AULANET · SINCRONIZACIÓN CON EDUMETRICS (v3)
// =====================================================================
// Novedades sobre v2:
//   - Respeta la fuente de datos configurada por el administrador en
//     an_periodos.fuente_datos ('original' | 'post_nivelacion'). Cuando
//     un periodo está en post_nivelacion, fusiona por código de
//     estudiante: la fila con tipo='nivelacion' tiene prioridad sobre
//     la fila normal de ese mismo periodo.
//   - Guarda además el detalle por asignatura en
//     an_resultados_por_asignatura para Educación Artística (siempre) y
//     para Ciencias Naturales / Tecnología (solo en cursos de
//     bachillerato), tal como se definió en el diseño.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const EDUMETRICS_URL = process.env.EDUMETRICS_URL;
const EDUMETRICS_SERVICE_KEY = process.env.EDUMETRICS_SERVICE_KEY;
const AULANET_URL = process.env.AULANET_URL;
const AULANET_SERVICE_KEY = process.env.AULANET_SERVICE_KEY;
const SYNC_ANIO = parseInt(process.env.SYNC_ANIO || new Date().getFullYear());

if (!EDUMETRICS_URL || !EDUMETRICS_SERVICE_KEY || !AULANET_URL || !AULANET_SERVICE_KEY) {
  console.error('Faltan variables de entorno (EDUMETRICS_URL / EDUMETRICS_SERVICE_KEY / AULANET_URL / AULANET_SERVICE_KEY)');
  process.exit(1);
}

const edu = createClient(EDUMETRICS_URL, EDUMETRICS_SERVICE_KEY);
const aula = createClient(AULANET_URL, AULANET_SERVICE_KEY);

const AREA_MAP = {
  'EDUCACIÓN FÍSICA':      'Educación Física',
  'PROFUNDIZACIÓN':        'Profundización',
  'TECNOLOGÍA':             'Tecnología',
  'ARTÍSTICA':              'Educación Artística',
  'CIENCIAS NATURALES':     'Ciencias Naturales',
  'CIENCIAS SOCIALES':      'Ciencias Sociales',
  'ÉTICA Y VALORES':        'Ética y Valores',
  'RELIGIÓN Y FILOSOFÍA':   'Religión y Filosofía',
  'INGLÉS':                 'Inglés',
  'CASTELLANO':             'Castellano',
  'MATEMÁTICAS':            'Matemáticas',
  'CIENCIAS ECONÓMICAS':    'Ciencias Económicas',
};

const PERIODO_NUM = { 'Primer Periodo': 1, 'Segundo Periodo': 2, 'Tercer Periodo': 3, 'Cuarto Periodo': 4 };
const PERIODO_NOMBRE_INFORME = { 1: 'PRIMER PERIODO', 2: 'SEGUNDO PERIODO', 3: 'TERCER PERIODO', 4: 'CUARTO PERIODO' };

// Áreas que se desagregan por asignatura. 'siempre' = primaria y
// bachillerato; 'bachillerato' = solo cursos de nivel bachillerato.
const DESAGREGACION = {
  'Educación Artística': 'siempre',
  'Ciencias Naturales':  'bachillerato',
  'Tecnología':          'bachillerato',
};

function normalizar(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function enLotesParalelos(items, tamanoLote, concurrencia, fn) {
  const lotes = Array.from({ length: Math.ceil(items.length / tamanoLote) }, (_, i) => items.slice(i * tamanoLote, (i + 1) * tamanoLote));
  for (let i = 0; i < lotes.length; i += concurrencia) {
    await Promise.all(lotes.slice(i, i + concurrencia).map(fn));
  }
}

// ---------------------------------------------------------------------
// Cachés
// ---------------------------------------------------------------------
const cacheCursos = new Map();       // nombre_normalizado -> curso_id
const cacheCursoNivel = new Map();   // curso_id -> 'primaria' | 'bachillerato'
const cacheAreas = new Map();        // nombre AULAnet -> area_id
const cachePeriodos = new Map();     // numero -> { id, fuente_datos }
const cacheEstudiantes = new Map();  // codigo -> estudiante_id
const cacheAsignaturas = new Map();  // area_id|nombre_normalizado -> asignatura_id

async function cargarCaches() {
  const { data: cursos } = await aula.from('an_cursos').select('id, nombre, nivel');
  (cursos || []).forEach(c => { cacheCursos.set(normalizar(c.nombre), c.id); cacheCursoNivel.set(c.id, c.nivel); });

  const { data: areas } = await aula.from('an_areas').select('id, nombre');
  (areas || []).forEach(a => cacheAreas.set(a.nombre, a.id));

  const { data: asignaturas } = await aula.from('an_asignaturas').select('id, nombre, area_id, nivel');
  (asignaturas || []).forEach(a => {
    const clave = normalizar(a.nombre);
    if (a.nivel === 'ambos') {
      cacheAsignaturas.set(a.area_id + '|primaria|' + clave, a.id);
      cacheAsignaturas.set(a.area_id + '|bachillerato|' + clave, a.id);
    } else {
      cacheAsignaturas.set(a.area_id + '|' + a.nivel + '|' + clave, a.id);
    }
  });

  const { data: estudiantes } = await aula.from('an_estudiantes').select('id, edumetrics_id');
  (estudiantes || []).forEach(e => { if (e.edumetrics_id) cacheEstudiantes.set(e.edumetrics_id, e.id); });
}

async function asegurarPeriodosYLeerFuente(numerosUsados) {
  for (const numero of numerosUsados) {
    await aula.from('an_periodos')
      .upsert({ anio: SYNC_ANIO, numero, nombre_informe: PERIODO_NOMBRE_INFORME[numero] }, { onConflict: 'anio,numero' });
  }
  const { data: periodos } = await aula.from('an_periodos').select('id, numero, fuente_datos').eq('anio', SYNC_ANIO);
  (periodos || []).forEach(p => cachePeriodos.set(p.numero, { id: p.id, fuente_datos: p.fuente_datos }));
}

// ---------------------------------------------------------------------
// Consolidación por área + detalle por asignatura donde corresponda
// ---------------------------------------------------------------------
// Detecta las filas "envoltorio" que EduMetrics ya guarda como el
// promedio oficial del área (ej. "ÁREA CIENCIAS NATURALES Y EDUC AMB 11º",
// "ÁREA TECNOLOGÍA E INFORMÁTICA 6º"). Estas NO deben promediarse junto
// con las asignaturas específicas — se usan tal cual como nota de área.
function esEnvoltorio(nombreAsig) {
  return /^(ÁREA|AREA)\s/i.test(nombreAsig);
}

function consolidarDetalle(notas, acumuladoNotas, nivelCurso) {
  const asigToArea = {};
  const envolturaPeriodo = {};   // area -> nota oficial del área (periodo)
  const envolturaAcum = {};      // area -> nota oficial del área (acumulado)
  const sumaPeriodo = {}; const cuentaPeriodo = {};
  const porAsignatura = {}; // nombreLimpio -> { area, nota_periodo, nota_acumulada }

  for (const [asig, v] of Object.entries(notas || {})) {
    const areaAula = AREA_MAP[v.area];
    if (!areaAula) continue;
    asigToArea[asig] = areaAula;

    if (esEnvoltorio(asig)) {
      envolturaPeriodo[areaAula] = v.nota;
      continue; // no participa en el promedio ni en el detalle por asignatura
    }

    sumaPeriodo[areaAula] = (sumaPeriodo[areaAula] || 0) + v.nota;
    cuentaPeriodo[areaAula] = (cuentaPeriodo[areaAula] || 0) + 1;

    const regla = DESAGREGACION[areaAula];
    const aplica = regla === 'siempre' || (regla === 'bachillerato' && nivelCurso === 'bachillerato');
    if (aplica) {
      const nombreLimpio = asig.replace(/\s+\d{1,2}[°º]$/, '').trim();
      porAsignatura[nombreLimpio] = { area: areaAula, nota_periodo: v.nota, nota_acumulada: null, claveOriginal: asig };
    }
  }

  const sumaAcum = {}; const cuentaAcum = {};
  for (const [asig, nota] of Object.entries(acumuladoNotas || {})) {
    const areaAula = asigToArea[asig];
    if (!areaAula) continue;
    if (esEnvoltorio(asig)) { envolturaAcum[areaAula] = nota; continue; }
    sumaAcum[areaAula] = (sumaAcum[areaAula] || 0) + nota;
    cuentaAcum[areaAula] = (cuentaAcum[areaAula] || 0) + 1;
    const nombreLimpio = asig.replace(/\s+\d{1,2}[°º]$/, '').trim();
    if (porAsignatura[nombreLimpio]) porAsignatura[nombreLimpio].nota_acumulada = nota;
  }

  const porArea = {};
  const areasVistas = new Set([...Object.keys(sumaPeriodo), ...Object.keys(envolturaPeriodo)]);
  for (const area of areasVistas) {
    const notaPeriodo = envolturaPeriodo[area] !== undefined
      ? envolturaPeriodo[area]
      : Math.round((sumaPeriodo[area] / cuentaPeriodo[area]) * 10) / 10;
    const notaAcum = envolturaAcum[area] !== undefined
      ? envolturaAcum[area]
      : (cuentaAcum[area] ? Math.round((sumaAcum[area] / cuentaAcum[area]) * 10) / 10 : null);
    porArea[area] = { nota_periodo: notaPeriodo, nota_acumulada: notaAcum };
  }

  return { porArea, porAsignatura };
}

// ---------------------------------------------------------------------
// Proceso principal
// ---------------------------------------------------------------------
async function main() {
  console.log(`Iniciando sincronización EduMetrics → AULAnet | año=${SYNC_ANIO}`);
  await cargarCaches();

  // 1) Traer TODAS las filas del año (incluye tipo normal y tipo='nivelacion')
  const filas = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: rows, error } = await edu.from('resultados')
      .select('año, periodo, tipo, grado, curso, codigo, estudiante, notas, acumulado')
      .eq('año', SYNC_ANIO)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    filas.push(...rows);
    from += PAGE;
    if (rows.length < PAGE) break;
  }
  console.log(`Filas leídas de EduMetrics: ${filas.length}`);

  const numerosUsados = new Set(filas.map(r => PERIODO_NUM[r.periodo]).filter(Boolean));
  await asegurarPeriodosYLeerFuente(numerosUsados);

  // 2) Agrupar por periodo -> por tipo -> por código (normal vs nivelación)
  const porPeriodo = new Map(); // numero -> { normal: Map(codigo->row), nivelacion: Map(codigo->row) }
  for (const row of filas) {
    const numero = PERIODO_NUM[row.periodo];
    if (!numero || !row.codigo) continue;
    if (!porPeriodo.has(numero)) porPeriodo.set(numero, { normal: new Map(), nivelacion: new Map() });
    const bucket = row.tipo === 'nivelacion' ? 'nivelacion' : 'normal';
    porPeriodo.get(numero)[bucket].set(row.codigo, row);
  }

  // 3) Resolver la fila "efectiva" por estudiante según fuente_datos del periodo
  const filasEfectivas = []; // { numero, row }
  for (const [numero, { normal, nivelacion }] of porPeriodo.entries()) {
    const periodoInfo = cachePeriodos.get(numero);
    const usarNivelacion = periodoInfo?.fuente_datos === 'post_nivelacion';
    for (const [codigo, rowNormal] of normal.entries()) {
      const row = (usarNivelacion && nivelacion.has(codigo)) ? nivelacion.get(codigo) : rowNormal;
      filasEfectivas.push({ numero, row });
    }
    // estudiantes que SOLO tienen fila de nivelación (caso raro, por si acaso)
    if (usarNivelacion) {
      for (const [codigo, rowNiv] of nivelacion.entries()) {
        if (!normal.has(codigo)) filasEfectivas.push({ numero, row: rowNiv });
      }
    }
  }
  console.log(`Filas efectivas tras aplicar fuente de datos por periodo: ${filasEfectivas.length}`);

  // 4) Estudiantes únicos con curso válido -> upsert en lotes
  const cursosFaltantes = new Set();
  const estudiantesUnicos = new Map();
  for (const { row } of filasEfectivas) {
    const cursoId = cacheCursos.get(normalizar(row.curso));
    if (!cursoId) { cursosFaltantes.add(row.curso); continue; }
    if (!estudiantesUnicos.has(row.codigo)) {
      estudiantesUnicos.set(row.codigo, { codigo: row.codigo, nombre: row.estudiante, cursoId });
    }
  }
  const nuevos = [...estudiantesUnicos.values()].filter(e => !cacheEstudiantes.has(e.codigo));
  console.log(`Estudiantes únicos: ${estudiantesUnicos.size} (nuevos/actualizar: ${nuevos.length})`);

  await enLotesParalelos(nuevos, 500, 5, async (lote) => {
    const payload = lote.map(e => ({
      edumetrics_id: e.codigo, nombre_completo: e.nombre, nombre_normalizado: normalizar(e.nombre),
      curso_id: e.cursoId, origen: 'sync_edumetrics',
    }));
    const { data, error } = await aula.from('an_estudiantes').upsert(payload, { onConflict: 'edumetrics_id' }).select('id, edumetrics_id');
    if (error) { console.error('Error en lote de estudiantes:', error.message); return; }
    (data || []).forEach(e => cacheEstudiantes.set(e.edumetrics_id, e.id));
  });

  // 5) Consolidar por área y por asignatura
  const filasConsolidadasArea = [];
  const filasConsolidadasAsignatura = [];

  for (const { numero, row } of filasEfectivas) {
    const estudianteId = cacheEstudiantes.get(row.codigo);
    if (!estudianteId) continue;
    const periodoInfo = cachePeriodos.get(numero);
    const cursoId = cacheCursos.get(normalizar(row.curso));
    const nivelCurso = cacheCursoNivel.get(cursoId);

    const { porArea, porAsignatura } = consolidarDetalle(row.notas, row.acumulado?.notas, nivelCurso);

    for (const [areaNombre, valores] of Object.entries(porArea)) {
      const areaId = cacheAreas.get(areaNombre);
      if (!areaId) continue;
      filasConsolidadasArea.push({
        estudiante_id: estudianteId, area_id: areaId, periodo_id: periodoInfo.id,
        nota_periodo: valores.nota_periodo, nota_acumulada: valores.nota_acumulada,
        sincronizado_en: new Date().toISOString(),
      });
    }

    for (const [asigNombre, valores] of Object.entries(porAsignatura)) {
      const areaId = cacheAreas.get(valores.area);
      const asignaturaId = cacheAsignaturas.get(areaId + '|' + nivelCurso + '|' + normalizar(asigNombre));
      if (!asignaturaId) continue; // nombre no matchea el catálogo; se ignora en vez de fallar
      filasConsolidadasAsignatura.push({
        estudiante_id: estudianteId, asignatura_id: asignaturaId, periodo_id: periodoInfo.id,
        nota_periodo: valores.nota_periodo, nota_acumulada: valores.nota_acumulada,
        sincronizado_en: new Date().toISOString(),
      });
    }
  }
  console.log(`Consolidados por área: ${filasConsolidadasArea.length} | por asignatura: ${filasConsolidadasAsignatura.length}`);

  let errores = 0;
  await enLotesParalelos(filasConsolidadasArea, 500, 5, async (lote) => {
    const { error } = await aula.from('an_resultados_consolidados').upsert(lote, { onConflict: 'estudiante_id,area_id,periodo_id' });
    if (error) { console.error('Error en lote de consolidados por área:', error.message); errores++; }
  });
  await enLotesParalelos(filasConsolidadasAsignatura, 500, 5, async (lote) => {
    const { error } = await aula.from('an_resultados_por_asignatura').upsert(lote, { onConflict: 'estudiante_id,asignatura_id,periodo_id' });
    if (error) { console.error('Error en lote de consolidados por asignatura:', error.message); errores++; }
  });

  if (cursosFaltantes.size > 0) {
    console.warn('⚠️  Cursos de EduMetrics sin equivalente en an_cursos:');
    console.warn('   ' + [...cursosFaltantes].join(', '));
  }

  const estado = errores > 0 ? 'con_errores' : 'exitoso';
  const detalle = `filas_leidas=${filas.length}, estudiantes=${estudiantesUnicos.size}, ` +
                   `consolidados_area=${filasConsolidadasArea.length}, consolidados_asignatura=${filasConsolidadasAsignatura.length}, ` +
                   `cursos_faltantes=${cursosFaltantes.size}` + (cursosFaltantes.size ? ' (' + [...cursosFaltantes].join('; ') + ')' : '');

  await aula.from('an_sync_log').insert({ filas_sincronizadas: filasConsolidadasArea.length, estado, detalle });
  console.log(`Listo. ${detalle}`);
  if (errores > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('Fallo la sincronización:', err.message);
  try { await aula.from('an_sync_log').insert({ filas_sincronizadas: 0, estado: 'fallido', detalle: err.message }); } catch (_) {}
  process.exit(1);
});
