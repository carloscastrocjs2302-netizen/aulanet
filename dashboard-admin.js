// =====================================================================
// AULANET · VISTA: DASHBOARD ADMINISTRADOR
// =====================================================================

const VistaDashboardAdmin = {
  perfil: null,
  contenedor: null,

  async render(contenedor, perfil) {
    this.perfil = perfil;
    this.contenedor = contenedor;
    this.pintarShell();
    await this.cargarDatos();
  },

  pintarShell() {
    this.contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            <span class="curso-fijo">Administrador</span>
            ${this.perfil.areas_coordinadas?.length ? `<button id="btnIrCoordinacion" class="btn-icono" aria-label="Mi coordinación de área"><i class="ti ti-upload" aria-hidden="true"></i></button>` : ''}
            <button id="btnCerrarSesion" class="btn-icono" aria-label="Cerrar sesión"><i class="ti ti-logout" aria-hidden="true"></i></button>
            <div class="avatar-chico">${iniciales(this.perfil.nombre_completo)}</div>
          </div>
        </header>

        <main class="contenido-principal">
          ${this.perfil.areas_coordinadas?.length ? `
            <div class="tarjeta-form" style="margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
              <p style="margin:0; font-size:13px;">También coordinas <strong>${this.perfil.areas_coordinadas.map(a => escapeHtml(a.area.nombre)).join(', ')}</strong></p>
              <button id="btnIrCoordinacion2" class="btn-secundario btn-pequeno">Ir a cargar observaciones</button>
            </div>` : ''}

          <p class="titulo-seccion">Docentes</p>
          <p class="subtitulo-seccion" id="infoDocentes">Cargando...</p>

          <div class="grid-metricas" id="gridMetricas">
            <div class="metrica-card"><p class="metrica-label">Total docentes</p><p class="metrica-valor" id="valorTotal">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Confirmados</p><p class="metrica-valor" id="valorConfirmados">—</p></div>
            <div class="metrica-card"><p class="metrica-label">Contraseña pendiente</p><p class="metrica-valor" id="valorPendientes">—</p></div>
          </div>

          <input type="text" id="buscarDocente" placeholder="Buscar docente por nombre o correo..." style="margin-bottom:12px;" />

          <div id="listaDocentes" class="lista-novedades"><p class="texto-muted">Cargando...</p></div>

          <p class="titulo-lista" style="margin-top:24px;">Agregar estudiante manualmente</p>
          <div class="tarjeta-form">
            <label for="inputNombreEst">Nombre completo</label>
            <input type="text" id="inputNombreEst" placeholder="Apellidos y nombres" />
            <label for="selectCursoEst">Curso</label>
            <select id="selectCursoEst"></select>
            <p id="mensajeEst" class="texto-muted" style="margin:8px 0;"></p>
            <button id="btnAgregarEst" class="btn-primario">Agregar estudiante</button>
          </div>
        </main>
      </div>`;

    document.getElementById('btnCerrarSesion').addEventListener('click', () => Auth.cerrarSesion());
    document.getElementById('buscarDocente').addEventListener('input', (ev) => this.filtrarDocentes(ev.target.value));
    document.getElementById('btnAgregarEst').addEventListener('click', () => this.agregarEstudiante());

    const irCoordinacion = () => VistaDashboardCoordinadorArea.render(this.contenedor, this.perfil);
    document.getElementById('btnIrCoordinacion')?.addEventListener('click', irCoordinacion);
    document.getElementById('btnIrCoordinacion2')?.addEventListener('click', irCoordinacion);
  },

  async cargarDatos() {
    try {
      const [{ data: docentes, error: errDoc }, { data: cursos, error: errCur }] = await Promise.all([
        sb.from('an_docentes').select('id, nombre_completo, correo, rol, confirmado').order('nombre_completo'),
        sb.from('an_cursos').select('id, nombre').eq('activo', true).order('nombre'),
      ]);
      if (errDoc) throw errDoc;
      if (errCur) throw errCur;

      this.docentes = docentes || [];
      const confirmados = this.docentes.filter(d => d.confirmado).length;

      document.getElementById('infoDocentes').textContent = `${this.docentes.length} correos institucionales cargados`;
      document.getElementById('valorTotal').textContent = this.docentes.length;
      document.getElementById('valorConfirmados').textContent = confirmados;
      document.getElementById('valorPendientes').textContent = this.docentes.length - confirmados;

      this.pintarListaDocentes(this.docentes);

      const select = document.getElementById('selectCursoEst');
      select.innerHTML = (cursos || []).map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
    } catch (e) {
      console.error(e);
      document.getElementById('infoDocentes').textContent = 'No pudimos cargar los docentes.';
    }
  },

  pintarListaDocentes(lista) {
    const contenedor = document.getElementById('listaDocentes');
    if (lista.length === 0) { contenedor.innerHTML = '<p class="texto-muted" style="padding:14px;">Sin resultados.</p>'; return; }

    contenedor.innerHTML = lista.slice(0, 50).map(d => `
      <div class="fila-novedad">
        <span>${escapeHtml(d.nombre_completo)} <span class="texto-muted">· ${escapeHtml(d.rol)}</span></span>
        <span class="etiqueta ${d.confirmado ? 'etiqueta-success' : 'etiqueta-warning'}">${d.confirmado ? 'Confirmado' : 'Pendiente'}</span>
      </div>`).join('');
  },

  filtrarDocentes(texto) {
    const q = normalizar(texto);
    const filtrados = !q ? this.docentes : this.docentes.filter(d =>
      normalizar(d.nombre_completo).includes(q) || normalizar(d.correo).includes(q)
    );
    this.pintarListaDocentes(filtrados);
  },

  async agregarEstudiante() {
    const nombre = document.getElementById('inputNombreEst').value.trim();
    const cursoId = document.getElementById('selectCursoEst').value;
    const mensaje = document.getElementById('mensajeEst');

    if (!nombre || !cursoId) { mensaje.textContent = 'Completa el nombre y el curso.'; return; }

    try {
      const { error } = await sb.from('an_estudiantes').insert({
        nombre_completo: nombre,
        nombre_normalizado: normalizar(nombre),
        curso_id: cursoId,
        origen: 'manual_administrador',
      });
      if (error) throw error;
      mensaje.textContent = `"${nombre}" agregado correctamente.`;
      document.getElementById('inputNombreEst').value = '';
    } catch (e) {
      console.error(e);
      mensaje.textContent = 'No se pudo agregar el estudiante.';
    }
  },
};
