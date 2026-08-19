// =====================================================================
// AULANET · SINCRONIZACIÓN CON EDUMETRICS (v2 — con upserts en lotes)
// =====================================================================
// Lee la tabla `resultados` de EduMetrics (notas por estudiante/curso/
// periodo, en formato JSONB por asignatura), consolida por ÁREA y las
// guarda en AULAnet (an_estudiantes + an_resultados_consolidados).
// Se ejecuta diariamente vía GitHub Actions.
//
// v2: los estudiantes y los resultados se guardan en LOTES PARALELOS
// (como en el sync de EduMetrics) en vez de fila por fila, para que la
// carga inicial masiva no tome decenas de minutos.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Mapas de traducción EduMetrics -> AULAnet
// ---------------------------------------------------------------------
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

const PERIODO_NUM = {
  'Primer Periodo': 1, 'Segundo Periodo': 2, 'Tercer Periodo': 3, 'Cuarto Periodo': 4,
};
const PERIODO_NOMBRE_INFORME = {
  1: 'PRIMER PERIODO', 2: 'SEGUNDO PERIODO', 3: 'TERCER PERIODO', 4: 'CUARTO PERIODO',
};

function normalizar(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Ejecuta un arreglo de "tareas" (funciones que devuelven promesas) en
// lotes paralelos, para no disparar miles de requests simultáneas ni
// hacerlas todas secuenciales.
async function enLotesParalelos(items, tamanoLote, fn) {
  const resultados = [];
  for (let i = 0; i < items.length; i += tamanoLote) {
    const lote = items.slice(i, i + tamanoLote);
    const r = await Promise.all(lote.map(fn));
    resultados.push(...r);
  }
  return resultados;
}

// ---------------------------------------------------------------------
// Cachés
// ---------------------------------------------------------------------
const cacheCursos = new Map();
const cacheAreas = new Map();
const cachePeriodos = new Map();
const cacheEstudiantes = new Map();

async function cargarCaches() {
  const { data: cursos } = await aula.from('an_cursos').select('id, nombre');
  (cursos || []).forEach(c => cacheCursos.set(normalizar(c.nombre), c.id));

  const { data: areas } = await aula.from('an_areas').select('id, nombre');
  (areas || []).forEach(a => cacheAreas.set(a.nombre, a.id));

  const { data: periodos } = await aula.from('an_periodos').select('id, anio, numero');
  (periodos || []).forEach(p => cachePeriodos.set(`${p.anio}-${p.numero}`, p.id));

  const { data: estudiantes } = await aula.from('an_estudiantes').select('id, edumetrics_id');
  (estudiantes || []).forEach(e => { if (e.edumetrics_id) cacheEstudiantes.set(e.edumetrics_id, e.id); });
}

async function asegurarPeriodos(numerosUsados) {
  for (const numero of numerosUsados) {
    const key = `${SYNC_ANIO}-${numero}`;
    if (cachePeriodos.has(key)) continue;
    const { data, error } = await aula.from('an_periodos')
      .upsert({ anio: SYNC_ANIO, numero, nombre_informe: PERIODO_NOMBRE_INFORME[numero] }, { onConflict: 'anio,numero' })
      .select('id').single();
    if (error) throw error;
    cachePeriodos.set(key, data.id);
  }
}

// ---------------------------------------------------------------------
// Consolidación de notas por área
// ---------------------------------------------------------------------
function consolidarPorArea(notas, acumuladoNotas) {
  const asigToArea = {};
  const sumaPeriodo = {}; const cuentaPeriodo = {};
  for (const [asig, v] of Object.entries(notas || {})) {
    const areaAula = AREA_MAP[v.area];
    if (!areaAula) continue;
    asigToArea[asig] = areaAula;
    sumaPeriodo[areaAula] = (sumaPeriodo[areaAula] || 0) + v.nota;
    cuentaPeriodo[areaAula] = (cuentaPeriodo[areaAula] || 0) + 1;
  }

  const sumaAcum = {}; const cuentaAcum = {};
  for (const [asig, nota] of Object.entries(acumuladoNotas || {})) {
    const areaAula = asigToArea[asig];
    if (!areaAula) continue;
    sumaAcum[areaAula] = (sumaAcum[areaAula] || 0) + nota;
    cuentaAcum[areaAula] = (cuentaAcum[areaAula] || 0) + 1;
  }

  const resultado = {};
  for (const area of Object.keys(sumaPeriodo)) {
    resultado[area] = {
      nota_periodo: Math.round((sumaPeriodo[area] / cuentaPeriodo[area]) * 10) / 10,
      nota_acumulada: cuentaAcum[area] ? Math.round((sumaAcum[area] / cuentaAcum[area]) * 10) / 10 : null,
    };
  }
  return resultado;
}

// ---------------------------------------------------------------------
// Proceso principal
// ---------------------------------------------------------------------
async function main() {
  console.log(`Iniciando sincronización EduMetrics → AULAnet | año=${SYNC_ANIO}`);
  await cargarCaches();

  // 1) Traer todas las filas de EduMetrics para el año, paginado
  const filas = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: rows, error } = await edu.from('resultados')
      .select('año, periodo, grado, curso, codigo, estudiante, notas, acumulado')
      .eq('año', SYNC_ANIO)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    filas.push(...rows);
    from += PAGE;
    if (rows.length < PAGE) break;
  }
  console.log(`Filas leídas de EduMetrics: ${filas.length}`);

  // 2) Detectar periodos usados y asegurarlos (secuencial, son máximo 4)
  const numerosUsados = new Set(filas.map(r => PERIODO_NUM[r.periodo]).filter(Boolean));
  await asegurarPeriodos(numerosUsados);

  // 3) Armar el conjunto único de estudiantes (dedupe por código) cuyo
  //    curso SÍ existe en AULAnet, y upsertarlos en LOTES PARALELOS
  const cursosFaltantes = new Set();
  const estudiantesUnicos = new Map(); // codigo -> {codigo, nombre, cursoId}
  for (const row of filas) {
    if (!row.codigo) continue;
    const cursoId = cacheCursos.get(normalizar(row.curso));
    if (!cursoId) { cursosFaltantes.add(row.curso); continue; }
    if (!estudiantesUnicos.has(row.codigo)) {
      estudiantesUnicos.set(row.codigo, { codigo: row.codigo, nombre: row.estudiante, cursoId });
    }
  }

  const nuevos = [...estudiantesUnicos.values()].filter(e => !cacheEstudiantes.has(e.codigo));
  console.log(`Estudiantes únicos: ${estudiantesUnicos.size} (nuevos por crear/actualizar: ${nuevos.length})`);

  const LOTE = 500;
  await enLotesParalelos(
    Array.from({ length: Math.ceil(nuevos.length / LOTE) }, (_, i) => nuevos.slice(i * LOTE, (i + 1) * LOTE)),
    5, // hasta 5 lotes de 500 en paralelo
    async (lote) => {
      const payload = lote.map(e => ({
        edumetrics_id: e.codigo,
        nombre_completo: e.nombre,
        nombre_normalizado: normalizar(e.nombre),
        curso_id: e.cursoId,
        origen: 'sync_edumetrics',
      }));
      const { data, error } = await aula.from('an_estudiantes')
        .upsert(payload, { onConflict: 'edumetrics_id' })
        .select('id, edumetrics_id');
      if (error) { console.error('Error en lote de estudiantes:', error.message); return; }
      (data || []).forEach(e => cacheEstudiantes.set(e.edumetrics_id, e.id));
    }
  );

  // 4) Consolidar resultados por área y upsertarlos en lotes paralelos
  const rowsAConsolidar = [];
  for (const row of filas) {
    const numero = PERIODO_NUM[row.periodo];
    if (!numero) continue;
    const estudianteId = cacheEstudiantes.get(row.codigo);
    if (!estudianteId) continue; // curso faltante u otro problema, ya reportado
    const periodoId = cachePeriodos.get(`${SYNC_ANIO}-${numero}`);
    const porArea = consolidarPorArea(row.notas, row.acumulado?.notas);

    for (const [areaNombre, valores] of Object.entries(porArea)) {
      const areaId = cacheAreas.get(areaNombre);
      if (!areaId) continue;
      rowsAConsolidar.push({
        estudiante_id: estudianteId,
        area_id: areaId,
        periodo_id: periodoId,
        nota_periodo: valores.nota_periodo,
        nota_acumulada: valores.nota_acumulada,
        sincronizado_en: new Date().toISOString(),
      });
    }
  }
  console.log(`Filas consolidadas a guardar: ${rowsAConsolidar.length}`);

  let errores = 0;
  const lotesConsolidados = Array.from(
    { length: Math.ceil(rowsAConsolidar.length / LOTE) },
    (_, i) => rowsAConsolidar.slice(i * LOTE, (i + 1) * LOTE)
  );
  await enLotesParalelos(lotesConsolidados, 5, async (lote) => {
    const { error } = await aula.from('an_resultados_consolidados')
      .upsert(lote, { onConflict: 'estudiante_id,area_id,periodo_id' });
    if (error) { console.error('Error en lote de consolidados:', error.message); errores++; }
  });

  if (cursosFaltantes.size > 0) {
    console.warn('⚠️  Cursos de EduMetrics sin equivalente en an_cursos (no se sincronizaron sus estudiantes):');
    console.warn('   ' + [...cursosFaltantes].join(', '));
  }

  const estado = errores > 0 ? 'con_errores' : 'exitoso';
  const detalle = `filas_leidas=${filas.length}, estudiantes=${estudiantesUnicos.size}, ` +
                   `filas_consolidadas=${rowsAConsolidar.length}, cursos_faltantes=${cursosFaltantes.size}` +
                   (cursosFaltantes.size ? ' (' + [...cursosFaltantes].join('; ') + ')' : '');

  await aula.from('an_sync_log').insert({
    filas_sincronizadas: rowsAConsolidar.length,
    estado,
    detalle,
  });

  console.log(`Listo. ${detalle}`);
  if (errores > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('Fallo la sincronización:', err.message);
  try {
    await aula.from('an_sync_log').insert({
      filas_sincronizadas: 0,
      estado: 'fallido',
      detalle: err.message,
    });
  } catch (_) {}
  process.exit(1);
});
