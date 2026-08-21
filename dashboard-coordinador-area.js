// =====================================================================
// AULANET · VISTA: DASHBOARD COORDINADOR DE ÁREA
// =====================================================================

const VistaDashboardCoordinadorArea = {
  perfil: null,
  areaActivaId: null,

  async render(contenedor, perfil) {
    this.perfil = perfil;
    this.contenedor = contenedor;

    if (!perfil.areas_coordinadas || perfil.areas_coordinadas.length === 0) {
      contenedor.innerHTML = `<div class="pantalla-proximamente"><p class="titulo">No tienes áreas coordinadas asignadas</p><p class="subtitulo">Contacta al administrador.</p></div>`;
      return;
    }

    this.areaActivaId = perfil.areas_coordinadas[0].area.id;
    this.pintarShell();
    await this.cargarDatosArea();
  },

  pintarShell() {
    const opciones = this.perfil.areas_coordinadas.map(a =>
      `<option value="${a.area.id}" ${a.area.id === this.areaActivaId ? 'selected' : ''}>${escapeHtml(a.area.nombre)}${a.nivel ? ' (' + a.nivel + ')' : ''}</option>`
    ).join('');

    this.contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            ${this.perfil.areas_coordinadas.length > 1 ? `<select id="selectArea" class="select-curso-barra">${opciones}</select>` : `<span class="curso-fijo">${escapeHtml(this.perfil.areas_coordinadas[0].area.nombre)}</span>`}
            <button id="btnCargarExcel" class="btn-icono" aria-label="Cargar observaciones"><i class="ti ti-upload" aria-hidden="true"></i></button>
            <button id="btnCerrarSesion" class="btn-icono" aria-label="Cerrar sesión"><i class="ti ti-logout" aria-hidden="true"></i></button>
            <div class="avatar-chico">${iniciales(this.perfil.nombre_completo)}</div>
          </div>
        </header>

        <main class="contenido-principal">
          <div class="cabecera-con-boton">
            <div>
              <p class="titulo-seccion">Panel de calidad</p>
              <p class="subtitulo-seccion" id="infoAreaActiva">Cargando...</p>
            </div>
            <button id="btnCargarExcel2" class="btn-primario">Cargar observaciones</button>
          </div>

          <div class="grid-metricas" id="gridMetricas">
            <div class="metrica-card"><p class="metrica-label">Cursos sin observaciones</p><p class="metrica-valor" id="valorCursosSin">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Alertas de redacción</p><p class="metrica-valor" id="valorAlertas">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Estudiantes cubiertos</p><p class="metrica-valor" id="valorCubiertos">—</p></div>
          </div>

          <p class="titulo-lista">Cursos sin observaciones</p>
          <div id="listaCursosSin" class="lista-novedades" style="margin-bottom:24px;"><p class="texto-muted">Cargando...</p></div>

          <p class="titulo-lista">Alertas de redacción</p>
          <div id="listaAlertas" class="lista-novedades"><p class="texto-muted">Cargando...</p></div>
        </main>
      </div>`;

    document.getElementById('btnCerrarSesion').addEventListener('click', () => Auth.cerrarSesion());
    document.getElementById('btnCargarExcel').addEventListener('click', () => VistaCargaExcel.render(this.contenedor, this.perfil, this.areaActivaId));
    document.getElementById('btnCargarExcel2').addEventListener('click', () => VistaCargaExcel.render(this.contenedor, this.perfil, this.areaActivaId));

    const select = document.getElementById('selectArea');
    if (select) {
      select.addEventListener('change', (ev) => {
        this.areaActivaId = ev.target.value;
        this.cargarDatosArea();
      });
    }
  },

  async cargarDatosArea() {
    const areaInfo = this.perfil.areas_coordinadas.find(a => a.area.id === this.areaActivaId);
    document.getElementById('infoAreaActiva').textContent = `${areaInfo.area.nombre} · Todos los grados`;

    try {
      // Periodo más reciente
      const { data: periodos } = await sb.from('an_periodos').select('id, anio, numero').order('anio', { ascending: false }).order('numero', { ascending: false }).limit(1);
      const periodoActual = periodos?.[0];
      if (!periodoActual) { this.pintarSinDatos(); return; }

      // Asignaturas de esta área
      const { data: asignaturas } = await sb.from('an_asignaturas').select('id, nombre').eq('area_id', this.areaActivaId);
      const idsAsignaturas = (asignaturas || []).map(a => a.id);

      // Todos los cursos
      const { data: cursos } = await sb.from('an_cursos').select('id, nombre').eq('activo', true);

      // Observaciones de esta área en el periodo
      const { data: observaciones } = await sb
        .from('an_observaciones')
        .select('estudiante_id, asignatura_id, texto, alerta_mayuscula, alerta_nombre_estudiante, an_estudiantes(nombre_completo, curso_id, an_cursos(nombre))')
        .in('asignatura_id', idsAsignaturas.length ? idsAsignaturas : ['00000000-0000-0000-0000-000000000000'])
        .eq('periodo_id', periodoActual.id);

      const cursosConObs = new Set((observaciones || []).map(o => o.an_estudiantes?.curso_id).filter(Boolean));
      const cursosSin = (cursos || []).filter(c => !cursosConObs.has(c.id));

      const alertas = (observaciones || []).filter(o => o.alerta_mayuscula || o.alerta_nombre_estudiante);

      document.getElementById('valorCursosSin').textContent = cursosSin.length;
      document.getElementById('valorAlertas').textContent = alertas.length;
      document.getElementById('valorCubiertos').textContent = new Set((observaciones || []).map(o => o.estudiante_id)).size;

      document.getElementById('listaCursosSin').innerHTML = cursosSin.length
        ? cursosSin.slice(0, 10).map(c => `<div class="fila-novedad"><span>${escapeHtml(c.nombre)}</span><span class="etiqueta etiqueta-warning">Sin cargar</span></div>`).join('')
        : '<p class="texto-muted" style="padding:14px;">Todos los cursos tienen observaciones cargadas.</p>';

      document.getElementById('listaAlertas').innerHTML = alertas.length
        ? alertas.slice(0, 10).map(a => {
            const regla = a.alerta_mayuscula ? 'No inicia en mayúscula' : 'Nombre del estudiante mal escrito';
            return `<div class="fila-novedad"><span>${escapeHtml(a.an_estudiantes?.nombre_completo || '')} — ${escapeHtml(a.an_estudiantes?.an_cursos?.nombre || '')}</span><span class="etiqueta etiqueta-danger">${regla}</span></div>`;
          }).join('')
        : '<p class="texto-muted" style="padding:14px;">No hay alertas de redacción.</p>';

    } catch (e) {
      console.error(e);
      this.pintarSinDatos();
    }
  },

  pintarSinDatos() {
    document.getElementById('valorCursosSin').textContent = '—';
    document.getElementById('valorAlertas').textContent = '—';
    document.getElementById('valorCubiertos').textContent = '—';
    document.getElementById('listaCursosSin').innerHTML = '<p class="texto-muted" style="padding:14px;">Sin datos todavía.</p>';
    document.getElementById('listaAlertas').innerHTML = '';
  },
};
