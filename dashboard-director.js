// =====================================================================
// AULANET · VISTA: DASHBOARD DIRECTOR / CODIRECTOR
// =====================================================================

const VistaDashboardDirector = {
  perfil: null,
  cursoActivoId: null,

  async render(contenedor, perfil) {
    this.perfil = perfil;
    const misCursos = [...perfil.cursos_dirigidos, ...perfil.cursos_codirigidos];

    if (misCursos.length === 0) {
      contenedor.innerHTML = `<div class="pantalla-proximamente"><p class="titulo">No tienes cursos asignados todavía</p><p class="subtitulo">Contacta al administrador.</p></div>`;
      return;
    }

    this.cursoActivoId = misCursos[0].id;
    this.misCursos = misCursos;
    this.contenedor = contenedor;

    this.pintarShell();
    await this.cargarDatosCurso();
  },

  pintarShell() {
    const opcionesCurso = this.misCursos.map(c =>
      `<option value="${c.id}" ${c.id === this.cursoActivoId ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`
    ).join('');

    this.contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            ${this.misCursos.length > 1 ? `<select id="selectCurso" class="select-curso-barra">${opcionesCurso}</select>` : `<span class="curso-fijo">${escapeHtml(this.misCursos[0].nombre)}</span>`}
            <button id="btnCerrarSesion" class="btn-icono" aria-label="Cerrar sesión"><i class="ti ti-logout" aria-hidden="true"></i></button>
            <div class="avatar-chico">${iniciales(this.perfil.nombre_completo)}</div>
          </div>
        </header>

        <main class="contenido-principal">
          <p class="titulo-seccion" id="nombreCursoActivo"></p>
          <p class="subtitulo-seccion" id="infoCursoActivo">Cargando...</p>

          <div class="grid-metricas" id="gridMetricas">
            <div class="metrica-card"><p class="metrica-label">Áreas sin observaciones</p><p class="metrica-valor" id="valorAreasSin">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Estudiantes con observaciones faltantes</p><p class="metrica-valor" id="valorEstFaltan">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Promedio del curso</p><p class="metrica-valor" id="valorPromedio">—</p></div>
          </div>

          <p class="titulo-lista">Novedades recientes</p>
          <div id="listaNovedades" class="lista-novedades"><p class="texto-muted">Cargando...</p></div>
        </main>
      </div>`;

    document.getElementById('btnCerrarSesion').addEventListener('click', () => Auth.cerrarSesion());

    const select = document.getElementById('selectCurso');
    if (select) {
      select.addEventListener('change', (ev) => {
        this.cursoActivoId = ev.target.value;
        this.cargarDatosCurso();
      });
    }
  },

  async cargarDatosCurso() {
    const curso = this.misCursos.find(c => c.id === this.cursoActivoId);
    document.getElementById('nombreCursoActivo').textContent = curso.nombre;
    document.getElementById('infoCursoActivo').textContent = 'Cargando información...';

    try {
      // 1) Estudiantes del curso
      const { data: estudiantes, error: errEst } = await sb
        .from('an_estudiantes').select('id, nombre_completo').eq('curso_id', this.cursoActivoId);
      if (errEst) throw errEst;

      // 2) Periodo más reciente
      const { data: periodos, error: errPer } = await sb
        .from('an_periodos').select('id, anio, numero').order('anio', { ascending: false }).order('numero', { ascending: false }).limit(1);
      if (errPer) throw errPer;
      const periodoActual = periodos?.[0];

      // 3) Áreas esperadas (excluye Profundización/Ciencias Económicas salvo Décimo/Undécimo)
      const { data: areas, error: errAreas } = await sb.from('an_areas').select('id, nombre');
      if (errAreas) throw errAreas;
      const esBachilleratoAlto = ['Décimo', 'Undécimo'].includes(curso.nivel === 'bachillerato' ? curso.nombre.split(' ')[0] : '');
      const areasEsperadas = (areas || []).filter(a =>
        esBachilleratoAlto ? true : !['Profundización', 'Ciencias Económicas'].includes(a.nombre)
      );

      const idsEstudiantes = (estudiantes || []).map(e => e.id);

      let observaciones = [];
      let resultados = [];
      if (idsEstudiantes.length > 0 && periodoActual) {
        const [{ data: obs, error: errObs }, { data: res, error: errRes }] = await Promise.all([
          sb.from('an_observaciones').select('estudiante_id, asignatura_id, an_asignaturas(area_id)').in('estudiante_id', idsEstudiantes).eq('periodo_id', periodoActual.id),
          sb.from('an_resultados_consolidados').select('nota_periodo').in('estudiante_id', idsEstudiantes).eq('periodo_id', periodoActual.id),
        ]);
        if (errObs) throw errObs;
        if (errRes) throw errRes;
        observaciones = obs || [];
        resultados = res || [];
      }

      // Áreas con al menos una observación registrada en el curso
      const areasConObs = new Set(observaciones.map(o => o.an_asignaturas?.area_id).filter(Boolean));
      const areasSinObs = areasEsperadas.filter(a => !areasConObs.has(a.id));

      // Observaciones por estudiante (cuántas áreas distintas tiene cada uno)
      const areasPorEstudiante = new Map();
      observaciones.forEach(o => {
        const areaId = o.an_asignaturas?.area_id;
        if (!areaId) return;
        if (!areasPorEstudiante.has(o.estudiante_id)) areasPorEstudiante.set(o.estudiante_id, new Set());
        areasPorEstudiante.get(o.estudiante_id).add(areaId);
      });
      const estudiantesFaltantes = (estudiantes || []).filter(e => {
        const tiene = areasPorEstudiante.get(e.id)?.size || 0;
        return tiene < areasEsperadas.length;
      });

      const promedio = resultados.length
        ? (resultados.reduce((suma, r) => suma + (r.nota_periodo || 0), 0) / resultados.length).toFixed(1)
        : '—';

      document.getElementById('infoCursoActivo').textContent =
        `${periodoActual ? periodoActual.numero + 'º periodo ' + periodoActual.anio : 'Sin periodo activo'} · ${estudiantes.length} estudiantes`;
      document.getElementById('valorAreasSin').textContent = areasSinObs.length;
      document.getElementById('valorEstFaltan').textContent = estudiantesFaltantes.length;
      document.getElementById('valorPromedio').textContent = promedio;

      const filasNovedades = [];
      areasSinObs.slice(0, 5).forEach(a => {
        filasNovedades.push(`<div class="fila-novedad"><span>${escapeHtml(a.nombre)} — sin observaciones cargadas</span><span class="etiqueta etiqueta-warning">Pendiente</span></div>`);
      });
      estudiantesFaltantes.slice(0, 5).forEach(e => {
        filasNovedades.push(`<div class="fila-novedad"><span>${escapeHtml(e.nombre_completo)} — le faltan observaciones</span><span class="etiqueta etiqueta-danger">Falta</span></div>`);
      });

      document.getElementById('listaNovedades').innerHTML = filasNovedades.length
        ? filasNovedades.join('')
        : '<p class="texto-muted">No hay novedades pendientes en este curso.</p>';

    } catch (e) {
      console.error(e);
      document.getElementById('infoCursoActivo').textContent = 'No pudimos cargar la información de este curso.';
    }
  },
};
