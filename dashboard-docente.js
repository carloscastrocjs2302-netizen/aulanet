// =====================================================================
// AULANET · VISTA: DASHBOARD DOCENTE REGULAR (asistencia)
// =====================================================================

const VistaDashboardDocente = {
  perfil: null,
  contenedor: null,
  asignacionActiva: null,

  async render(contenedor, perfil) {
    this.perfil = perfil;
    this.contenedor = contenedor;

    const { data: asignaciones, error } = await sb
      .from('an_asignacion_docente_asignatura')
      .select('curso_id, asignatura_id, an_cursos(nombre), an_asignaturas(nombre)')
      .eq('docente_id', perfil.id);

    if (error || !asignaciones || asignaciones.length === 0) {
      contenedor.innerHTML = `<div class="pantalla-proximamente"><p class="titulo">No tienes asignaturas asignadas todavía</p><p class="subtitulo">Contacta al administrador.</p><button id="btnCerrarSesionTemp" class="btn-secundario">Cerrar sesión</button></div>`;
      document.getElementById('btnCerrarSesionTemp').addEventListener('click', () => Auth.cerrarSesion());
      return;
    }

    this.asignaciones = asignaciones;
    this.asignacionActiva = asignaciones[0];
    this.pintarShell();
    await this.cargarEstudiantes();
  },

  pintarShell() {
    const opciones = this.asignaciones.map((a, i) =>
      `<option value="${i}">${escapeHtml(a.an_cursos.nombre)} — ${escapeHtml(a.an_asignaturas.nombre)}</option>`
    ).join('');

    this.contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            <button id="btnCerrarSesion" class="btn-icono" aria-label="Cerrar sesión"><i class="ti ti-logout" aria-hidden="true"></i></button>
            <div class="avatar-chico">${iniciales(this.perfil.nombre_completo)}</div>
          </div>
        </header>

        <main class="contenido-principal">
          <p class="titulo-seccion">Tomar asistencia</p>
          <p class="subtitulo-seccion">${escapeHtml(this.perfil.nombre_completo)}</p>

          <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
            <select id="selectAsignacion" style="flex:1; min-width:200px;">${opciones}</select>
            <input type="date" id="inputFecha" value="${new Date().toISOString().slice(0, 10)}" style="width:auto;" />
          </div>

          <div id="listaAsistencia" class="lista-novedades"><p class="texto-muted" style="padding:14px;">Cargando estudiantes...</p></div>

          <p class="texto-muted" id="notaAsistencia" style="margin:10px 0;">Todos inician en "Presente" — solo marca las excepciones.</p>
          <button id="btnGuardarAsistencia" class="btn-primario">Guardar asistencia</button>
          <p id="mensajeAsistencia" class="texto-muted" style="margin-top:10px;"></p>
        </main>
      </div>`;

    document.getElementById('btnCerrarSesion').addEventListener('click', () => Auth.cerrarSesion());
    document.getElementById('selectAsignacion').addEventListener('change', (ev) => {
      this.asignacionActiva = this.asignaciones[Number(ev.target.value)];
      this.cargarEstudiantes();
    });
    document.getElementById('inputFecha').addEventListener('change', () => this.cargarEstudiantes());
    document.getElementById('btnGuardarAsistencia').addEventListener('click', () => this.guardarAsistencia());
  },

  async cargarEstudiantes() {
    const contenedor = document.getElementById('listaAsistencia');
    contenedor.innerHTML = '<p class="texto-muted" style="padding:14px;">Cargando...</p>';

    const { data: estudiantes, error } = await sb.from('an_estudiantes').select('id, nombre_completo')
      .eq('curso_id', this.asignacionActiva.curso_id).order('nombre_completo');
    if (error) { contenedor.innerHTML = '<p class="texto-muted" style="padding:14px;">Error al cargar estudiantes.</p>'; return; }

    // Traer excepciones ya guardadas hoy para esta asignatura, si las hay
    const fecha = document.getElementById('inputFecha').value;
    const { data: existentes } = await sb.from('an_asistencia').select('estudiante_id, estado')
      .eq('asignatura_id', this.asignacionActiva.asignatura_id).eq('fecha', fecha);
    const mapaExistentes = new Map((existentes || []).map(e => [e.estudiante_id, e.estado]));

    this.estados = new Map((estudiantes || []).map(e => [e.id, mapaExistentes.get(e.id) || 'presente']));
    this.estudiantesAsistencia = estudiantes || [];
    this.pintarFilas();
  },

  pintarFilas() {
    const contenedor = document.getElementById('listaAsistencia');
    const OPCIONES = [
      { valor: 'presente', label: 'Presente' },
      { valor: 'tarde', label: 'Tarde' },
      { valor: 'ausente', label: 'Ausente' },
      { valor: 'excusa', label: 'Excusa' },
    ];

    contenedor.innerHTML = this.estudiantesAsistencia.map(e => {
      const estadoActual = this.estados.get(e.id);
      const botones = OPCIONES.map(o => `
        <button class="btn-estado-asistencia ${estadoActual === o.valor ? 'btn-estado-activo-' + o.valor : ''}" data-est="${e.id}" data-estado="${o.valor}">${o.label}</button>
      `).join('');
      return `<div class="fila-asistencia"><span>${escapeHtml(e.nombre_completo)}</span><div class="botones-estado">${botones}</div></div>`;
    }).join('');

    contenedor.querySelectorAll('.btn-estado-asistencia').forEach(btn => {
      btn.addEventListener('click', () => {
        this.estados.set(btn.dataset.est, btn.dataset.estado);
        this.pintarFilas();
      });
    });
  },

  async guardarAsistencia() {
    const boton = document.getElementById('btnGuardarAsistencia');
    boton.disabled = true;
    boton.textContent = 'Guardando...';
    const mensaje = document.getElementById('mensajeAsistencia');
    const fecha = document.getElementById('inputFecha').value;

    try {
      // Solo se guardan las excepciones (no "presente")
      const excepciones = [...this.estados.entries()]
        .filter(([, estado]) => estado !== 'presente')
        .map(([estudianteId, estado]) => ({
          estudiante_id: estudianteId,
          curso_id: this.asignacionActiva.curso_id,
          asignatura_id: this.asignacionActiva.asignatura_id,
          docente_id: this.perfil.id,
          fecha,
          estado,
        }));

      // Se borran todas las excepciones de este día/asignatura y se vuelven a
      // insertar las actuales — más simple y seguro que calcular diferencias.
      await sb.from('an_asistencia').delete()
        .eq('asignatura_id', this.asignacionActiva.asignatura_id).eq('fecha', fecha);

      if (excepciones.length > 0) {
        const { error } = await sb.from('an_asistencia').insert(excepciones);
        if (error) throw error;
      }

      mensaje.textContent = `✓ Asistencia guardada (${excepciones.length} excepciones registradas).`;
      boton.disabled = false;
      boton.textContent = 'Guardar asistencia';
    } catch (e) {
      console.error(e);
      mensaje.textContent = 'Ocurrió un error guardando la asistencia.';
      boton.disabled = false;
      boton.textContent = 'Guardar asistencia';
    }
  },
};
