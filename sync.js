// =====================================================================
// AULANET · SINCRONIZACIÓN CON EDUMETRICS
// =====================================================================
// Lee la tabla `resultados` de EduMetrics (notas por estudiante/curso/
// periodo, en formato JSONB por asignatura), consolida por ÁREA y las
// guarda en AULAnet (an_estudiantes + an_resultados_consolidados).
// Se ejecuta diariamente vía GitHub Actions.
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------
// Cachés (se llenan una vez por corrida para no golpear la BD por fila)
// ---------------------------------------------------------------------
const cacheCursos = new Map();      // nombre_normalizado -> curso_id (AULAnet)
const cacheAreas = new Map();       // nombre AULAnet -> area_id
const cachePeriodos = new Map();    // "año-numero" -> periodo_id
const cacheEstudiantes = new Map(); // codigo (edumetrics_id) -> estudiante_id

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

async function obtenerOCrearPeriodo(anio, numero) {
  const key = `${anio}-${numero}`;
  if (cachePeriodos.has(key)) return cachePeriodos.get(key);

  const { data, error } = await aula.from('an_periodos')
    .upsert({ anio, numero, nombre_informe: PERIODO_NOMBRE_INFORME[numero] }, { onConflict: 'anio,numero' })
    .select('id').single();
  if (error) throw error;
  cachePeriodos.set(key, data.id);
  return data.id;
}

async function obtenerOCrearEstudiante(codigo, nombre, cursoNombreEdu) {
  if (cacheEstudiantes.has(codigo)) return cacheEstudiantes.get(codigo);

  const cursoId = cacheCursos.get(normalizar(cursoNombreEdu));
  if (!cursoId) {
    return null; // el curso todavía no existe en an_cursos — se reporta al final
  }

  const { data, error } = await aula.from('an_estudiantes')
    .upsert({
      edumetrics_id: codigo,
      nombre_completo: nombre,
      nombre_normalizado: normalizar(nombre),
      curso_id: cursoId,
      origen: 'sync_edumetrics',
    }, { onConflict: 'edumetrics_id' })
    .select('id').single();

  if (error) {
    // por si edumetrics_id aún no tiene UNIQUE constraint, cae aquí
    console.error(`Error creando/actualizando estudiante ${codigo} (${nombre}):`, error.message);
    return null;
  }
  cacheEstudiantes.set(codigo, data.id);
  return data.id;
}

// ---------------------------------------------------------------------
// Consolidación de notas por área a partir del JSON `notas` / `acumulado`
// ---------------------------------------------------------------------
function consolidarPorArea(notas, acumuladoNotas) {
  // notas: { asigName: {nota, area} }  → area en formato EduMetrics (mayúsculas)
  // acumuladoNotas: { asigName: number } | undefined  (sin area, hay que mapearla con `notas`)
  const asigToArea = {};
  const sumaPeriodo = {}; const cuentaPeriodo = {};
  for (const [asig, v] of Object.entries(notas || {})) {
    const areaEdu = v.area;
    const areaAula = AREA_MAP[areaEdu];
    if (!areaAula) continue; // área desconocida, se ignora
    asigToArea[asig] = areaAula;
    sumaPeriodo[areaAula] = (sumaPeriodo[areaAula] || 0) + v.nota;
    cuentaPeriodo[areaAula] = (cuentaPeriodo[areaAula] || 0) + 1;
  }

  const sumaAcum = {}; const cuentaAcum = {};
  for (const [asig, nota] of Object.entries(acumuladoNotas || {})) {
    const areaAula = asigToArea[asig]; // reutiliza el mapeo de la fila actual
    if (!areaAula) continue;
    sumaAcum[areaAula] = (sumaAcum[areaAula] || 0) + nota;
    cuentaAcum[areaAula] = (cuentaAcum[areaAula] || 0) + 1;
  }

  const resultado = {}; // areaAula -> {nota_periodo, nota_acumulada}
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

  let procesados = 0, filasConsolidadas = 0, errores = 0;
  const cursosFaltantes = new Set();
  const rowsAConsolidar = []; // buffer para upsert masivo al final

  const PAGE = 500;
  let from = 0;
  while (true) {
    const { data: rows, error } = await edu.from('resultados')
      .select('año, periodo, grado, curso, codigo, estudiante, notas, acumulado')
      .eq('año', SYNC_ANIO)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      procesados++;
      const numero = PERIODO_NUM[row.periodo];
      if (!numero) continue; // periodo no reconocido, se ignora

      if (!cacheCursos.has(normalizar(row.curso))) {
        cursosFaltantes.add(row.curso);
        continue; // no podemos vincular al estudiante sin su curso en AULAnet
      }

      const estudianteId = await obtenerOCrearEstudiante(row.codigo, row.estudiante, row.curso);
      if (!estudianteId) continue;

      const periodoId = await obtenerOCrearPeriodo(SYNC_ANIO, numero);
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
        filasConsolidadas++;
      }
    }

    from += PAGE;
    if (rows.length < PAGE) break;
  }

  // Upsert masivo en lotes de 500
  const BATCH = 500;
  for (let i = 0; i < rowsAConsolidar.length; i += BATCH) {
    const batch = rowsAConsolidar.slice(i, i + BATCH);
    const { error } = await aula.from('an_resultados_consolidados')
      .upsert(batch, { onConflict: 'estudiante_id,area_id,periodo_id' });
    if (error) { console.error('Error en upsert de consolidados:', error.message); errores++; }
  }

  if (cursosFaltantes.size > 0) {
    console.warn('⚠️  Cursos de EduMetrics sin equivalente en an_cursos (no se sincronizaron sus estudiantes):');
    console.warn('   ' + [...cursosFaltantes].join(', '));
  }

  const estado = errores > 0 ? 'con_errores' : 'exitoso';
  const detalle = `procesados=${procesados}, filas_consolidadas=${filasConsolidadas}, ` +
                   `cursos_faltantes=${cursosFaltantes.size}${cursosFaltantes.size ? ' (' + [...cursosFaltantes].join('; ') + ')' : ''}`;

  await aula.from('an_sync_log').insert({
    filas_sincronizadas: filasConsolidadas,
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
