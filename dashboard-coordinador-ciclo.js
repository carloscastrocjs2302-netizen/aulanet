// =====================================================================
// AULANET · VISTA: DASHBOARD COORDINADOR DE CICLO
// =====================================================================

const VistaDashboardCoordinadorCiclo = {
  perfil: null,
  contenedor: null,

  async render(contenedor, perfil) {
    this.perfil = perfil;
    this.contenedor = contenedor;

    if (!perfil.grados_ciclo || perfil.grados_ciclo.length === 0) {
      contenedor.innerHTML = `<div class="pantalla-proximamente"><p class="titulo">No tienes grados de ciclo asignados</p><p class="subtitulo">Contacta al administrador.</p></div>`;
      return;
    }

    this.pintarShell();
    await this.cargarDatos();
  },

  pintarShell() {
    this.contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            <span class="curso-fijo">${escapeHtml(this.perfil.grados_ciclo.join(', '))}</span>
            <button id="btnCerrarSesion" class="btn-icono" aria-label="Cerrar sesión"><i class="ti ti-logout" aria-hidden="true"></i></button>
            <div class="avatar-chico">${iniciales(this.perfil.nombre_completo)}</div>
          </div>
        </header>

        <main class="contenido-principal">
          <p class="titulo-seccion">Comparativo institucional</p>
          <p class="subtitulo-seccion" id="infoCiclo">Cargando...</p>

          <div class="grid-metricas" id="gridMetricas">
            <div class="metrica-card"><p class="metrica-label">Cursos en mi ciclo</p><p class="metrica-valor" id="valorCursos">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Estudiantes totales</p><p class="metrica-valor" id="valorEstudiantes">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Casos convivenciales abiertos</p><p class="metrica-valor" id="valorCasos">—</p></div>
          </div>

          <p class="titulo-lista">Cursos por promedio</p>
          <div id="listaCursos" class="lista-novedades"><p class="texto-muted" style="padding:14px;">Cargando...</p></div>
        </main>
      </div>`;

    document.getElementById('btnCerrarSesion').addEventListener('click', () => Auth.cerrarSesion());
  },

  async cargarDatos() {
    try {
      document.getElementById('infoCiclo').textContent = `${this.perfil.grados_ciclo.join(', ')} · Tercer periodo académico`;

      const { data: cursos } = await sb.from('an_cursos').select('id, nombre, grado').in('grado', this.perfil.grados_ciclo).eq('activo', true);
      const idsCursos = (cursos || []).map(c => c.id);

      const { data: periodos } = await sb.from('an_periodos').select('id, anio, numero').order('anio', { ascending: false }).order('numero', { ascending: false }).limit(1);
      const periodoActual = periodos?.[0];

      const { data: estudiantes } = idsCursos.length
        ? await sb.from('an_estudiantes').select('id, curso_id').in('curso_id', idsCursos)
        : { data: [] };

      let resultados = [];
      if (periodoActual && estudiantes?.length) {
        const idsEst = estudiantes.map(e => e.id);
        const { data: res } = await sb.from('an_resultados_consolidados').select('estudiante_id, nota_periodo').in('estudiante_id', idsEst).eq('periodo_id', periodoActual.id);
        resultados = res || [];
      }

      const { count: casosAbiertos } = await sb.from('an_seguimiento_casos').select('id', { count: 'exact', head: true })
        .in('estudiante_id', (estudiantes || []).map(e => e.id).length ? (estudiantes || []).map(e => e.id) : ['00000000-0000-0000-0000-000000000000'])
        .neq('estado', 'cerrado');

      document.getElementById('valorCursos').textContent = cursos?.length || 0;
      document.getElementById('valorEstudiantes').textContent = estudiantes?.length || 0;
      document.getElementById('valorCasos').textContent = casosAbiertos || 0;

      const notasPorEstudiante = new Map();
      resultados.forEach(r => {
        if (!notasPorEstudiante.has(r.estudiante_id)) notasPorEstudiante.set(r.estudiante_id, []);
        notasPorEstudiante.get(r.estudiante_id).push(r.nota_periodo || 0);
      });

      const filasCursos = (cursos || []).map(c => {
        const estudiantesCurso = (estudiantes || []).filter(e => e.curso_id === c.id);
        const notas = estudiantesCurso.flatMap(e => notasPorEstudiante.get(e.id) || []);
        const promedio = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : null;
        return { ...c, promedio };
      }).sort((a, b) => (a.promedio ?? -1) - (b.promedio ?? -1));

      document.getElementById('listaCursos').innerHTML = filasCursos.length
        ? filasCursos.map(c => {
            const clase = c.promedio === null ? '' : c.promedio < 7 ? 'etiqueta-danger' : c.promedio < 7.5 ? 'etiqueta-warning' : 'etiqueta-success';
            const texto = c.promedio === null ? 'Sin datos' : c.promedio.toFixed(1);
            return `<div class="fila-novedad"><span>${escapeHtml(c.nombre)}</span><span class="etiqueta ${clase}">${texto}</span></div>`;
          }).join('')
        : '<p class="texto-muted" style="padding:14px;">No hay cursos en este ciclo.</p>';

    } catch (e) {
      console.error(e);
      document.getElementById('infoCiclo').textContent = 'No pudimos cargar la información.';
    }
  },
};
